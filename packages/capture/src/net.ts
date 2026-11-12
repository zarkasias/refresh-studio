/**
 * The guarded network path (M1 T8; CLAUDE.md rules 5 and 6). `guardedFetch` and `guardedGoto` are
 * the only functions in packages/capture and packages/audit allowed to touch the network; ESLint
 * bans `fetch(`, `page.goto(`, `*.request.*(` and friends, and the HTTP client modules, everywhere
 * else.
 *
 * Every call: reads the project fresh, runs `assertCrawlAllowed`, checks robots.txt and blocks
 * loopback/private addresses after DNS resolution. `guardedFetch` follows redirects by hand, so
 * every hop is checked. The browser path (M1 T9) has three layers:
 *   1. `launchCaptureBrowser`: Chromium with no DNS of its own (`MAP * ~NOTFOUND`), a proxy that
 *      points at a closed loopback port (loopback included), WebRTC UDP off and prefetch off. This
 *      contains what routing can't see: preconnect, dns-prefetch, `Link: rel=preconnect`, WebRTC.
 *   2. `newGuardedContext`: service workers blocked, popups closed and a `context.route` guard
 *      that checks every request Chromium makes and serves each allowed one with `route.fulfill`
 *      from the pinned fetch path, so Chromium opens no http(s) connection of its own.
 *   3. `guardedGoto`: refuses any browser or context not made by 1 and 2, checks every redirect
 *      hop before it is requested, and is the only thing that may start a main-frame navigation.
 * Only browsers from `launchCaptureBrowser` and contexts from `newGuardedContext` are accepted.
 *
 * Exception (ADR-010): outside production, a `*.test` hostname listed in `fixtureHostMap` is
 * served from a loopback port, skipping the address block. Nothing else is exempt.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { createServer, isIP, type LookupFunction } from 'node:net';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from 'playwright';
import { assertCrawlAllowed, GuardError, type Project } from '@srs/site-model';
import { isPrivateAddress, isTestHostname } from './address';
import { CaptureBlockedError } from './errors';
import { CRAWLER_USER_AGENT } from './identity';
import type { RobotsPolicy } from './robots';
import { isTrackerHost } from './trackers';

export const NAVIGATION_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Largest single subresource (image, font, script) we serve to the browser. */
export const MAX_SUBRESOURCE_BYTES = 25 * 1024 * 1024;

export type LookupFn = (hostname: string) => Promise<readonly string[]>;

export interface NetContext {
  /** Read fresh on every guarded call, so consent revoked mid-run takes effect. */
  getProject(): Project | Promise<Project>;
  /** Pages fetched so far in this crawl. Passed to `assertCrawlAllowed` for page requests. */
  pagesCrawledSoFar(): number;
  /** The site's robots policy. Required for everything except fetching robots.txt itself. */
  robots?: RobotsPolicy | undefined;
  /** `*.test` hostname -> loopback port. Ignored in production and for any other hostname. */
  fixtureHostMap?: Readonly<Record<string, number>>;
  /** `true` forces production behaviour. `NODE_ENV=production` is always honoured, read on every call. */
  production?: boolean;
  /** DNS lookup returning every address for a host. Defaults to the system resolver. */
  lookup?: LookupFn;
  timeoutMs?: number;
}

export type RequestKind = 'page' | 'robots' | 'sitemap';

export interface GuardedFetchOptions {
  /** `robots` skips the robots check (it is the file itself). Only `page` counts towards the limit. */
  kind?: RequestKind;
}

export interface GuardedResponse {
  /** Final URL after redirects. */
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Every URL requested, in order, ending with `url`. */
  readonly chain: readonly string[];
}

const defaultLookup: LookupFn = async (hostname) => {
  const all = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return all.map((a) => a.address);
};

function isProduction(ctx: NetContext): boolean {
  // NODE_ENV=production always wins: `production: false` can't switch the fixture map back on.
  return process.env.NODE_ENV === 'production' || ctx.production === true;
}

