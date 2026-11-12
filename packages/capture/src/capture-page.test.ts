/**
 * Page capture against real Chromium on loopback (M1 T9). Needs Chromium for Playwright 1.65:
 * `pnpm --filter @srs/evals exec playwright install chromium`. The browser never touches a
 * network: the request guard serves everything from the loopback fixture servers.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, newLockedDownContext, type FixtureServer } from '@srs/evals/fixtures';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  capturePage,
  isBotChallenge,
  pngSize,
  type CapturePageResult,
  type Storage,
} from './capture-page';
import { CaptureBlockedError } from './errors';
import {
  guardedGoto,
  launchCaptureBrowser,
  newGuardedContext,
  requestGuardFor,
  type NetContext,
  type RequestGuard,
} from './net';
import { ALLOW_ALL } from './robots';
import {
  projectFor,
  startConnectionCounter,
  startSite,
  startUpgradeCounter,
  stubHttps,
  type TestSite,
} from './test-support';

const SITES = path.resolve(fileURLToPath(import.meta.url), '../../../../evals/fixtures/sites');
const FAST = { networkIdleCapMs: 3000, settleMs: 100, placeholderCapMs: 4000, pageCapMs: 40_000 };

let browser: Browser;
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});
beforeAll(async () => {
  try {
    browser = await launchCaptureBrowser();
  } catch (err) {
    throw new Error(
      `Chromium for Playwright isn't installed. Run: pnpm --filter @srs/evals exec playwright install chromium\n${String(err)}`,
    );
  }
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

function memoryStorage() {
  const puts: { path: string; bytes: number; contentType: string }[] = [];
  const storage: Storage = {
    put: async (p, data, contentType) => {
      puts.push({
        path: p,
        bytes: typeof data === 'string' ? data.length : data.byteLength,
        contentType,
      });
      return { storagePath: `mem/${p}` };
    },
  };
  return { storage, puts };
}

let idCounter = 0;
const newId = () => `id_${++idCounter}`;
const input = (url: string) => ({ url, siteId: 'site_1', captureRunId: 'run_1', pageId: 'page_1' });

interface Rig {
  ctx: NetContext;
  context: BrowserContext;
  guard: RequestGuard;
  escaped: readonly unknown[];
  blocked: readonly { url: string; reason: string }[];
  served: readonly { url: string }[];
}

function netCtx(origin: string, map: Record<string, number>, extra: Partial<NetContext>) {
  const project = projectFor(origin);
  return {
    getProject: () => project,
    pagesCrawledSoFar: () => 0,
    robots: ALLOW_ALL,
    fixtureHostMap: map,
    ...extra,
  } satisfies NetContext;
}

/**
 * A locked-down context (T4: sinkhole proxy, route policy) with the T9 guard on top, made by
 * `newGuardedContext` through the fixture factory. Hosts are `.test` names.
 */
async function rig(
  origin: string,
  map: Record<string, number>,
  extra: Partial<NetContext> = {},
  contextOptions: { javaScriptEnabled?: boolean } = {},
): Promise<Rig> {
  const ctx = netCtx(origin, map, extra);
  let locked: Awaited<ReturnType<typeof newLockedDownContext>> | undefined;
  const context = await newGuardedContext(browser, ctx, {
    contextOptions,
    fixtureContextFactory: async (b, options) => {
      const rest = { ...options } as Record<string, unknown>;
      delete rest.serviceWorkers;
      delete rest.proxy;
      locked = await newLockedDownContext(b, {
        contextOptions: rest as never,
        log: () => undefined,
      });
      closers.push(() => locked!.close());
      return locked.context;
    },
  });
  const guard = requestGuardFor(context)!;
  return {
    ctx,
    context,
    guard,
    escaped: locked!.escaped,
    blocked: locked!.blocked,
    served: locked!.served,
  };
}

