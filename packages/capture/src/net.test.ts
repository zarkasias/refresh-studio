import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { GuardError } from '@srs/site-model';
import { afterEach, describe, expect, it } from 'vitest';
import { isPrivateAddress } from './address';
import { CaptureBlockedError } from './errors';
import {
  guardedFetch,
  guardedGoto,
  fixturePortFor,
  pinnedGet,
  pinnedLookup,
  type GotoPage,
  type NetContext,
} from './net';
import { ALLOW_ALL, parseRobots } from './robots';
import { projectFor, startHangingServer, startSite, type TestSite } from './test-support';

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
    const page: GotoPage = {
      goto: async (url) => ({ url: () => url, status: () => 200 }),
      url: () => 'https://example.com/',
    };
    const error = await failure(guardedGoto(publicHost(lookup), page, 'https://example.com/'));
    expect((error as CaptureBlockedError).code).toBe('private-address');
  });

  it('guardedGoto refuses a final URL on another origin', async () => {
    const page: GotoPage = {
      goto: async () => ({ url: () => 'https://elsewhere.example/', status: () => 200 }),
      url: () => 'https://elsewhere.example/',
    };
    const error = await failure(
      guardedGoto(
        publicHost(async () => ['93.184.216.34']),
        page,
        'https://example.com/',
      ),
    );
    expect((error as CaptureBlockedError).code).toBe('redirect-refused');
  });

  it('guardedGoto does not navigate when the target is robots-disallowed', async () => {
    let navigated = false;
    const page: GotoPage = {
      goto: async () => {
        navigated = true;
        return null;
      },
      url: () => '',
    };
    const robots = parseRobots('https://example.com/robots.txt', 'User-agent: *\nDisallow: /no');
    const error = await failure(
      guardedGoto(
        { ...publicHost(async () => ['93.184.216.34']), robots },
        page,
        'https://example.com/no',
      ),
    );
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
  const code = "import { pinnedGet, pinnedLookup } from './net';\nvoid [pinnedGet, pinnedLookup];";
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
