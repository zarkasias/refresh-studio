import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { assertCrawlAllowed, GuardError } from '@srs/site-model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPrivateAddress } from './address';
import { CaptureBlockedError } from './errors';
import {
  guardedFetch,
  guardedGoto,
  armNavigation,
  installRequestGuard,
  launchCaptureBrowser,
  newGuardedContext,
  fixturePortFor,
  pinnedGet,
  pinnedRequest,
  pinnedLookup,
  type GotoPage,
  type GuardLogEntry,
  type GuardRoute,
  type GuardWebSocketRoute,
  type NetContext,
} from './net';
import { ALLOW_ALL, parseRobots } from './robots';
import {
  projectFor,
  startHangingServer,
  startSite,
  stubHttps,
  type TestSite,
} from './test-support';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const sites: TestSite[] = [];
afterEach(async () => {
  await Promise.all(sites.splice(0).map((s) => s.close()));
});
async function site(routes: Parameters<typeof startSite>[0]) {
  const s = await startSite(routes);
  sites.push(s);
  return s;
}

function ctxFor(
  siteUrl: string,
  map: Record<string, number>,
  extra: Partial<NetContext> = {},
): NetContext {
  const project = projectFor(siteUrl);
  return {
    getProject: () => project,
    pagesCrawledSoFar: () => 0,
    robots: ALLOW_ALL,
    fixtureHostMap: map,
    ...extra,
  };
}

/**
 * A fake browser from the real `launchCaptureBrowser` (fake launcher) and a fake context from the
 * real `newGuardedContext`: nothing is routed, but `guardedGoto` accepts it.
 */