/** A guarded context with no lockdown underneath: Chromium's own flags are the only backstop. */
async function plainRig(
  origin: string,
  map: Record<string, number>,
  extra: Partial<NetContext> = {},
): Promise<Rig> {
  const ctx = netCtx(origin, map, extra);
  const context = await newGuardedContext(browser, ctx);
  closers.push(() => context.close());
  return { ctx, context, guard: requestGuardFor(context)!, escaped: [], blocked: [], served: [] };
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

async function site(routes: Parameters<typeof startSite>[0]): Promise<TestSite> {
  const s = await startSite(routes);
  closers.push(() => s.close());
  return s;
}
const html = (body: string, head = '') => ({
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body: `<!doctype html><html><head><meta charset="utf-8"><title>T</title>${head}</head><body>${body}</body></html>`,
});

describe('capturePage: delaware fixture (T6a)', () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startFixtureServer({ root: path.join(SITES, 'delaware-valley-hardwoods') });
  });
  afterAll(() => server.close());

  it('captures the lazy feed, both screenshots, html and storage records', async () => {
    const r = await rig('http://delaware.test', { 'delaware.test': server.port });
    const { storage, puts } = memoryStorage();
    const result = await capturePage(r.ctx, r.context, input('http://delaware.test/'), {
      storage,
      newId,
      waits: FAST,
      escaped: r.escaped,
    });
    expect(result.outcome).toBe('captured');
    if (result.outcome !== 'captured') return;
    const page = result.page;
    expect(page.httpStatus).toBe(200);
    expect(page.pendingContent).toEqual([]);
    expect(page.text).toContain('Project photo 1');
    expect(page.text).not.toMatch(/Loading recent projects/);
    expect(page.html).toContain('data-loaded="true"');
    // Third-party platform assets are not fixtures here; everything else loaded through the guard.
    expect(
      r.guard.log.some(
        (e) => e.url.endsWith('/assets/feed/post-1.svg') && e.action === 'fulfilled',
      ),
    ).toBe(true);
    expect(r.escaped).toEqual([]);

    expect(pngSize(Buffer.alloc(3))).toBeUndefined();
    expect(page.screenshots.desktop).toMatchObject({
      kind: 'screenshot',
      width: 1440,
      siteId: 'site_1',
    });
    expect(page.screenshots.mobile).toMatchObject({ kind: 'screenshot', width: 390 });
    expect(page.screenshots.desktop.height).toBeGreaterThan(900);
    expect(page.htmlAsset).toMatchObject({ kind: 'document', sourceUrl: 'http://delaware.test/' });
    expect(puts.map((p) => p.path)).toEqual([
      'site_1/captures/run_1/page_1/page.html',
      'site_1/captures/run_1/page_1/desktop.png',
      'site_1/captures/run_1/page_1/mobile.png',
    ]);
    expect(page.screenshots.mobile.storagePath).toBe('mem/site_1/captures/run_1/page_1/mobile.png');
  }, 90_000);

  it('with the script disabled, the feed stays pending and its placeholder is kept out of the text', async () => {
    const r = await rig(
      'http://delaware.test',
      { 'delaware.test': server.port },
      {},
      { javaScriptEnabled: false },
    );
    const { storage } = memoryStorage();
    const result = await capturePage(r.ctx, r.context, input('http://delaware.test/'), {
      storage,
      newId,
      waits: { ...FAST, placeholderCapMs: 1500 },
      escaped: r.escaped,
    });
    if (result.outcome !== 'captured') throw new Error('expected capture');
    expect(result.page.pendingContent).toHaveLength(1);
    expect(result.page.pendingContent[0]).toEqual({
      selector: '#instagram-feed',
      placeholderText: 'Loading recent projects...',
    });
    expect(result.page.text).not.toContain('Loading recent projects');
    expect(result.page.text).toContain('Excellence in Wooden Floors');
    // Saved HTML is the page as served; only the extracted text drops the placeholder.
    expect(result.page.html).toContain('Loading recent projects...');
  }, 90_000);

  it('calls afterViewport once per viewport with the live page', async () => {
    const r = await rig('http://delaware.test', { 'delaware.test': server.port });
    const seen: [string, number][] = [];
    await capturePage(r.ctx, r.context, input('http://delaware.test/contact'), {
      storage: memoryStorage().storage,
      newId,
      waits: FAST,
      afterViewport: async (page, name) => {
        seen.push([name, (await page.evaluate('window.innerWidth')) as number]);
      },
    });
    expect(seen).toEqual([
      ['desktop', 1440],
      ['mobile', 390],
    ]);
  }, 90_000);
});

