/**
 * Playwright network lockdown for offline tests and evals (M1 T4; plan section 4).
 *
 * Use `newLockedDownContext`. It is the only supported way to get a contained context:
 *
 * 1. **Containment (the guarantee):** the context's proxy is a loopback sinkhole owned by the
 *    context, with only loopback bypassed. Anything non-loopback that Chromium sends by any path
 *    (redirects, preconnect, a later `route.continue()`, routes removed by `unrouteAll`) lands
 *    on the sinkhole, is refused and is recorded in `escaped`. Service workers are blocked.
 * 2. **Route policy (the detail):** `installRoutePolicy` aborts and logs non-loopback requests,
 *    fulfils mapped platform assets from local files, and closes external WebSockets. It is
 *    *not* containment on its own: Playwright routes don't see redirects or preconnects, and
 *    later routes or `unrouteAll()` can override or remove them.
 */
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Route,
  WebSocketRoute,
} from 'playwright';
import {
  type PlatformAssetRule,
  contentTypeFor,
  isLoopbackUrl,
  isStrictlyWithin,
  matchPlatformAsset,
} from './network-policy';
import { type SinkholeHit, startSinkhole } from './sinkhole';

export type BlockReason =
  /** Non-loopback and no platform-asset rule matched. */
  | 'external'
  /** A rule matched but the local file doesn't exist (or is outside the fixture root). */
  | 'missing-asset'
  /** Not http(s), e.g. `ftp:`. */
  | 'unsupported-scheme'
  /** A WebSocket to a non-loopback host. */
  | 'websocket';

export interface BlockedRequest {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly reason: BlockReason;
}

export interface ServedAsset {
  readonly url: string;
  /** Absolute local file that was served instead. */
  readonly file: string;
}

export type LockdownEvent =
  ({ readonly type: 'blocked' } & BlockedRequest) | ({ readonly type: 'served' } & ServedAsset);

export interface LockdownOptions {
  /** Fixture root that `platformAssets` targets are relative to. Required if rules are given. */
  root?: string;
  /** External URL patterns served from local files. Unmapped external requests are aborted. */
  platformAssets?: readonly PlatformAssetRule[];
  /** Called for every blocked or locally served request. Defaults to `console.warn` for blocks. */
  log?: (event: LockdownEvent) => void;
}

export interface RoutePolicy {
  readonly blocked: readonly BlockedRequest[];
  readonly served: readonly ServedAsset[];
}

function defaultLog(event: LockdownEvent): void {
  if (event.type === 'blocked') {
    console.warn(`[fixture lockdown] blocked ${event.reason} ${event.method} ${event.url}`);
  }
}

/** The real file to serve, or null if missing or if symlinks lead outside `base`. */
async function realFileWithin(file: string, base: string): Promise<string | null> {
  try {
    const [realBase, realFile] = await Promise.all([realpath(base), realpath(file)]);
    if (!isStrictlyWithin(realBase, realFile)) return null;
    return (await stat(realFile)).isFile() ? realFile : null;
  } catch {
    return null;
  }
}

/**
 * Route policy only, NOT containment: see the module comment. Installs routes that abort
 * non-loopback requests, serve mapped platform assets and close external WebSockets.
 * Not exported from `evals/fixtures`; capture code must use `newLockedDownContext`.
 */