/** The loopback port for a fixture-mapped host, or undefined (always undefined in production). */
export function fixturePortFor(ctx: NetContext, hostname: string): number | undefined {
  if (isProduction(ctx) || !ctx.fixtureHostMap) return undefined;
  const host = hostname.toLowerCase();
  if (!isTestHostname(host)) return undefined;
  const port = Object.hasOwn(ctx.fixtureHostMap, host) ? ctx.fixtureHostMap[host] : undefined;
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536
    ? port
    : undefined;
}

/**
 * Throws `private-address` unless `url`'s host is a public address after DNS resolution.
 * Returns the single address to connect to, or `null` for a fixture-mapped host.
 */
export async function assertPublicHost(ctx: NetContext, url: string): Promise<string | null> {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (fixturePortFor(ctx, hostname) !== undefined) return null;
  const refuse = () =>
    new CaptureBlockedError(
      'private-address',
      `This address (${hostname}) points to a private or local network, not the public internet, so we won't scan it.`,
      url,
    );
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw refuse();
    return hostname;
  }
  let addresses: readonly string[];
  try {
    addresses = await (ctx.lookup ?? defaultLookup)(hostname);
  } catch {
    throw new CaptureBlockedError('network', `We couldn't find a website at ${hostname}.`, url);
  }
  if (addresses.length === 0) {
    throw new CaptureBlockedError('network', `We couldn't find a website at ${hostname}.`, url);
  }
  // Any private answer refuses the host: a mixed answer is a rebinding signal.
  if (addresses.some(isPrivateAddress)) throw refuse();
  return addresses[0]!;
}

function isRootSupportFile(url: string, kind: RequestKind): boolean {
  const { pathname } = new URL(url);
  return (
    (kind === 'robots' && pathname === '/robots.txt') ||
    (kind === 'sitemap' && pathname === '/sitemap.xml')
  );
}

function withoutPathPrefix(project: Project): Project {
  const consent = project.consent;
  if (!consent || typeof consent.scope !== 'object' || consent.scope === null) return project;
  const scope = { ...consent.scope };
  delete scope.pathPrefix;
  return { ...project, consent: { ...consent, scope } };
}

async function checkUrl(ctx: NetContext, url: string, kind: RequestKind): Promise<string | null> {
  const project = await ctx.getProject();
  // Exactly `/robots.txt` and `/sitemap.xml` at the origin root live outside a `pathPrefix` scope
  // such as a `*.wixsite.com/<slug>` site, so only those two drop the prefix. Consent, origin and
  // the rest of the guard still apply to them. Every other URL, including other sitemap URLs and
  // every redirect hop, must sit inside the prefix.
  assertCrawlAllowed(isRootSupportFile(url, kind) ? withoutPathPrefix(project) : project, url, {
    pagesCrawledSoFar: kind === 'page' ? ctx.pagesCrawledSoFar() : 0,
  });
  if (kind !== 'robots') {
    if (!ctx.robots) {
      throw new CaptureBlockedError(
        'robots',
        "We haven't read this site's robots.txt yet, so we can't scan it.",
        url,
      );
    }
    if (!ctx.robots.isAllowed(url)) {
      throw new CaptureBlockedError(
        'robots',
        `This site's robots.txt asks crawlers not to visit ${new URL(url).pathname}, so we skipped it.`,
        url,
      );
    }
  }
  return assertPublicHost(ctx, url);
}

/**
 * A `lookup` that always answers with `address`, in whichever shape Node asks for. Node 22 with
 * `autoSelectFamily` calls it with `{ all: true }` and expects an array.
 */