describe('capturePage: patterns', () => {
  it('records an iframe provider origin and makes no request into it', async () => {
    const lookups: string[] = [];
    const s = await site({
      '/': html(
        '<h1>Book</h1><iframe src="https://booking.provider-example.com/widget?id=1" title="Booking"></iframe>',
      ),
    });
    const r = await rig(
      'http://book.test',
      { 'book.test': s.port },
      { lookup: async (h) => (lookups.push(h), ['93.184.216.34']) },
    );
    const result = await capturePage(r.ctx, r.context, input('http://book.test/'), {
      storage: memoryStorage().storage,
      newId,
      waits: FAST,
    });
    if (result.outcome !== 'captured') throw new Error('expected capture');
    expect(result.page.iframeSrcs).toEqual(['https://booking.provider-example.com/widget?id=1']);
    expect(new URL(result.page.iframeSrcs[0]!).origin).toBe('https://booking.provider-example.com');
    const into = r.guard.log.filter((e) => e.url.includes('booking.provider-example.com'));
    expect(into.every((e) => e.action === 'blocked' && e.reason === 'iframe')).toBe(true);
    expect(lookups).toEqual([]);
    expect(r.escaped).toEqual([]);
  }, 60_000);

  it('stops at a bot challenge and does not try to get past it', async () => {
    const s = await site({
      '/': {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
        body: '<html><head><title>Just a moment...</title></head><body>Checking</body></html>',
      },
      '/title-only': {
        status: 503,
        ...(html('<p>x</p>', '').headers && { headers: { 'content-type': 'text/html' } }),
        body: '<html><head><title>Just a moment...</title></head><body></body></html>',
      },
    });
    const r = await rig('http://challenge.test', { 'challenge.test': s.port });
    const opts = { storage: memoryStorage().storage, newId, waits: FAST };
    const byHeader = await capturePage(r.ctx, r.context, input('http://challenge.test/'), opts);
    const byTitle = await capturePage(
      r.ctx,
      r.context,
      input('http://challenge.test/title-only'),
      opts,
    );
    for (const result of [byHeader, byTitle] as CapturePageResult[]) {
      expect(result).toMatchObject({ outcome: 'blocked', reason: 'bot-challenge' });
    }
    // One request per page: no retries, no follow-ups.
    expect(s.hits).toEqual(['/', '/title-only']);
    expect(isBotChallenge({}, 'Welcome')).toBe(false);
  }, 60_000);

  it('loads third-party images, blocks trackers and private addresses', async () => {
    const cdn = await site({
      '/dot.svg': {
        headers: { 'content-type': 'image/svg+xml' },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
      },
    });
    const main = await site({
      '/': html(
        `<img src="http://cdn.test/dot.svg" alt="">
         <img src="http://10.0.0.5/secret.png" alt="">
         <img src="http://internal.example/x.png" alt="">
         <script src="https://www.googletagmanager.com/gtm.js"></script>`,
      ),
    });
    const lookups: string[] = [];
    const r = await rig(
      'http://main.test',
      { 'main.test': main.port, 'cdn.test': cdn.port },
      {
        lookup: async (h) => (
          lookups.push(h),
          h === 'internal.example' ? ['192.168.1.9'] : ['93.184.216.34']
        ),
      },
    );
    await capturePage(r.ctx, r.context, input('http://main.test/'), {
      storage: memoryStorage().storage,
      newId,
      waits: FAST,
    });
    const by = (needle: string) => r.guard.log.find((e) => e.url.includes(needle));
    expect(by('cdn.test/dot.svg')).toMatchObject({ action: 'fulfilled' });
    expect(by('10.0.0.5')).toMatchObject({ action: 'blocked', reason: 'refused' });
    // Fixture mode never resolves a name itself: it is handed to the lockdown policy instead.
    expect(by('internal.example')).toMatchObject({ action: 'fallback' });
    expect(by('googletagmanager')).toMatchObject({ action: 'blocked', reason: 'tracker' });
    expect(lookups).toEqual([]);
    expect(r.escaped).toEqual([]);
  }, 60_000);

  it('treats the lockdown sinkhole page or an escaped request as a failed navigation', async () => {
    const s = await site({
      '/': {
        status: 403,
        headers: { 'content-type': 'text/plain' },
        body: 'Blocked by fixture lockdown',
      },
      '/ok': html('<p>fine</p>'),
    });
    const r = await rig('http://sink.test', { 'sink.test': s.port });
    const opts = { storage: memoryStorage().storage, newId, waits: FAST };
    const e1 = await failure(capturePage(r.ctx, r.context, input('http://sink.test/'), opts));
    expect(e1).toBeInstanceOf(CaptureBlockedError);
    const escaped = [{ method: 'CONNECT', target: 'evil.example:443' }];
    const e2 = await failure(
      capturePage(r.ctx, r.context, input('http://sink.test/ok'), { ...opts, escaped }),
    );
    expect(e2).toBeInstanceOf(CaptureBlockedError);
  }, 60_000);

  it('never runs past the page cap', async () => {
    const s = await site({ '/': html('<p>x</p>') });
    const r = await rig('http://slow.test', { 'slow.test': s.port });
    const started = Date.now();
    const error = await failure(
      capturePage(r.ctx, r.context, input('http://slow.test/'), {
        storage: memoryStorage().storage,
        newId,
        waits: { ...FAST, settleMs: 5000, pageCapMs: 800 },
      }),
    );
    expect((error as CaptureBlockedError).code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5000);
  }, 30_000);
});