async function guardedFake(ctx: NetContext): Promise<object> {
  const context = {
    route: async () => undefined,
    routeWebSocket: async () => undefined,
    addInitScript: async () => undefined,
    on: () => undefined,
    close: async () => undefined,
  };
  const browser = await launchCaptureBrowser({
    launcher: { launch: async () => ({ newContext: async () => context }) as never },
  });
  return newGuardedContext(browser, ctx);
}

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:10.0.0.1',
    '012.0.0.1',
    '01.2.3.4',
    '::ffff:012.0.0.1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    '2001:db8::1',
    'not-an-ip',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('guardedFetch', () => {
  it('fetches a fixture-mapped .test host (non-production)', async () => {
    const s = await site({ '/': { body: 'hello' } });
    const res = await guardedFetch(
      ctxFor('https://a.test', { 'a.test': s.port }),
      'https://a.test/',
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe('hello');
  });

  it('skips a robots-disallowed path with reason robots, without requesting it', async () => {
    const s = await site({ '/private/': { body: 'secret' } });
    const robots = parseRobots('https://a.test/robots.txt', 'User-agent: *\nDisallow: /private/');
    const error = await failure(
      guardedFetch(
        ctxFor('https://a.test', { 'a.test': s.port }, { robots }),
        'https://a.test/private/',
      ),
    );
    expect(error).toBeInstanceOf(CaptureBlockedError);
    expect((error as CaptureBlockedError).code).toBe('robots');
    expect(s.hits).toEqual([]);
  });

  it('refuses a redirect to another origin', async () => {
    const a = await site({ '/': { status: 302, headers: { Location: 'https://b.test/' } } });
    const b = await site({ '/': { body: 'b' } });
    const error = await failure(
      guardedFetch(
        ctxFor('https://a.test', { 'a.test': a.port, 'b.test': b.port }),
        'https://a.test/',
      ),
    );
    expect((error as CaptureBlockedError).code).toBe('redirect-refused');
    expect(b.hits).toEqual([]);
  });

  it('refuses a redirect out of the consented path prefix', async () => {
    const a = await site({
      '/jolly/': { status: 302, headers: { Location: '/other/' } },
      '/other/': { body: 'x' },
    });
    const project = projectFor('https://a.test/jolly', { pathPrefix: '/jolly' });
    const ctx: NetContext = {
      getProject: () => project,
      pagesCrawledSoFar: () => 0,
      robots: ALLOW_ALL,
      fixtureHostMap: { 'a.test': a.port },
    };
    const error = await failure(guardedFetch(ctx, 'https://a.test/jolly/'));
    expect((error as CaptureBlockedError).code).toBe('redirect-refused');
    expect(a.hits).toEqual(['/jolly/']);
  });

  it('follows a same-origin redirect and reports the final URL', async () => {
    const a = await site({
      '/old': { status: 301, headers: { Location: '/new' } },
      '/new': { body: 'new' },
    });
    const res = await guardedFetch(
      ctxFor('https://a.test', { 'a.test': a.port }),
      'https://a.test/old',
    );
    expect(res.url).toBe('https://a.test/new');
    expect(res.chain).toEqual(['https://a.test/old', 'https://a.test/new']);
  });

  it('stops redirect loops', async () => {
    const a = await site({ '/': { status: 302, headers: { Location: '/' } } });
    const error = await failure(
      guardedFetch(ctxFor('https://a.test', { 'a.test': a.port }), 'https://a.test/'),
    );
    expect((error as CaptureBlockedError).code).toBe('too-many-redirects');
  });

  it('refuses the 26th page with GuardError page-limit', async () => {
    const s = await site({ '/': { body: 'x' } });
    const ctx = ctxFor('https://a.test', { 'a.test': s.port }, { pagesCrawledSoFar: () => 25 });
    const error = await failure(guardedFetch(ctx, 'https://a.test/'));
    expect(error).toBeInstanceOf(GuardError);
    expect((error as GuardError).code).toBe('page-limit');
    expect(s.hits).toEqual([]);
  });

  it('reads the project fresh on every call (consent withdrawn mid-run)', async () => {
    const s = await site({ '/': { body: 'x' } });
    let project: ReturnType<typeof projectFor> = projectFor('https://a.test');
    let reads = 0;
    const ctx: NetContext = {
      getProject: () => {
        reads += 1;
        return project;
      },
      pagesCrawledSoFar: () => 0,
      robots: ALLOW_ALL,
      fixtureHostMap: { 'a.test': s.port },
    };
    await guardedFetch(ctx, 'https://a.test/');
    project = { ...project, consent: undefined };
    const error = await failure(guardedFetch(ctx, 'https://a.test/'));
    expect((error as GuardError).code).toBe('no-consent');
    expect(reads).toBe(2);
  });

  it('refuses to fetch without a robots policy (fail closed)', async () => {
    const s = await site({ '/': { body: 'x' } });
    const ctx = ctxFor('https://a.test', { 'a.test': s.port }, { robots: undefined });
    expect(
      ((await failure(guardedFetch(ctx, 'https://a.test/'))) as CaptureBlockedError).code,
    ).toBe('robots');
  });

  it('times out instead of hanging', async () => {
    const hang = await startHangingServer();
    sites.push(hang);
    const error = await failure(
      guardedFetch(
        ctxFor('https://a.test', { 'a.test': hang.port }, { timeoutMs: 100 }),
        'https://a.test/',
      ),
    );
    expect((error as CaptureBlockedError).code).toBe('timeout');
  });
});

describe('pinned connection', () => {
  const lookupOnce = (address: string, options: object) =>
    new Promise<unknown>((resolve, reject) => {
      pinnedLookup(address)('ignored.example', options, (err, a, f) =>
        err ? reject(err) : resolve([a, f]),
      );
    });

  it('answers in the plain shape', async () => {
    expect(await lookupOnce('127.0.0.1', {})).toEqual(['127.0.0.1', 4]);
    expect(await lookupOnce('::1', { family: 0 })).toEqual(['::1', 6]);
  });

  it('answers in the { all: true } shape Node 22 autoSelectFamily uses', async () => {
    expect(await lookupOnce('127.0.0.1', { all: true })).toEqual([
      [{ address: '127.0.0.1', family: 4 }],
      undefined,
    ]);
    expect(await lookupOnce('::1', { all: true })).toEqual([
      [{ address: '::1', family: 6 }],
      undefined,
    ]);
  });

  // The real connect path: a made-up hostname, pinned to a loopback server. pinnedGet does no
  // address check (guardedFetch always runs one first), so the tests call it directly.
  it.each([
    ['autoSelectFamily on (lookup called with all: true)', true],
    ['autoSelectFamily off (plain lookup)', false],
  ])('connects to the pinned address with %s', async (_name, autoSelectFamily) => {
    const s = await site({ '/hello': { body: 'pinned' } });
    const ctx = ctxFor('http://pinned.example', {});
    const res = await pinnedGet(ctx, `http://pinned.example:${s.port}/hello`, '127.0.0.1', {
      autoSelectFamily,
    });
    expect(res).toMatchObject({ status: 200, body: 'pinned' });
    expect(s.hits).toEqual(['/hello']);
  });

  it('connects with the default Node options too', async () => {
    const s = await site({ '/': { body: 'default' } });
    const res = await pinnedGet(
      ctxFor('http://pinned.example', {}),
      `http://pinned.example:${s.port}/`,
      '127.0.0.1',
    );
    expect(res.body).toBe('default');
  });

  it('guardedFetch still refuses that made-up host when the resolver answers 127.0.0.1', async () => {
    const s = await site({ '/': { body: 'x' } });
    const ctx = ctxFor(
      `http://pinned.example:${s.port}`,
      {},
      { lookup: async () => ['127.0.0.1'] },
    );
    const error = await failure(guardedFetch(ctx, `http://pinned.example:${s.port}/`));
    expect((error as CaptureBlockedError).code).toBe('private-address');
    expect(s.hits).toEqual([]);
  });
});

describe('address block after DNS resolution', () => {
  const publicHost = (lookup: NetContext['lookup']) =>
    ctxFor('https://example.com', {}, { lookup });

  it.each([['10.0.0.5'], ['127.0.0.1'], ['::1'], ['169.254.169.254'], ['::ffff:192.168.0.1']])(
    'refuses a public-looking name that resolves to %s',
    async (address) => {
      const error = await failure(
        guardedFetch(
          publicHost(async () => [address]),
          'https://example.com/',
        ),
      );
      expect((error as CaptureBlockedError).code).toBe('private-address');
    },
  );

  it('refuses a mixed answer (one private address)', async () => {
    const error = await failure(
      guardedFetch(
        publicHost(async () => ['93.184.216.34', '10.0.0.5']),
        'https://example.com/',
      ),
    );
    expect((error as CaptureBlockedError).code).toBe('private-address');
  });

  it.each([
    'http://127.0.0.1:9/',
    'http://[::1]:9/',
    'http://localhost:9/',
    'http://169.254.169.254/',
  ])('refuses %s even when consent names it', async (url) => {
    const project = projectFor(url);
    const ctx: NetContext = {
      getProject: () => project,
      pagesCrawledSoFar: () => 0,
      robots: ALLOW_ALL,
      // localhost really resolves to loopback on this machine.
    };
    const error = await failure(guardedFetch(ctx, url));
    expect((error as CaptureBlockedError).code).toBe('private-address');
  });

  it('guardedGoto re-checks the final URL: a name that now resolves to a private address', async () => {
    let calls = 0;
    const lookup = async () => (++calls === 1 ? ['93.184.216.34'] : ['10.0.0.5']);
    const ctx = publicHost(lookup);
    const page: GotoPage = {
      goto: async (url) => ({ url: () => url, status: () => 200, headers: () => ({}) }),
      url: () => 'https://example.com/',
      context: () => context,
    };
    const context = await guardedFake(ctx);
    const error = await failure(guardedGoto(ctx, page, 'https://example.com/'));
    expect((error as CaptureBlockedError).code).toBe('private-address');
  });

  it('guardedGoto refuses a final URL on another origin', async () => {
    const ctx = publicHost(async () => ['93.184.216.34']);
    const context = await guardedFake(ctx);
    const page: GotoPage = {
      goto: async () => ({
        url: () => 'https://elsewhere.example/',
        status: () => 200,
        headers: () => ({}),
      }),
      url: () => 'https://elsewhere.example/',
      context: () => context,
    };
    const error = await failure(guardedGoto(ctx, page, 'https://example.com/'));
    expect((error as CaptureBlockedError).code).toBe('redirect-refused');
  });

  it('guardedGoto does not navigate when the target is robots-disallowed', async () => {
    let navigated = false;
    const robots = parseRobots('https://example.com/robots.txt', 'User-agent: *\nDisallow: /no');
    const ctx = { ...publicHost(async () => ['93.184.216.34']), robots };
    const context = await guardedFake(ctx);
    const page: GotoPage = {
      goto: async () => {
        navigated = true;
        return null;
      },
      url: () => '',
      context: () => context,
    };
    const error = await failure(guardedGoto(ctx, page, 'https://example.com/no'));
    expect((error as CaptureBlockedError).code).toBe('robots');
    expect(navigated).toBe(false);
  });
});

describe('fixture host map (ADR-010)', () => {
  const map = { 'a.test': 4000, 'evil.example': 4000, 'a.test.com': 4000 };

  it('maps a .test host outside production', () => {
    expect(fixturePortFor({ ...ctxFor('https://a.test', map), production: false }, 'a.test')).toBe(
      4000,
    );
  });

  it('is ignored in production', async () => {
    const ctx = ctxFor('https://a.test', map, {
      production: true,
      lookup: async () => ['127.0.0.1'],
    });
    expect(fixturePortFor(ctx, 'a.test')).toBeUndefined();
    const error = await failure(guardedFetch(ctx, 'https://a.test/'));
    expect((error as CaptureBlockedError).code).toBe('private-address');
  });

  it('NODE_ENV=production wins over production: false', () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(
        fixturePortFor({ ...ctxFor('https://a.test', map), production: false }, 'a.test'),
      ).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  });

  it('is ignored when NODE_ENV is production', () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(fixturePortFor(ctxFor('https://a.test', map), 'a.test')).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  });

  it.each(['evil.example', 'a.test.com', 'test', 'localhost', 'a.localhost'])(
    'is ignored for non-.test host %s',
    async (host) => {
      const ctx = ctxFor(
        `https://${host}`,
        { [host]: 4000 },
        { lookup: async () => ['127.0.0.1'] },
      );
      expect(fixturePortFor(ctx, host)).toBeUndefined();
      const error = await failure(guardedFetch(ctx, `https://${host}/`));
      expect((error as CaptureBlockedError).code).toBe('private-address');
    },
  );

  it('ignores a .test host that is not in the map', () => {
    expect(fixturePortFor(ctxFor('https://b.test', map), 'b.test')).toBeUndefined();
  });
});