export function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address) === 6 ? 6 : 4;
  return (_host, options, callback) => {
    if (typeof options === 'object' && options !== null && options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

export interface PinnedRequestOptions {
  method?: 'GET' | 'HEAD';
  /** Extra request headers. `Host` and `User-Agent` are always ours. */
  headers?: Readonly<Record<string, string>>;
  maxBytes?: number;
  connect?: { autoSelectFamily?: boolean };
}

export interface PinnedResponse {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
}

/**
 * One request with no redirect handling, connected to `address` (already checked by the caller)
 * or to the fixture port. Internal: it does no address check itself, so it is not re-exported
 * from the package index. Use `guardedFetch` or the request guard.
 */
export function pinnedRequest(
  ctx: NetContext,
  url: string,
  address: string | null,
  options: PinnedRequestOptions = {},
): Promise<PinnedResponse> {
  const target = new URL(url);
  const mappedPort = fixturePortFor(ctx, target.hostname);
  const timeoutMs = ctx.timeoutMs ?? NAVIGATION_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const method = options.method ?? 'GET';
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
      ...options.headers,
      'User-Agent': CRAWLER_USER_AGENT,
      'Accept-Encoding': 'identity',
      Host: target.host,
    };
    const common = { method, path: `${target.pathname}${target.search}`, headers };
    const req =
      mappedPort !== undefined
        ? http.request({ ...common, host: '127.0.0.1', port: mappedPort })
        : (target.protocol === 'https:' ? https : http).request({
            ...common,
            host: target.hostname.replace(/^\[|\]$/g, ''),
            port: target.port || undefined,
            // Pin the connection to the address we just checked (no second DNS answer).
            lookup: pinnedLookup(address ?? ''),
            ...options.connect,
            ...(target.protocol === 'https:' && !isIP(target.hostname.replace(/^\[|\]$/g, ''))
              ? { servername: target.hostname }
              : {}),
          });
    const timer = setTimeout(() => {
      req.destroy(
        new CaptureBlockedError('timeout', `${target.host} took too long to answer.`, url),
      );
    }, timeoutMs);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(
        error instanceof CaptureBlockedError
          ? error
          : new CaptureBlockedError('network', `We couldn't reach ${target.host}.`, url),
      );
    });
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(
            new CaptureBlockedError(
              'bad-response',
              `${target.host} sent a page that is too large.`,
              url,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(timer);
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({ status: res.statusCode ?? 0, headers: out, bytes: Buffer.concat(chunks) });
      });
      res.on('error', () => {
        clearTimeout(timer);
        reject(new CaptureBlockedError('network', `We couldn't reach ${target.host}.`, url));
      });
    });
    req.end();
  });
}

/** `pinnedRequest` as a GET with a text body. Same caveats. */
export async function pinnedGet(
  ctx: NetContext,
  url: string,
  address: string | null,
  connect: { autoSelectFamily?: boolean } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const res = await pinnedRequest(ctx, url, address, { connect });
  return { status: res.status, headers: res.headers, body: res.bytes.toString('utf8') };
}

/**
 * GET `url`, following redirects by hand so every hop (and so the final URL) passes consent,
 * robots and address checks. A redirect that leaves the consented origin or path is refused.
 */
export async function guardedFetch(
  ctx: NetContext,
  url: string,
  options: GuardedFetchOptions = {},
): Promise<GuardedResponse> {
  const kind = options.kind ?? 'page';
  const chain: string[] = [];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let address: string | null;
    try {
      address = await checkUrl(ctx, current, kind);
    } catch (error) {
      if (hop > 0 && isConsentError(error)) {
        throw new CaptureBlockedError(
          'redirect-refused',
          `${new URL(url).pathname} redirected somewhere we don't have permission to scan (${new URL(current).host}), so we stopped.`,
          current,
        );
      }
      throw error;
    }
    chain.push(current);
    const res = await pinnedGet(ctx, current, address);
    const location = res.headers['location'];
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        current = new URL(location, current).href;
      } catch {
        throw new CaptureBlockedError('bad-response', 'The site sent a broken redirect.', current);
      }
      continue;
    }
    return { url: current, status: res.status, headers: res.headers, body: res.body, chain };
  }
  throw new CaptureBlockedError(
    'too-many-redirects',
    `${new URL(url).pathname} redirected too many times, so we stopped.`,
    url,
  );
}