describe('request guard in Chromium (T9)', () => {
  it('aborts a redirect hop to another origin or a private address before the request leaves', async () => {
    const secret = await site({ '/secret': html('SECRET') });
    const other = await site({ '/x': html('OTHER') });
    const s = await site({
      '/to-loopback': {
        status: 302,
        headers: { location: `http://127.0.0.1:${secret.port}/secret` },
      },
      '/to-private': { status: 302, headers: { location: 'http://10.0.0.5/admin' } },
      '/to-other': { status: 302, headers: { location: 'http://other.test/x' } },
      '/chain': { status: 302, headers: { location: '/to-other' } },
    });
    const r = await rig('http://start.test', { 'start.test': s.port, 'other.test': other.port });
    for (const route of ['/to-loopback', '/to-private', '/to-other', '/chain']) {
      const page = await r.context.newPage();
      const error = await failure(guardedGoto(r.ctx, page, `http://start.test${route}`));
      expect((error as CaptureBlockedError).code).toBe('redirect-refused');
      await page.close();
    }
    expect(secret.hits).toEqual([]);
    expect(other.hits).toEqual([]);
    expect(r.escaped).toEqual([]);
    // The first hop was served (so Chromium could follow it); the second never left.
    expect(s.hits).toEqual(['/to-loopback', '/to-private', '/to-other', '/chain', '/to-other']);
  }, 60_000);

  it('follows a same-origin redirect and reports the chain', async () => {
    const s = await site({
      '/old': { status: 301, headers: { location: '/new' } },
      '/new': html('<p>new</p>'),
    });
    const r = await rig('http://hop.test', { 'hop.test': s.port });
    const page = await r.context.newPage();
    const res = await guardedGoto(r.ctx, page, 'http://hop.test/old');
    expect(res.finalUrl).toBe('http://hop.test/new');
    expect(res.chain).toEqual(['http://hop.test/old', 'http://hop.test/new']);
    expect(res.status).toBe(200);
  }, 60_000);

  it('guardedGoto refuses a real context that newGuardedContext did not make', async () => {
    // eslint-disable-next-line no-restricted-syntax -- the point of this test: a raw context
    const raw = await browser.newContext({ serviceWorkers: 'block' });
    closers.push(() => raw.close());
    const page = await raw.newPage();
    const s = await site({ '/': html('x') });
    const ctx = netCtx('http://nog.test', { 'nog.test': s.port }, {});
    await expect(guardedGoto(ctx, page, 'http://nog.test/')).rejects.toThrow(/newGuardedContext/);
    expect(s.hits).toEqual([]);
  });

  it('accepts a start URL without a trailing slash, and one with a #hash', async () => {
    const s = await site({
      '/': html('<p>home</p>'),
      '/old': { status: 301, headers: { location: '/' } },
    });
    const r = await plainRig('http://hash.test', { 'hash.test': s.port });
    const page = await r.context.newPage();
    for (const start of ['http://hash.test', 'http://hash.test/#top', 'http://hash.test/old#x']) {
      const res = await guardedGoto(r.ctx, page, start);
      expect(res.status).toBe(200);
      expect(new URL(res.finalUrl).pathname).toBe('/');
    }
  }, 60_000);

  it('a page cannot register a service worker or open a WebSocket', async () => {
    const ws = await startUpgradeCounter();
    closers.push(() => ws.close());
    const s = await site({
      '/': html(`<script>
        window.__r = { sw: 'pending', ws: 'pending', regs: null };
        if (!('serviceWorker' in navigator)) window.__r.sw = 'unavailable';
        else navigator.serviceWorker.register('/sw.js').then(() => (window.__r.sw = 'registered'), (e) => (window.__r.sw = 'rejected'));
        try {
          const sock = new WebSocket('ws://127.0.0.1:${ws.port}/live');
          sock.onopen = () => (window.__r.ws = 'open');
          sock.onclose = () => (window.__r.ws = 'closed');
          sock.onerror = () => (window.__r.ws = 'error');
        } catch (e) { window.__r.ws = 'threw'; }
      </script>`),
      '/sw.js': {
        headers: { 'content-type': 'text/javascript' },
        body: 'self.addEventListener("fetch",()=>{});',
      },
    });
    const r = await rig('https://sw.test', { 'sw.test': s.port });
    let seen: { sw: string; ws: string; regs: unknown[] } | undefined;
    await capturePage(r.ctx, r.context, input('https://sw.test/'), {
      storage: memoryStorage().storage,
      newId,
      waits: FAST,
      afterViewport: async (page, name) => {
        if (name !== 'desktop') return;
        seen = (await page.evaluate('window.__r')) as typeof seen;
        if (seen) {
          seen.regs = (await page.evaluate(
            'navigator.serviceWorker.getRegistrations().then((r) => r.map((x) => x.scope))',
          )) as unknown[];
        }
      },
    });
    // With serviceWorkers: 'block' register() may resolve with a stub, but nothing is installed:
    // the script is never fetched, no registration exists and no worker runs.
    expect(s.hits).not.toContain('/sw.js');
    expect(r.guard.log.some((e) => e.url.endsWith('/sw.js'))).toBe(false);
    expect(seen?.regs).toEqual([]);
    expect(seen?.ws).not.toBe('open');
    expect(r.context.serviceWorkers()).toHaveLength(0);
    expect(ws.upgrades).toBe(0);
    expect(r.guard.log.some((e) => e.reason === 'websocket')).toBe(true);
  }, 60_000);
});