describe('lint: HTTP client imports and @srs/evals', () => {
  async function lintImports(code: string, file: string) {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
      ignore: false,
    });
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
    return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports');
  }
  const banned = [
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'http',
    'https',
    'net',
    'tls',
    'undici',
    'axios',
  ];

  it.each(banned)('bans importing %s in capture and audit source and tests', async (mod) => {
    for (const file of [
      'packages/capture/src/x.ts',
      'packages/capture/src/x.test.ts',
      'packages/audit/src/x.ts',
    ]) {
      expect((await lintImports(`import m from '${mod}';\nvoid m;`, file)).length).toBe(1);
    }
  });

  it('allows them in net.ts and test-support.ts, and elsewhere in the repo', async () => {
    const code = "import http from 'node:http';\nvoid http;";
    expect(await lintImports(code, 'packages/capture/src/net.ts')).toEqual([]);
    expect(await lintImports(code, 'packages/capture/src/test-support.ts')).toEqual([]);
    expect(await lintImports(code, 'evals/fixtures/x.ts')).toEqual([]);
  });

  it('allows near misses', async () => {
    const code =
      "import a from './http';\nimport b from 'httpx';\nimport c from 'node:path';\nvoid [a, b, c];";
    expect(await lintImports(code, 'packages/capture/src/x.ts')).toEqual([]);
  });

  it('bans @srs/evals in non-test capture and audit files only', async () => {
    const code =
      "import { startFixtureServer } from '@srs/evals/fixtures';\nvoid startFixtureServer;";
    for (const file of [
      'packages/capture/src/x.ts',
      'packages/capture/src/net.ts',
      'packages/capture/src/test-support.ts',
      'packages/audit/src/x.ts',
    ]) {
      expect((await lintImports(code, file)).length).toBe(1);
    }
    expect(await lintImports(code, 'packages/capture/src/x.test.ts')).toEqual([]);
    expect(
      await lintImports("import e from '@srs/evals';\nvoid e;", 'packages/capture/src/x.ts'),
    ).toHaveLength(1);
  });

  it('still bans the fixture URL schemas in non-test capture source, and the factories everywhere', async () => {
    expect(
      await lintImports(
        "import { x } from '@srs/site-model/fixture-urls';\nvoid x;",
        'packages/capture/src/x.ts',
      ),
    ).toHaveLength(1);
    expect(
      await lintImports(
        "import { makeProjectSchemas } from '@srs/site-model';\nvoid makeProjectSchemas;",
        'packages/capture/src/x.test.ts',
      ),
    ).toHaveLength(1);
  });
});