function isConsentError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false;
  return ['cross-origin', 'outside-path', 'bad-url'].includes(String(error.code));
}

// ---------------------------------------------------------------------------------------------
// Browser path (M1 T9)
// ---------------------------------------------------------------------------------------------

/** What `launchCaptureBrowser` needs from Playwright's `chromium`. Injectable for tests. */
export interface BrowserLauncher {
  launch(options: { headless?: boolean; args?: string[] }): Promise<Browser>;
}

const launchedBrowsers = new WeakSet<object>();
const guardedContexts = new WeakSet<object>();

async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 1;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Launch Chromium for capture. The flags contain traffic that `context.route` can't see:
 * - `--host-resolver-rules="MAP * ~NOTFOUND"`: Chromium resolves no name itself (every request is
 *   fulfilled from Node), which also kills dns-prefetch and preconnect to named hosts.
 * - `--proxy-server` at a closed loopback port with `<-loopback>`: any connection Chromium tries
 *   on its own, loopback included, fails.
 * - WebRTC non-proxied UDP disabled, DNS prefetch and prerender off.
 * Only browsers launched here are accepted by `newGuardedContext`.
 */
export async function launchCaptureBrowser(
  options: { headless?: boolean; launcher?: BrowserLauncher } = {},
): Promise<Browser> {
  const port = await closedLoopbackPort();
  const browser = await (options.launcher ?? chromium).launch({
    headless: options.headless ?? true,
    args: [
      '--host-resolver-rules=MAP * ~NOTFOUND',
      `--proxy-server=http://127.0.0.1:${port}`,
      '--proxy-bypass-list=<-loopback>',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--dns-prefetch-disable',
      '--disable-features=Prerender2,NetworkPrediction',
      '--no-pings',
    ],
  });
  launchedBrowsers.add(browser);
  return browser;
}