describe('fixture lockdown stays in charge (T9)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('an unmapped third-party image is never resolved or fetched from Node; the lockdown blocks it', async () => {
    const s = await site({
      '/': html('<img src="https://static.wixstatic.com/media/logo.png" alt="logo">'),
    });
    const lookups = vi.spyOn(dns.promises, 'lookup');
    const https = stubHttps();
    // No injected lookup: a real resolver call would show up on the spy.
    const r = await rig('http://main.test', { 'main.test': s.port });
    await capturePage(r.ctx, r.context, input('http://main.test/'), {
      storage: memoryStorage().storage,
      newId,
      waits: FAST,
      escaped: r.escaped,
    });
    expect(lookups).not.toHaveBeenCalled();
    expect(https.calls).toHaveLength(0);
    expect(r.guard.log.some((e) => e.url.includes('wixstatic') && e.action === 'fallback')).toBe(
      true,
    );
    const handled = [...r.blocked, ...r.served].filter((e) => e.url.includes('wixstatic'));
    expect(handled.length).toBeGreaterThanOrEqual(1);
    expect(r.escaped).toEqual([]);
  }, 60_000);

  it('a real escape (a preconnect hint) reaches the sinkhole and fails the capture', async () => {
    const s = await site({ '/': html('<p>x</p>') });
    // Preconnect hints are suppressed by the capture flags and are only best-effort in Chromium,
    // so make the escape deterministic: a request sent through the context's own HTTP client,
    // which no route sees. It must end on the sinkhole, and the capture must fail.
    const unflagged = browser;
    const ctx = netCtx('http://leaky.test', { 'leaky.test': s.port }, {});
    let locked: Awaited<ReturnType<typeof newLockedDownContext>> | undefined;
    const context = await newGuardedContext(unflagged, ctx, {
      fixtureContextFactory: async (b) => {
        locked = await newLockedDownContext(b, { log: () => undefined });
        return locked.context;
      },
    });
    const error = await failure(
      capturePage(ctx, context, input('http://leaky.test/'), {
        storage: memoryStorage().storage,
        newId,
        waits: { ...FAST, settleMs: 100 },
        escaped: locked!.escaped,
        afterViewport: async (page, name) => {
          if (name !== 'desktop') return;
          // eslint-disable-next-line no-restricted-syntax -- test-only: a deliberate escape
          await page
            .context()
            .request.get('https://escape.example/', { timeout: 3000 })
            .catch(() => undefined);
        },
      }),
    );
    expect(locked!.escaped.length).toBeGreaterThan(0);
    expect(error).toBeInstanceOf(CaptureBlockedError);
  }, 60_000);
});