describe('lint: pinnedGet / pinnedLookup stay inside net.ts', () => {
  const code =
    "import { pinnedGet, pinnedLookup, pinnedRequest } from './net';\nvoid [pinnedGet, pinnedLookup, pinnedRequest];";
  async function run(file: string, source = code) {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
      ignore: false,
    });
    const [result] = await eslint.lintText(source, { filePath: path.join(repoRoot, file) });
    return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports');
  }

  it.each([
    'packages/capture/src/discover.ts',
    'packages/capture/src/robots.ts',
    'packages/capture/src/test-support.ts',
    'packages/capture/src/discover.test.ts',
    'packages/audit/src/x.ts',
  ])('rejects the import in %s', async (file) => {
    expect((await run(file)).length).toBeGreaterThanOrEqual(1);
  });

  it('allows net.test.ts, and the public functions everywhere', async () => {
    expect(await run('packages/capture/src/net.test.ts')).toEqual([]);
    expect(
      await run(
        'packages/capture/src/discover.ts',
        "import { guardedFetch } from './net';\nvoid guardedFetch;",
      ),
    ).toEqual([]);
  });
});

describe('lint: network calls only in net.ts', () => {
  async function lint(code: string, file: string) {
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
      ignore: false,
    });
    const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
    return result!.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
  }

  it('catches the planted fetch( fixture', async () => {
    const planted = readFileSync(
      path.join(repoRoot, 'packages/capture/test-fixtures/planted-fetch.fixture.ts'),
      'utf8',
    );
    const messages = await lint(planted, 'packages/capture/src/sneaky.ts');
    expect(messages.length).toBe(1);
    expect(messages[0]!.message).toContain('guardedFetch');
  });

  it.each([
    'void fetch(u);',
    'void globalThis.fetch(u);',
    'void page.goto(u);',
    'void request.get(u);',
    'void http.get(u);',
    'void https.request(u);',
    'void page.request.get(u);',
    'void context.request.get(u);',
    'void request.post(u);',
    'void this.page.request.fetch(u);',
    'void ctx.request.delete(u);',
  ])('bans %s in capture and audit, including tests', async (code) => {
    for (const file of [
      'packages/capture/src/x.ts',
      'packages/capture/src/x.test.ts',
      'packages/audit/src/x.ts',
    ]) {
      expect((await lint(code, file)).length).toBeGreaterThanOrEqual(1);
    }
  });

  it.each([
    'void route.continue();',
    'void route.fallback();',
    'void context.unroute(p);',
    'void context.unrouteAll();',
    'void page.routeFromHAR(f);',
    'void ws.connectToServer();',
    'void browser.newContext();',
    'void chromium.launch();',
  ])('bans the route escape hatch %s outside net.ts', async (code) => {
    for (const file of [
      'packages/capture/src/x.ts',
      'packages/capture/src/x.test.ts',
      'packages/audit/src/x.ts',
    ]) {
      expect((await lint(code, file)).length).toBeGreaterThanOrEqual(1);
    }
    expect(await lint(code, 'packages/capture/src/net.ts')).toEqual([]);
  });

  it('allows them in net.ts and elsewhere', async () => {
    expect(await lint('void fetch(u);', 'packages/capture/src/net.ts')).toEqual([]);
    expect(await lint('void fetch(u);', 'apps/web/lib/x.ts')).toEqual([]);
  });

  it('keeps the fixture-urls import ban in capture source', async () => {
    const messages = await lint(
      "void import('@srs/site-model/fixture-urls');",
      'packages/capture/src/x.ts',
    );
    expect(messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// M1 T9: request guard, with fake routes (no browser, no network)
// ---------------------------------------------------------------------------------------------

type RouteHandler = (route: GuardRoute) => Promise<void> | void;
type SocketHandler = (ws: GuardWebSocketRoute) => Promise<void> | void;

interface FakeContext {
  context: {
    route(p: string | RegExp, h: RouteHandler): Promise<void>;
    routeWebSocket(p: string | RegExp, h: SocketHandler): Promise<void>;
  };
  request(
    url: string,
    opts?: {
      method?: string;
      navigation?: boolean;
      main?: boolean;
      type?: string;
      page?: object;
    },
  ): Promise<{
    fulfilled?: { status: number; headers: Record<string, string>; body: Buffer };
    aborted?: string;
    fellBack?: boolean;
  }>;
  socket(url: string): Promise<{ closed: boolean }>;
}

const defaultPage = {};
function fakeContext(): FakeContext {
  let routeHandler: RouteHandler | undefined;
  let socketHandler: SocketHandler | undefined;
  return {
    context: {
      route: async (_p, h) => {
        routeHandler = h;
      },
      routeWebSocket: async (_p, h) => {
        socketHandler = h;
      },
    },
    async request(url, opts = {}) {
      const out: {
        fulfilled?: { status: number; headers: Record<string, string>; body: Buffer };
        aborted?: string;
        fellBack?: boolean;
      } = {};
      const route: GuardRoute = {
        request: () => ({
          url: () => url,
          method: () => opts.method ?? 'GET',
          resourceType: () => opts.type ?? (opts.navigation ? 'document' : 'image'),
          isNavigationRequest: () => opts.navigation ?? false,
          frame: () => ({
            parentFrame: () => (opts.main === false ? {} : null),
            page: () => opts.page ?? defaultPage,
          }),
          headers: () => ({ accept: 'image/*' }),
        }),
        fulfill: async (o) => {
          out.fulfilled = o;
        },
        abort: async (code) => {
          out.aborted = code ?? 'failed';
        },
        fallback: async () => {
          out.fellBack = true;
        },
      };
      await routeHandler!(route);
      return out;
    },
    async socket(url) {
      let closed = false;
      await socketHandler!({
        url: () => url,
        close: async () => {
          closed = true;
        },
      });
      return { closed };
    },
  };
}

describe('request guard (T9): no DNS rebinding gap', () => {
  afterEach(() => vi.restoreAllMocks());

  const base = (lookup: NetContext['lookup']) =>
    ctxFor('https://example.com', {}, { lookup, production: true });

  it('checks a third-party name once and pins the connection to that answer', async () => {
    const stub = stubHttps();
    let lookups = 0;
    // Public at check time, private on any later lookup (the rebinding trick).
    const lookup = async () => (++lookups === 1 ? ['93.184.216.34'] : ['127.0.0.1']);
    const fake = fakeContext();
    await installRequestGuard(fake.context, base(lookup));
    const out = await fake.request('https://cdn.rebind.example/logo.png');

    expect(out.fulfilled?.status).toBe(200);
    expect(out.fulfilled?.body.toString()).toBe('PNG');
    expect(out.fulfilled?.headers['content-type']).toBe('image/png');
    expect(out.fulfilled?.headers['set-cookie']).toBeUndefined();
    expect(lookups).toBe(1);
    expect(stub.calls).toHaveLength(1);
    // The connection's own DNS step can only answer with the checked address.
    const pinned = stub.calls[0]!.options.lookup as (
      host: string,
      opts: object,
      cb: (err: unknown, address: unknown, family?: number) => void,
    ) => void;
    for (const opts of [{}, { all: true }]) {
      const answer = await new Promise<unknown>((resolve) =>
        pinned('cdn.rebind.example', opts, (_e, address) => resolve(address)),
      );
      expect(JSON.stringify(answer)).toContain('93.184.216.34');
      expect(JSON.stringify(answer)).not.toContain('127.0.0.1');
    }
    expect(lookups).toBe(1);
  });

  it('never connects when the name already resolves private, or mixes in a private answer', async () => {
    const stub = stubHttps();
    for (const answers of [['10.0.0.5'], ['127.0.0.1'], ['93.184.216.34', '169.254.169.254']]) {
      const fake = fakeContext();
      const guard = await installRequestGuard(
        fake.context,
        base(async () => answers),
      );
      const out = await fake.request('https://rebind.example/x.png');
      expect(out.aborted).toBe('blockedbyclient');
      expect(out.fulfilled).toBeUndefined();
      expect(guard.log.at(-1)).toMatchObject({ action: 'blocked', reason: 'refused' });
    }
    expect(stub.calls).toHaveLength(0);
  });

  it('refuses a literal private address', async () => {
    const stub = stubHttps();
    const fake = fakeContext();
    await installRequestGuard(
      fake.context,
      base(async () => ['93.184.216.34']),
    );
    expect((await fake.request('http://10.0.0.5/x.png')).aborted).toBe('blockedbyclient');
    expect((await fake.request('http://169.254.169.254/latest/meta-data')).aborted).toBe(
      'blockedbyclient',
    );
    expect(stub.calls).toHaveLength(0);
  });
});

describe('request guard (T9): what may load', () => {
  afterEach(() => vi.restoreAllMocks());
  const ctx = () =>
    ctxFor('https://example.com', {}, { lookup: async () => ['93.184.216.34'], production: true });

  it('lets a third-party image or font load (checked and pinned)', async () => {
    const stub = stubHttps();
    const fake = fakeContext();
    await installRequestGuard(fake.context, ctx());
    const out = await fake.request('https://fonts.example.net/a.woff2', { type: 'font' });
    expect(out.fulfilled?.status).toBe(200);
    expect(stub.calls).toHaveLength(1);
  });

  it('blocks trackers without any lookup or request', async () => {
    const stub = stubHttps();
    const lookup = vi.fn(async () => ['93.184.216.34']);
    const fake = fakeContext();
    const guard = await installRequestGuard(
      fake.context,
      ctxFor('https://example.com', {}, { lookup, production: true }),
    );
    const out = await fake.request('https://www.google-analytics.com/analytics.js', {
      type: 'script',
    });
    expect(out.aborted).toBe('blockedbyclient');
    expect(lookup).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
    expect(guard.log.at(-1)).toMatchObject({ reason: 'tracker' });
  });

  it('aborts main-frame navigations and redirect hops that leave the origin or the path', async () => {
    const stub = stubHttps();
    const lookup = vi.fn(async () => ['93.184.216.34']);
    const fake = fakeContext();
    const guard = await installRequestGuard(
      fake.context,
      ctxFor('https://example.com', {}, { lookup, production: true }),
    );
    for (const hop of [
      'https://other.example/',
      'http://10.0.0.5/admin',
      'http://169.254.169.254/latest',
      'http://127.0.0.1:9/secret',
    ]) {
      armNavigation(guard, defaultPage, hop);
      expect((await fake.request(hop, { navigation: true, type: 'document' })).aborted).toBe(
        'blockedbyclient',
      );
    }
    expect(stub.calls).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
    const ps = guard.pageState(defaultPage);
    expect(ps.refusals.length).toBeGreaterThanOrEqual(1);
    expect(ps.refusals[0]!.error).toBeInstanceOf(GuardError);
  });

  it('refuses a main-frame navigation nobody armed, and each armed one only once', async () => {
    const stub = stubHttps();
    const fake = fakeContext();
    const guard = await installRequestGuard(fake.context, ctx());
    const nav = { navigation: true, type: 'document' };
    // Meta refresh, Refresh header, script or click: nothing armed it.
    expect((await fake.request('https://example.com/next', nav)).aborted).toBe('blockedbyclient');
    expect(guard.pageState(defaultPage).unexpected).toEqual(['https://example.com/next']);
    armNavigation(guard, defaultPage, 'https://example.com');
    expect((await fake.request('https://example.com/', nav)).fulfilled?.status).toBe(200);
    // The same URL again (a reload by refresh) is not armed any more.
    expect((await fake.request('https://example.com/', nav)).aborted).toBe('blockedbyclient');
    // Another page's armed navigation doesn't license this one.
    const other = {};
    armNavigation(guard, other, 'https://example.com/x');
    expect((await fake.request('https://example.com/x', nav)).aborted).toBe('blockedbyclient');
    expect(
      (await fake.request('https://example.com/x', { ...nav, page: other })).fulfilled,
    ).toBeDefined();
    expect(stub.calls).toHaveLength(2);
  });

  it('normalizes start URLs: no trailing slash, and a #hash', async () => {
    stubHttps();
    const fake = fakeContext();
    const guard = await installRequestGuard(fake.context, ctx());
    const nav = { navigation: true, type: 'document' };
    armNavigation(guard, defaultPage, 'https://example.com');
    expect((await fake.request('https://example.com/', nav)).fulfilled).toBeDefined();
    armNavigation(guard, defaultPage, 'https://example.com/a#section');
    expect((await fake.request('https://example.com/a', nav)).fulfilled).toBeDefined();
  });

  it('follows a subresource redirect by hand and checks every hop', async () => {
    const stub = stubHttps((n) =>
      n === 1
        ? { status: 302, headers: { location: 'http://10.0.0.5/internal.png' } }
        : { status: 200, headers: {} },
    );
    const fake = fakeContext();
    const guard = await installRequestGuard(fake.context, ctx());
    const out = await fake.request('https://img.example.net/a.png');
    expect(out.aborted).toBe('blockedbyclient');
    expect(stub.calls).toHaveLength(1); // the private hop was never requested
    expect(guard.log.at(-1)).toMatchObject({ action: 'blocked', reason: 'refused' });

    const ok = stubHttps((n) =>
      n === 1
        ? { status: 301, headers: { location: 'https://cdn.example.net/a.png' } }
        : { status: 200, headers: {} },
    );
    const fake2 = fakeContext();
    await installRequestGuard(fake2.context, ctx());
    const served = await fake2.request('https://img.example.net/a.png');
    expect(served.fulfilled?.status).toBe(200); // Chromium never sees the 301
    expect(ok.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('hands a main-frame redirect back to guardedGoto instead of letting Chromium follow it', async () => {
    const stub = stubHttps((n) =>
      n === 1
        ? { status: 301, headers: { location: 'https://example.com/new' } }
        : { status: 200, headers: {} },
    );
    const fake = fakeContext();
    const guard = await installRequestGuard(fake.context, ctx());
    armNavigation(guard, defaultPage, 'https://example.com/old');
    const out = await fake.request('https://example.com/old', {
      navigation: true,
      type: 'document',
    });
    expect(out.aborted).toBeUndefined();
    expect(out.fulfilled?.status).toBe(200); // a blank page, never the 301
    expect(out.fulfilled?.body.length).toBe(0);
    expect(guard.pageState(defaultPage).redirects.get('https://example.com/old')).toBe(
      'https://example.com/new',
    );
    expect(stub.calls).toHaveLength(1);
  });

  it('refuses everything when consent is gone', async () => {
    stubHttps();
    let project = projectFor('https://example.com');
    const fake = fakeContext();
    await installRequestGuard(fake.context, {
      ...ctxFor(
        'https://example.com',
        {},
        { lookup: async () => ['93.184.216.34'], production: true },
      ),
      getProject: () => project,
    });
    expect((await fake.request('https://example.com/a.png')).fulfilled).toBeDefined();
    project = { ...project, consent: undefined } as unknown as typeof project;
    expect((await fake.request('https://example.com/b.png')).aborted).toBe('blockedbyclient');
    expect(() =>
      assertCrawlAllowed(project, 'https://example.com/', { pagesCrawledSoFar: 0 }),
    ).toThrow(expect.objectContaining({ code: 'no-consent' }));
  });

  it('aborts iframe navigations (same origin too) and non-GET requests', async () => {
    const stub = stubHttps();
    const fake = fakeContext();
    const guard = await installRequestGuard(fake.context, ctx());
    const frame = { navigation: true, main: false, type: 'document' };
    expect((await fake.request('https://booking.provider.example/widget', frame)).aborted).toBe(
      'blockedbyclient',
    );
    expect((await fake.request('https://example.com/embed', frame)).aborted).toBe(
      'blockedbyclient',
    );
    expect((await fake.request('https://example.com/api', { method: 'POST' })).aborted).toBe(
      'blockedbyclient',
    );
    expect(stub.calls).toHaveLength(0);
    const reasons = guard.log.map((e: GuardLogEntry) => e.reason);
    expect(reasons).toEqual(['iframe', 'iframe', 'method']);
  });

  it('closes WebSockets without connecting', async () => {
    const fake = fakeContext();
    const guard = await installRequestGuard(fake.context, ctx());
    expect(await fake.socket('wss://chat.example.com/live')).toEqual({ closed: true });
    expect(guard.log.at(-1)).toMatchObject({ resourceType: 'websocket', reason: 'websocket' });
  });

  it('guardedGoto refuses a context without the guard, before navigating', async () => {
    let navigated = false;
    const page: GotoPage = {
      goto: async () => {
        navigated = true;
        return null;
      },
      url: () => '',
      context: () => ({}),
    };
    await expect(guardedGoto(ctx(), page, 'https://example.com/')).rejects.toThrow(
      /newGuardedContext/,
    );
    expect(navigated).toBe(false);
  });

  it('pinnedRequest is exported for net.ts internals only (lint covers other files)', () => {
    expect(typeof pinnedRequest).toBe('function');
  });
});

describe('request guard (T9): fixture mode and headers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('in fixture mode an unmapped third-party host is never resolved or fetched by us', async () => {
    const stub = stubHttps();
    const lookup = vi.fn(async () => ['93.184.216.34']);
    const fake = fakeContext();
    const guard = await installRequestGuard(
      fake.context,
      ctxFor('https://example.com', { 'a.test': 4000 }, { lookup }),
    );
    const out = await fake.request('https://static.wixstatic.com/logo.png');
    expect(out.fellBack).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
    expect(guard.log.at(-1)).toMatchObject({ action: 'fallback' });
    // IP literals and localhost are never handed on.
    for (const u of [
      'http://127.0.0.1:9/x.png',
      'http://10.0.0.5/x.png',
      'http://localhost/x.png',
    ]) {
      expect((await fake.request(u)).aborted).toBe('blockedbyclient');
    }
    // Trackers are still blocked first.
    expect(
      (await fake.request('https://www.googletagmanager.com/gtm.js')).fellBack,
    ).toBeUndefined();
  });

  it('without a fixture map (production) the same host is checked and pinned, never handed on', async () => {
    const stub = stubHttps();
    const fake = fakeContext();
    await installRequestGuard(
      fake.context,
      ctxFor(
        'https://example.com',
        {},
        { lookup: async () => ['93.184.216.34'], production: true },
      ),
    );
    const out = await fake.request('https://static.wixstatic.com/logo.png');
    expect(out.fellBack).toBeUndefined();
    expect(stub.calls).toHaveLength(1);
  });

  it('strips headers that make Chromium connect or switch protocol on its own', async () => {
    stubHttps(() => ({
      status: 200,
      headers: {
        Link: '<https://evil.example>; rel=preconnect',
        'Alt-Svc': 'h3=":443"',
        Upgrade: 'websocket',
        TE: 'trailers',
        Trailer: 'x',
        'Proxy-Authenticate': 'Basic',
        'Proxy-Connection': 'keep-alive',
        Refresh: '0; url=/x',
      },
    }));
    const fake = fakeContext();
    await installRequestGuard(
      fake.context,
      ctxFor(
        'https://example.com',
        {},
        { lookup: async () => ['93.184.216.34'], production: true },
      ),
    );
    const out = await fake.request('https://img.example.net/a.png');
    const names = Object.keys(out.fulfilled!.headers).map((k) => k.toLowerCase());
    for (const gone of [
      'link',
      'alt-svc',
      'upgrade',
      'te',
      'trailer',
      'proxy-authenticate',
      'proxy-connection',
    ]) {
      expect(names).not.toContain(gone);
    }
  });

  it('refuses a subresource with a consent error code, not a robots one', async () => {
    stubHttps();
    const fake = fakeContext();
    const base = ctxFor(
      'https://example.com',
      {},
      { lookup: async () => ['93.184.216.34'], production: true },
    );
    const guard = await installRequestGuard(fake.context, {
      ...base,
      getProject: () => ({ ...projectFor('https://example.com'), consent: undefined }) as never,
    });
    expect((await fake.request('https://example.com/a.png')).aborted).toBe('blockedbyclient');
    expect(guard.log.at(-1)).toMatchObject({ reason: 'refused', code: 'no-consent' });
  });

  it('newGuardedContext and guardedGoto refuse a browser or context that is not ours', async () => {
    const ctx = ctxFor(
      'https://example.com',
      {},
      { lookup: async () => ['93.184.216.34'], production: true },
    );
    await expect(newGuardedContext({} as never, ctx)).rejects.toThrow(/launchCaptureBrowser/);
    const page: GotoPage = {
      goto: async () => null,
      url: () => '',
      context: () => ({ route: async () => undefined }),
    };
    await expect(guardedGoto(ctx, page, 'https://example.com/')).rejects.toThrow(
      /newGuardedContext/,
    );
  });
});