/** Structural slices of Playwright's `Request`, `Route` and `WebSocketRoute`, so tests can fake them. */
export interface GuardRequest {
  url(): string;
  method(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
  frame(): { parentFrame(): unknown; page(): object };
  headers(): Record<string, string>;
}
export interface GuardRoute {
  request(): GuardRequest;
  fulfill(options: {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
  /** Passes the request to the next route handler (the fixture lockdown policy). Fixture mode only. */
  fallback(): Promise<void>;
}
export interface GuardWebSocketRoute {
  url(): string;
  close(options?: { code?: number; reason?: string }): Promise<void>;
}
export interface GuardableContext {
  route(
    url: string | RegExp,
    handler: (route: GuardRoute) => Promise<void> | void,
  ): Promise<unknown>;
  routeWebSocket(
    url: string | RegExp,
    handler: (ws: GuardWebSocketRoute) => Promise<void> | void,
  ): Promise<unknown>;
}

export type GuardBlockReason =
  | 'unsupported-scheme'
  | 'no-consent'
  | 'method'
  | 'iframe'
  | 'redirect'
  | 'unexpected-navigation'
  | 'tracker'
  | 'refused'
  | 'failed'
  | 'websocket';

export interface GuardLogEntry {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  /** `fallback`: fixture mode only, an unmapped third-party host handed to the lockdown policy. */
  readonly action: 'fulfilled' | 'blocked' | 'fallback';
  readonly reason?: GuardBlockReason;
  /** The error code (e.g. `no-consent`, `cross-origin`, `private-address`) behind a `refused` block. */
  readonly code?: string;
}

/** Per-page navigation bookkeeping. Nothing here is shared between pages. */
export interface PageNavState {
  /** Main-frame redirects stopped by the guard: requested URL -> target (both hash-free `.href`). */
  readonly redirects: ReadonlyMap<string, string>;
  /** Main-frame navigations the guard refused during the current `guardedGoto` hop. */
  readonly refusals: readonly { readonly url: string; readonly error: Error }[];
  /** Main-frame navigations nobody asked for (meta refresh, `Refresh` header, JS, clicks). */
  readonly unexpected: readonly string[];
}

export interface RequestGuard {
  /** Every request seen, in order. */
  readonly log: readonly GuardLogEntry[];
  pageState(page: object): PageNavState;
}

interface MutablePageState {
  expected: string | undefined;
  redirects: Map<string, string>;
  refusals: { url: string; error: Error }[];
  unexpected: string[];
}

interface GuardState extends RequestGuard {
  log: GuardLogEntry[];
  pages: WeakMap<object, MutablePageState>;
}

const guards = new WeakMap<object, GuardState>();

/** The guard on `context`, if it was made by `newGuardedContext`. */
export function requestGuardFor(context: object): RequestGuard | undefined {
  return guardedContexts.has(context) ? guards.get(context) : undefined;
}

function pageOf(state: GuardState, page: object): MutablePageState {
  let ps = state.pages.get(page);
  if (!ps) {
    ps = { expected: undefined, redirects: new Map(), refusals: [], unexpected: [] };
    state.pages.set(page, ps);
  }
  return ps;
}

/** Hash-free `.href`: the one form used as a key and for lookups. */
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

/**
 * Tell the guard that `page` is about to navigate its main frame to `url` (one request). Used by
 * `guardedGoto`, and only by it: any other main-frame navigation is refused and recorded.
 */
export function armNavigation(guard: RequestGuard, page: object, url: string): void {
  const ps = pageOf(guard as GuardState, page);
  ps.redirects.delete(normalizeUrl(url));
  ps.refusals.length = 0;
  ps.expected = normalizeUrl(url);
}

function disarmNavigation(guard: RequestGuard, page: object): void {
  pageOf(guard as GuardState, page).expected = undefined;
}

const DROPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'set-cookie',
  'set-cookie2',
  // Headers that make Chromium open connections or switch protocol on its own.
  'link',
  'alt-svc',
  'upgrade',
  'te',
  'trailer',
  'proxy-authenticate',
  'proxy-connection',
]);

function frameOf(req: GuardRequest): { main: boolean; page: object | undefined } {
  try {
    const frame = req.frame();
    return { main: frame.parentFrame() === null, page: frame.page() };
  } catch {
    return { main: false, page: undefined }; // worker request with no frame: a subresource
  }
}

/** Fails closed unless the project's consent record is present and well formed. */
function assertConsentRecord(project: Project): void {
  const scope = (project?.consent as { scope?: { origin?: unknown } } | undefined)?.scope;
  const origin = typeof scope?.origin === 'string' ? scope.origin : '';
  assertCrawlAllowed(withoutPathPrefix(project), origin, { pagesCrawledSoFar: 0 });
}

/**
 * Install the request guard on `context`. Internal to this module's callers: production code gets
 * a context only from `newGuardedContext`, and `guardedGoto` refuses any other. Not exported from
 * the package index.
 *
 * Every http(s) request is checked and then served with `route.fulfill` from `pinnedRequest`
 * (address checked once, connection pinned to that address), so the browser makes no connection
 * of its own and a DNS answer that changes between check and connect can't be used. Only a
 * non-production `.test` host in `fixtureHostMap` is served from loopback instead of the network.
 *
 * - Main-frame navigations: only the one `guardedGoto` armed for that page. Anything else (meta
 *   refresh, `Refresh` header, script, click) is refused and recorded. A redirect is never shown
 *   to Chromium; the target is handed to `guardedGoto`, which checks it and navigates again.
 * - Subframe navigations (iframes): aborted. Their `src` is recorded by the page capture.
 * - Other subresources, any origin (workers included): consent, tracker list and address check.
 *   Fonts and images load. Redirects are followed here, every hop checked.
 * - Fixture mode (non-production with `fixtureHostMap`): a subresource on an unmapped, non-IP
 *   host is never resolved or fetched by us. It goes to the next route (the T4 lockdown policy).
 * - Only GET and HEAD. WebSockets are closed without connecting.
 *
 * State is per page, so several pages in one context don't share redirect or refusal records.
 */
export async function installRequestGuard(
  context: GuardableContext,
  ctx: NetContext,
): Promise<RequestGuard> {
  const state: GuardState = {
    log: [],
    pages: new WeakMap(),
    pageState: (page) => pageOf(state, page),
  };
  guards.set(context, state);

  const block = async (
    route: GuardRoute,
    reason: GuardBlockReason,
    error?: Error,
  ): Promise<void> => {
    const req = route.request();
    state.log.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      action: 'blocked',
      reason,
      ...(error && 'code' in error ? { code: String(error.code) } : {}),
    });
    const { main, page } = frameOf(req);
    if (error && main && page && req.isNavigationRequest()) {
      pageOf(state, page).refusals.push({ url: req.url(), error });
    }
    await route.abort('blockedbyclient').catch(() => undefined);
  };

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return block(route, 'unsupported-scheme');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return block(route, 'unsupported-scheme');
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return block(route, 'method');

    const isNavigation = req.isNavigationRequest();
    const { main, page } = frameOf(req);
    if (isNavigation && !main) return block(route, 'iframe');
    if (isNavigation) {
      const ps = page ? pageOf(state, page) : undefined;
      if (!ps || ps.expected !== normalizeUrl(url)) {
        ps?.unexpected.push(url);
        return block(route, 'unexpected-navigation');
      }
      ps.expected = undefined; // one request per armed navigation
    }
    const ps = isNavigation && page ? pageOf(state, page) : undefined;
    const fixtureMode = !isProduction(ctx) && ctx.fixtureHostMap !== undefined;

    // Chromium must never see a 3xx: it would follow the next hop itself, and Playwright does not
    // route that request. A main-frame redirect is recorded and answered with a blank 200;
    // `guardedGoto` checks the target and navigates again. (An abort would leave Chromium on an
    // error page that breaks the next goto.) A subresource redirect is followed here, every hop
    // checked, and the final response is served for the original URL.
    let current = url;
    let res: PinnedResponse | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let address: string | null;
      try {
        const project = await ctx.getProject();
        const target = new URL(current);
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          return block(route, 'unsupported-scheme');
        }
        if (isNavigation) {
          address = await checkUrl(ctx, current, 'page');
        } else {
          assertConsentRecord(project);
          if (isTrackerHost(target.hostname)) return block(route, 'tracker');
          if (fixtureMode && fixturePortFor(ctx, target.hostname) === undefined) {
            // Never resolve or connect to an unmapped host from Node in a fixture run.
            const bare = target.hostname.replace(/^\[|\]$/g, '');
            if (hop > 0 || isIP(bare) || bare.toLowerCase() === 'localhost') {
              return block(route, 'refused');
            }
            state.log.push({
              url: current,
              method: req.method(),
              resourceType: req.resourceType(),
              action: 'fallback',
            });
            await route.fallback();
            return;
          }
          address = await assertPublicHost(ctx, current);
        }
      } catch (error) {
        return block(route, 'refused', error instanceof Error ? error : new Error(String(error)));
      }
      try {
        const accept = req.headers()['accept'];
        const lang = req.headers()['accept-language'];
        const referer = req.headers()['referer'];
        res = await pinnedRequest(ctx, current, address, {
          method: req.method() as 'GET' | 'HEAD',
          maxBytes: MAX_SUBRESOURCE_BYTES,
          headers: {
            ...(accept ? { Accept: accept } : {}),
            ...(lang ? { 'Accept-Language': lang } : {}),
            ...(referer ? { Referer: referer } : {}),
          },
        });
      } catch (error) {
        return block(route, 'failed', error instanceof Error ? error : new Error(String(error)));
      }
      const location = res.headers['location'];
      if (!(res.status >= 300 && res.status < 400 && location)) break;
      let next: string;
      try {
        next = new URL(location, current).href;
      } catch {
        return block(route, 'failed');
      }
      if (isNavigation && ps) {
        ps.redirects.set(normalizeUrl(current), normalizeUrl(next));
        state.log.push({
          url: current,
          method: req.method(),
          resourceType: req.resourceType(),
          action: 'blocked',
          reason: 'redirect',
        });
        await route
          .fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.alloc(0) })
          .catch(() => undefined);
        return;
      }
      current = next;
      res = undefined;
    }
    if (!res) return block(route, 'failed');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (!DROPPED_RESPONSE_HEADERS.has(k.toLowerCase())) headers[k] = v;
    }
    state.log.push({
      url: current,
      method: req.method(),
      resourceType: req.resourceType(),
      action: 'fulfilled',
    });
    await route
      .fulfill({
        status: res.status,
        headers,
        body: req.method() === 'HEAD' ? Buffer.alloc(0) : res.bytes,
      })
      .catch(() => undefined);
  });

  await context.routeWebSocket(/.*/, async (ws) => {
    state.log.push({
      url: ws.url(),
      method: 'GET',
      resourceType: 'websocket',
      action: 'blocked',
      reason: 'websocket',
    });
    // connectToServer() is never called, so no connection is made.
    await ws.close({ code: 1008, reason: 'Blocked by capture' });
  });

  return state;
}