describe('traffic routing cannot see (T9)', () => {
  const rtcScript = (udp: number, tcp: number) => `
    try {
      const pc = new RTCPeerConnection({ iceServers: [
        { urls: 'stun:127.0.0.1:${udp}' },
        { urls: 'turn:127.0.0.1:${tcp}?transport=tcp', username: 'u', credential: 'p' },
      ] });
      pc.createDataChannel('x');
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {});
      window.__rtc = 'created';
    } catch (e) { window.__rtc = 'unavailable'; }`;

  async function udpCounter() {
    const socket = dgram.createSocket('udp4');
    let packets = 0;
    socket.on('message', () => (packets += 1));
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    closers.push(async () => socket.close());
    return { port: socket.address().port, packets: () => packets };
  }

  it('the counters are live (positive control)', async () => {
    const tcp = await startConnectionCounter();
    closers.push(() => tcp.close());
    await tcp.poke();
    expect(tcp.connections).toBe(1);
  });

  it('preconnect, dns-prefetch, a Link preconnect header and WebRTC open no connection', async () => {
    const tcp = await startConnectionCounter();
    closers.push(() => tcp.close());
    const udp = await udpCounter();
    const target = `http://127.0.0.1:${tcp.port}`;
    const s = await site({
      '/': {
        headers: {
          'content-type': 'text/html',
          link: `<${target}>; rel=preconnect, <${target}/p.js>; rel=preload; as=script`,
        },
        body: `<!doctype html><html><head><title>t</title>
          <link rel="preconnect" href="${target}">
          <link rel="dns-prefetch" href="${target}">
          <link rel="prefetch" href="${target}/next.html">
          <script>${rtcScript(udp.port, tcp.port)}</script></head><body><p>hello</p></body></html>`,
      },
    });
    const r = await plainRig('http://contain.test', { 'contain.test': s.port });
    let rtc: string | undefined;
    await capturePage(r.ctx, r.context, input('http://contain.test/'), {
      storage: memoryStorage().storage,
      newId,
      waits: { ...FAST, settleMs: 800 },
      afterViewport: async (page, name) => {
        if (name === 'desktop') rtc = (await page.evaluate('window.__rtc')) as string;
      },
    });
    expect(rtc).toBe('unavailable');
    expect(tcp.connections).toBe(0);
    expect(udp.packets()).toBe(0);
  }, 60_000);

  it('the launch flags alone contain preconnect and WebRTC, even with no guard at all', async () => {
    const tcp = await startConnectionCounter();
    closers.push(() => tcp.close());
    const udp = await udpCounter();
    // eslint-disable-next-line no-restricted-syntax -- deliberately unguarded: tests the flags only
    const raw = await browser.newContext();
    closers.push(() => raw.close());
    const page = await raw.newPage();
    await page.setContent(`<link rel="preconnect" href="http://127.0.0.1:${tcp.port}">
      <link rel="dns-prefetch" href="http://127.0.0.1:${tcp.port}">
      <script>${rtcScript(udp.port, tcp.port)}</script>`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await page.evaluate('window.__rtc')).toBe('created');
    expect(tcp.connections).toBe(0);
    expect(udp.packets()).toBe(0);
  }, 60_000);

  it('a dedicated Worker cannot fetch or open a WebSocket past the guard', async () => {
    const ws = await startUpgradeCounter();
    closers.push(() => ws.close());
    const tcp = await startConnectionCounter();
    closers.push(() => tcp.close());
    const s = await site({
      '/': html(`<script>window.__w = 'none'; const w = new Worker('/w.js');
        w.onmessage = (e) => (window.__w = e.data);</script>`),
      '/w.js': {
        headers: { 'content-type': 'text/javascript' },
        body: `
          const out = {};
          fetch('http://127.0.0.1:${tcp.port}/secret').then(() => (out.fetch = 'ok'), () => (out.fetch = 'blocked'))
            .then(() => {
              try {
                const s = new WebSocket('ws://127.0.0.1:${ws.port}/live');
                s.onopen = () => (out.ws = 'open');
              } catch (e) { out.ws = 'threw'; }
              setTimeout(() => postMessage(out), 500);
            });`,
      },
    });
    const r = await plainRig('http://work.test', { 'work.test': s.port });
    let seen: { fetch?: string; ws?: string } | string | undefined;
    await capturePage(r.ctx, r.context, input('http://work.test/'), {
      storage: memoryStorage().storage,
      newId,
      waits: { ...FAST, settleMs: 1500 },
      afterViewport: async (page, name) => {
        if (name === 'desktop') seen = (await page.evaluate('window.__w')) as typeof seen;
      },
    });
    expect(typeof seen === 'object' ? seen.fetch : seen).not.toBe('ok');
    expect(typeof seen === 'object' ? seen.ws : seen).not.toBe('open');
    expect(tcp.connections).toBe(0);
    expect(ws.upgrades).toBe(0);
  }, 60_000);
});

