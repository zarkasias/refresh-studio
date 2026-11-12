/**
 * The guarded network path (M1 T8; CLAUDE.md rules 5 and 6). `guardedFetch` and `guardedGoto` are
 * the only functions in packages/capture and packages/audit allowed to touch the network; ESLint
 * bans `fetch(`, `page.goto(`, `*.request.*(` and friends, and the HTTP client modules, everywhere
 * else.
 *
 * Every call: reads the project fresh, runs `assertCrawlAllowed`, checks robots.txt and blocks
 * loopback/private addresses after DNS resolution. `guardedFetch` follows redirects by hand, so
 * every hop is checked. `guardedGoto` checks the target before navigating and the final URL after;
 * it does not see intermediate redirect hops or page subresources, because Playwright makes those
 * requests itself. Request-level route guarding for the browser lands in T9.
 *
 * Exception (ADR-010): outside production, a `*.test` hostname listed in `fixtureHostMap` is
 * served from a loopback port, skipping the address block. Nothing else is exempt.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { assertCrawlAllowed, type Project } from '@srs/site-model';
import { isPrivateAddress, isTestHostname } from './address';
import { CaptureBlockedError } from './errors';
import { CRAWLER_USER_AGENT } from './identity';
import type { RobotsPolicy } from './robots';

export const NAVIGATION_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

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

/**
 * One GET with no redirect handling, connected to `address` (already checked by the caller) or to
 * the fixture port. Internal: it does no address check itself, so it is not re-exported from the
 * package index. Use `guardedFetch`.
 */
export function pinnedGet(
  ctx: NetContext,
  url: string,
  address: string | null,
  connect: { autoSelectFamily?: boolean } = {},
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const target = new URL(url);
  const mappedPort = fixturePortFor(ctx, target.hostname);
  const timeoutMs = ctx.timeoutMs ?? NAVIGATION_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': CRAWLER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'identity',
      Host: target.host,
    };
    const common = { method: 'GET', path: `${target.pathname}${target.search}`, headers };
    const req =
      mappedPort !== undefined
        ? http.request({ ...common, host: '127.0.0.1', port: mappedPort })
        : (target.protocol === 'https:' ? https : http).request({
            ...common,
            host: target.hostname.replace(/^\[|\]$/g, ''),
            port: target.port || undefined,
            // Pin the connection to the address we just checked (no second DNS answer).
            lookup: pinnedLookup(address ?? ''),
            ...connect,
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
        if (size > MAX_BODY_BYTES) {
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
        resolve({
          status: res.statusCode ?? 0,
          headers: out,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', () => {
        clearTimeout(timer);
        reject(new CaptureBlockedError('network', `We couldn't reach ${target.host}.`, url));
      });
    });
    req.end();
  });
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

/** The slice of a Playwright `Page` that guardedGoto needs. */
export interface GotoPage {
  goto(
    url: string,
    options: { timeout: number; waitUntil: 'domcontentloaded' | 'load' | 'networkidle' },
  ): Promise<{ url(): string; status(): number } | null>;
  url(): string;
}

export interface GuardedGotoResult {
  readonly finalUrl: string;
  readonly status: number;
}

/**
 * Navigate a Playwright page. Checks the target first, and the final URL after redirects
 * (Playwright follows redirects itself, so the final check is the one that catches them; the
 * caller must discard the page content if this throws).
 */
export async function guardedGoto(
  ctx: NetContext,
  page: GotoPage,
  url: string,
): Promise<GuardedGotoResult> {
  await checkUrl(ctx, url, 'page');
  const response = await page.goto(url, {
    timeout: ctx.timeoutMs ?? NAVIGATION_TIMEOUT_MS,
    waitUntil: 'domcontentloaded',
  });
  const finalUrl = response?.url() ?? page.url();
  try {
    await checkUrl(ctx, finalUrl, 'page');
  } catch (error) {
    if (isConsentError(error)) {
      throw new CaptureBlockedError(
        'redirect-refused',
        `${new URL(url).pathname} redirected somewhere we don't have permission to scan (${new URL(finalUrl).host}), so we stopped.`,
        finalUrl,
      );
    }
    throw error;
  }
  return { finalUrl, status: response?.status() ?? 0 };
}