export async function installRoutePolicy(
  context: BrowserContext,
  options: LockdownOptions = {},
): Promise<RoutePolicy> {
  const rules = options.platformAssets ?? [];
  if (rules.length > 0 && options.root === undefined) {
    throw new Error('installRoutePolicy: `root` is required when `platformAssets` are given.');
  }
  const root = path.resolve(options.root ?? '.');
  const log = options.log ?? defaultLog;
  const blocked: BlockedRequest[] = [];
  const served: ServedAsset[] = [];

  const block = async (route: Route, reason: BlockReason): Promise<void> => {
    const req = route.request();
    const entry: BlockedRequest = {
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      reason,
    };
    blocked.push(entry);
    log({ type: 'blocked', ...entry });
    await route.abort('blockedbyclient');
  };

  const onRequest = async (route: Route): Promise<void> => {
    const url = route.request().url();
    let protocol: string;
    try {
      protocol = new URL(url).protocol;
    } catch {
      return block(route, 'unsupported-scheme');
    }
    if (protocol !== 'http:' && protocol !== 'https:') return block(route, 'unsupported-scheme');
    if (isLoopbackUrl(url)) return route.continue();

    const match = matchPlatformAsset(url, rules, root);
    if (match.kind === 'unmatched') return block(route, 'external');
    // A matching rule without a usable file is still a block, never a fetch.
    const file = match.kind === 'file' ? await realFileWithin(match.file, match.base) : null;
    if (file === null) return block(route, 'missing-asset');
    const entry: ServedAsset = { url, file };
    served.push(entry);
    log({ type: 'served', ...entry });
    return route.fulfill({
      path: file,
      contentType: contentTypeFor(file),
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    });
  };

  const onWebSocket = (ws: WebSocketRoute): void => {
    const url = ws.url();
    if (isLoopbackUrl(url)) {
      ws.connectToServer();
      return;
    }
    const entry: BlockedRequest = {
      url,
      method: 'GET',
      resourceType: 'websocket',
      reason: 'websocket',
    };
    blocked.push(entry);
    log({ type: 'blocked', ...entry });
    // Not calling connectToServer() means no connection is ever made.
    void ws.close({ code: 1008, reason: 'Blocked by fixture lockdown' });
  };

  await context.route('**/*', onRequest);
  await context.routeWebSocket(/.*/, onWebSocket);

  return { blocked, served };
}

/**
 * Proxy bypass list: loopback goes direct, everything else goes to the sinkhole. Matches
 * `isLoopbackHost` (127.0.0.0/8, localhost, ::1).
 */
export const LOOPBACK_PROXY_BYPASS = '127.0.0.0/8,localhost,[::1]';

export interface LockedDownContextOptions extends LockdownOptions {
  /** Extra context options. `serviceWorkers` and `proxy` are always set by the lockdown. */
  contextOptions?: Omit<BrowserContextOptions, 'serviceWorkers' | 'proxy'>;
}

export interface LockedDownContext {
  readonly context: BrowserContext;
  /** Requests the route policy aborted. */
  readonly blocked: readonly BlockedRequest[];
  /** Platform URLs fulfilled from local files. */
  readonly served: readonly ServedAsset[];
  /** Traffic that got past the routes and was refused by the sinkhole. Should normally be empty. */
  readonly escaped: readonly SinkholeHit[];
  /** Close the context and its sinkhole. Closing `context` directly also stops the sinkhole. */
  close(): Promise<void>;
}

/**
 * Create a contained context: its own loopback sinkhole as the proxy (loopback bypassed),
 * service workers blocked, and the route policy installed. The sinkhole is closed when the
 * context closes.
 */
export async function newLockedDownContext(
  browser: Browser,
  options: LockedDownContextOptions = {},
): Promise<LockedDownContext> {
  const { contextOptions, ...policyOptions } = options;
  const sinkhole = await startSinkhole();
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      ...contextOptions,
      serviceWorkers: 'block',
      proxy: { server: sinkhole.origin, bypass: LOOPBACK_PROXY_BYPASS },
    });
  } catch (err) {
    await sinkhole.close();
    throw err;
  }
  let sinkholeClosed: Promise<void> | undefined;
  const closeSinkhole = (): Promise<void> => (sinkholeClosed ??= sinkhole.close());
  context.on('close', () => {
    closeSinkhole().catch(() => {});
  });

  try {
    const { blocked, served } = await installRoutePolicy(context, policyOptions);
    return {
      context,
      blocked,
      served,
      escaped: sinkhole.hits,
      close: async () => {
        await context.close();
        await closeSinkhole();
      },
    };
  } catch (err) {
    await context.close();
    await closeSinkhole();
    throw err;
  }
}