describe('navigations after guardedGoto returns (T9)', () => {
  const cases: [string, string, string | undefined, string][] = [
    [
      'meta refresh, same origin',
      '<meta http-equiv="refresh" content="0;url=/other">',
      undefined,
      '',
    ],
    [
      'meta refresh, cross origin',
      '<meta http-equiv="refresh" content="0;url=http://other.test/x">',
      undefined,
      '',
    ],
    ['Refresh header, same origin', '', '0; url=/other', ''],
    ['Refresh header, cross origin', '', '0; url=http://other.test/x', ''],
    [
      'script navigation, same origin',
      '',
      undefined,
      '<script>setTimeout(() => (location.href = "/other"), 50)</script>',
    ],
    [
      'script navigation, cross origin',
      '',
      undefined,
      '<script>setTimeout(() => (location.href = "http://other.test/x"), 50)</script>',
    ],
    ['popup', '', undefined, '<script>setTimeout(() => window.open("/other"), 50)</script>'],
    [
      'click',
      '',
      undefined,
      '<a id="go" href="/other">go</a><script>setTimeout(() => document.getElementById("go").click(), 50)</script>',
    ],
  ];

  it.each(cases)(
    '%s never produces captured content',
    async (_name, head, refresh, body) => {
      const other = await site({ '/x': html('OTHER') });
      const s = await site({
        '/': {
          headers: { 'content-type': 'text/html', ...(refresh ? { Refresh: refresh } : {}) },
          body: `<!doctype html><html><head><title>Start</title>${head}</head><body><p>start</p>${body}</body></html>`,
        },
        '/other': html('<p>OTHER SAME</p>'),
      });
      const r = await plainRig('http://nav.test', { 'nav.test': s.port, 'other.test': other.port });
      const error = await failure(
        capturePage(r.ctx, r.context, input('http://nav.test/'), {
          storage: memoryStorage().storage,
          newId,
          waits: { ...FAST, settleMs: 700 },
        }),
      );
      expect(error).toBeInstanceOf(CaptureBlockedError);
      expect(s.hits).not.toContain('/other');
      expect(other.hits).toEqual([]);
    },
    60_000,
  );
});
