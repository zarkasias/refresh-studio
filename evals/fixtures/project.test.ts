import { GuardError, ProjectSchema, assertCrawlAllowed } from '@srs/site-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureProject } from './project';
import { type FixtureServer, startFixtureServer } from './server';

const ROOT = new URL('./lockdown-test-site', import.meta.url).pathname;

function refusal(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof GuardError) return err.code;
    throw err;
  }
  return undefined;
}

describe('fixtureProject', () => {
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer({ root: ROOT });
  });
  afterAll(async () => {
    await server.close();
  });

  it('is a valid own-site Project scoped to the loopback origin', () => {
    const project = fixtureProject(server.port);
    // Everything but the loopback URLs must satisfy the site-model schema. (Site-model
    // UrlSchema rejects 127.0.0.1 hosts today; see LOOPBACK_URL_PATHS in project.ts.)
    const result = ProjectSchema.safeParse(project);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths.filter((p) => p !== 'siteUrl' && p !== 'consent.scope.origin')).toEqual([]);
    expect(project.consent?.method).toBe('own-site');
    expect(project.consent?.scope).toEqual({ origin: server.origin, maxPages: 25 });
    expect(project.siteUrl).toBe(`${server.origin}/`);
  });

  it('lets assertCrawlAllowed pass for pages on the fixture server', () => {
    const project = fixtureProject(server.port);
    expect(() =>
      assertCrawlAllowed(project, server.url('/'), { pagesCrawledSoFar: 0 }),
    ).not.toThrow();
    expect(() =>
      assertCrawlAllowed(project, server.url('/about/'), { pagesCrawledSoFar: 24 }),
    ).not.toThrow();
  });

  it('makes assertCrawlAllowed refuse external and other-loopback URLs', () => {
    const project = fixtureProject(server.port);
    const opts = { pagesCrawledSoFar: 0 };
    expect(refusal(() => assertCrawlAllowed(project, 'https://example.com/', opts))).toBe(
      'cross-origin',
    );
    expect(
      refusal(() => assertCrawlAllowed(project, 'https://static.wixstatic.com/media/app.js', opts)),
    ).toBe('cross-origin');
    expect(
      refusal(() => assertCrawlAllowed(project, `http://localhost:${server.port}/`, opts)),
    ).toBe('cross-origin');
    expect(
      refusal(() => assertCrawlAllowed(project, `http://127.0.0.1:${server.port + 1}/`, opts)),
    ).toBe('cross-origin');
  });

  it('keeps the 25-page cap', () => {
    const project = fixtureProject(server.port);
    expect(
      refusal(() => assertCrawlAllowed(project, server.url('/'), { pagesCrawledSoFar: 25 })),
    ).toBe('page-limit');
  });

  it('supports a path prefix and a lower page limit', () => {
    const project = fixtureProject(server.port, { pathPrefix: '/about', maxPages: 2 });
    expect(project.siteUrl).toBe(`${server.origin}/about`);
    expect(() =>
      assertCrawlAllowed(project, server.url('/about/'), { pagesCrawledSoFar: 1 }),
    ).not.toThrow();
    expect(
      refusal(() => assertCrawlAllowed(project, server.url('/'), { pagesCrawledSoFar: 0 })),
    ).toBe('outside-path');
    expect(
      refusal(() => assertCrawlAllowed(project, server.url('/about/'), { pagesCrawledSoFar: 2 })),
    ).toBe('page-limit');
  });

  it('still throws on any other schema problem', () => {
    expect(() => fixtureProject(server.port, { maxPages: 26 })).toThrow(/maxPages/);
    expect(() => fixtureProject(server.port, { pathPrefix: 'about' })).toThrow(/pathPrefix/);
    // A prefix that would turn siteUrl into another host is not hidden by the URL tolerance.
    expect(() => fixtureProject(server.port, { pathPrefix: '//evil.example' })).toThrow(
      /not a plain loopback address/,
    );
    expect(() => fixtureProject(server.port, { pathPrefix: '/a?x=1' })).toThrow(
      /not a plain loopback address/,
    );
  });

  it('rejects an invalid port', () => {
    for (const port of [0, -1, 65536, 1.5, Number.NaN]) {
      expect(() => fixtureProject(port)).toThrow(/invalid port/);
    }
  });
});