export interface GuardedContextOptions {
  contextOptions?: Omit<BrowserContextOptions, 'serviceWorkers'>;
  /**
   * Fixture runs only (ignored in production and without `fixtureHostMap`): build the context
   * yourself, e.g. with `newLockedDownContext`, so its lockdown policy sits below the guard. The
   * options passed in include `serviceWorkers: 'block'`; the guard is installed on what you return.
   */
  fixtureContextFactory?: (
    browser: Browser,
    options: BrowserContextOptions,
  ) => Promise<BrowserContext>;
}

const NO_WEBRTC = `
  for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
    try { Object.defineProperty(window, k, { value: undefined, configurable: false }); } catch (e) {}
  }`;

/**
 * The only way to get a context for capture. Requires a browser from `launchCaptureBrowser`.
 * Service workers are blocked, WebRTC is removed from pages, popups are closed, and the request
 * guard is installed before anyone can navigate.
 */
export async function newGuardedContext(
  browser: Browser,
  ctx: NetContext,
  options: GuardedContextOptions = {},
): Promise<BrowserContext> {
  if (!launchedBrowsers.has(browser)) {
    throw new Error('newGuardedContext needs a browser from launchCaptureBrowser().');
  }
  const contextOptions: BrowserContextOptions = {
    ...options.contextOptions,
    serviceWorkers: 'block',
    userAgent: CRAWLER_USER_AGENT,
  };
  const factory =
    !isProduction(ctx) && ctx.fixtureHostMap !== undefined
      ? options.fixtureContextFactory
      : undefined;
  const context = factory
    ? await factory(browser, contextOptions)
    : await browser.newContext(contextOptions);
  try {
    await installRequestGuard(context, ctx);
    await context.addInitScript(NO_WEBRTC);
    // A popup is another main frame we didn't ask for. Its requests are refused by the guard
    // (nothing arms it); this closes it as well.
    context.on('page', (page) => {
      void page
        .opener()
        .then((opener) => (opener ? page.close() : undefined))
        .catch(() => undefined);
    });
    guardedContexts.add(context);
    return context;
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

/** The slice of a Playwright `Page` that guardedGoto needs. */
export interface GotoPage {
  goto(
    url: string,
    options: { timeout: number; waitUntil: 'domcontentloaded' | 'load' | 'networkidle' },
  ): Promise<{ url(): string; status(): number; headers(): Record<string, string> } | null>;
  url(): string;
  /** The page's context; it must come from `newGuardedContext`. */
  context(): object;
}

export interface GuardedGotoResult {
  readonly finalUrl: string;
  readonly status: number;
  /** Response headers of the final main-frame response (lower-case names). */
  readonly headers: Readonly<Record<string, string>>;
  /** Main-frame URLs requested during this navigation, in order, ending with the final one. */
  readonly chain: readonly string[];
}

function refusedRedirect(url: string, at: string): CaptureBlockedError {
  return new CaptureBlockedError(
    'redirect-refused',
    `${new URL(url).pathname} redirected somewhere we don't have permission to scan (${new URL(at).host}), so we stopped.`,
    at,
  );
}

/**
 * Navigate a Playwright page. The page's context must come from `newGuardedContext`. The guard
 * stops every main-frame redirect before Chromium can follow it; this function then checks the
 * target (consent, origin, path, robots, address) and navigates again, so no hop is requested
 * before it has passed. It arms exactly one navigation at a time: anything the page does later on
 * its own is refused (see `PageNavState.unexpected`), and `capturePage` fails on it. A guard
 * refusal becomes the matching plain-English error. The caller must discard the page content if
 * this throws.
 */
export async function guardedGoto(
  ctx: NetContext,
  page: GotoPage,
  url: string,
): Promise<GuardedGotoResult> {
  const context = page.context();
  const guard = guardedContexts.has(context) ? guards.get(context) : undefined;
  if (!guard) {
    throw new Error(
      'guardedGoto needs a page from a context made by newGuardedContext (with a browser from launchCaptureBrowser).',
    );
  }
  await checkUrl(ctx, url, 'page');
  const ps = guard.pageState(page);
  (ps.unexpected as string[]).length = 0;
  const chain: string[] = [];
  let current = normalizeUrl(url);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (hop > 0) {
        try {
          await checkUrl(ctx, current, 'page');
        } catch (error) {
          if (isConsentError(error)) throw refusedRedirect(url, current);
          throw error;
        }
      }
      chain.push(current);
      armNavigation(guard, page, current);
      let response: Awaited<ReturnType<GotoPage['goto']>>;
      try {
        response = await page.goto(current, {
          timeout: ctx.timeoutMs ?? NAVIGATION_TIMEOUT_MS,
          waitUntil: 'domcontentloaded',
        });
      } catch (error) {
        const refusal = ps.refusals[0];
        if (refusal) {
          if (refusal.error instanceof CaptureBlockedError) throw refusal.error;
          if (refusal.error instanceof GuardError || isConsentError(refusal.error)) {
            throw refusedRedirect(url, refusal.url);
          }
          throw refusal.error;
        }
        if (error instanceof Error && /timeout/i.test(error.message)) {
          throw new CaptureBlockedError(
            'timeout',
            `${new URL(url).host} took too long to load.`,
            url,
          );
        }
        throw new CaptureBlockedError('network', `We couldn't load ${new URL(url).host}.`, url);
      }
      const next = ps.redirects.get(current);
      if (next !== undefined) {
        current = next;
        continue;
      }
      const finalUrl = response?.url() ?? page.url();
      try {
        await checkUrl(ctx, finalUrl, 'page');
      } catch (error) {
        if (isConsentError(error)) throw refusedRedirect(url, finalUrl);
        throw error;
      }
      return {
        finalUrl,
        status: response?.status() ?? 0,
        headers: response?.headers() ?? {},
        chain,
      };
    }
    throw new CaptureBlockedError(
      'too-many-redirects',
      `${new URL(url).pathname} redirected too many times, so we stopped.`,
      url,
    );
  } finally {
    disarmNavigation(guard, page);
  }
}
