import { afterEach, describe, expect, it } from 'vitest';
import { ALLOW_ALL, loadRobots, parseRobots } from './robots';
import { closedPort, projectFor, startSite, type Reply, type TestSite } from './test-support';
import type { NetContext } from './net';

const sites: TestSite[] = [];
afterEach(async () => {
  await Promise.all(sites.splice(0).map((s) => s.close()));
});

async function ctxWith(reply: Reply | undefined, port?: number): Promise<NetContext> {
  let p = port;
  if (p === undefined) {
    const s = await startSite(reply ? { '/robots.txt': reply } : {});
    sites.push(s);
    p = s.port;
  }
  const project = projectFor('https://a.test');
  return {
    getProject: () => project,
    pagesCrawledSoFar: () => 0,
    fixtureHostMap: { 'a.test': p },
  };
}

describe('parseRobots', () => {
  const url = 'https://a.test/robots.txt';

  it('honors the * group', () => {
    const p = parseRobots(url, 'User-agent: *\nDisallow: /admin');
    expect(p.isAllowed('https://a.test/admin')).toBe(false);
    expect(p.isAllowed('https://a.test/about')).toBe(true);
  });

  it('honors our own token', () => {
    const p = parseRobots(
      url,
      'User-agent: SiteRefreshStudio\nDisallow: /nope\n\nUser-agent: *\nAllow: /',
    );
    expect(p.isAllowed('https://a.test/nope')).toBe(false);
    expect(p.isAllowed('https://a.test/yes')).toBe(true);
  });

  it('named allow + * disallow: disallowed (a named allow never overrides *)', () => {
    const p = parseRobots(
      url,
      'User-agent: *\nDisallow: /\n\nUser-agent: SiteRefreshStudio\nAllow: /',
    );
    expect(p.isAllowed('https://a.test/')).toBe(false);
    expect(p.isAllowed('https://a.test/about')).toBe(false);
  });

  it('named disallow + * allow: disallowed', () => {
    const p = parseRobots(
      url,
      'User-agent: *\nAllow: /\n\nUser-agent: SiteRefreshStudio\nDisallow: /nope',
    );
    expect(p.isAllowed('https://a.test/nope')).toBe(false);
    expect(p.isAllowed('https://a.test/yes')).toBe(true);
  });

  it('both groups allow: allowed', () => {
    const p = parseRobots(
      url,
      'User-agent: *\nDisallow: /admin\n\nUser-agent: SiteRefreshStudio\nDisallow: /private',
    );
    expect(p.isAllowed('https://a.test/about')).toBe(true);
    expect(p.isAllowed('https://a.test/admin')).toBe(false);
    expect(p.isAllowed('https://a.test/private')).toBe(false);
  });

  it('only the named group present: it decides', () => {
    const p = parseRobots(url, 'User-agent: SiteRefreshStudio\nDisallow: /nope');
    expect(p.isAllowed('https://a.test/nope')).toBe(false);
    expect(p.isAllowed('https://a.test/yes')).toBe(true);
  });

  it('only the * group present: it decides', () => {
    const p = parseRobots(url, 'User-agent: *\nDisallow: /nope');
    expect(p.isAllowed('https://a.test/nope')).toBe(false);
    expect(p.isAllowed('https://a.test/yes')).toBe(true);
  });

  it('a group for some other crawler is ignored; with no matching group everything is allowed', () => {
    const p = parseRobots(url, 'User-agent: Googlebot\nDisallow: /');
    expect(p.isAllowed('https://a.test/x')).toBe(true);
    expect(parseRobots(url, '').isAllowed('https://a.test/x')).toBe(true);
  });

  it('Crawl-delay is the larger of the two groups, capped at 10 s', () => {
    const both = (named: number, star: number) =>
      parseRobots(
        url,
        `User-agent: *\nCrawl-delay: ${star}\n\nUser-agent: SiteRefreshStudio\nCrawl-delay: ${named}`,
      ).crawlDelayMs;
    expect(both(2, 5)).toBe(5000);
    expect(both(7, 3)).toBe(7000);
    expect(both(30, 3)).toBe(10_000);
    expect(parseRobots(url, 'User-agent: SiteRefreshStudio\nCrawl-delay: 4').crawlDelayMs).toBe(
      4000,
    );
  });

  it('disallow-all in * blocks everything', () => {
    expect(parseRobots(url, 'User-agent: *\nDisallow: /').isAllowed('https://a.test/x')).toBe(
      false,
    );
  });

  it('caps Crawl-delay at 10 seconds', () => {
    expect(parseRobots(url, 'User-agent: *\nCrawl-delay: 3').crawlDelayMs).toBe(3000);
    expect(parseRobots(url, 'User-agent: *\nCrawl-delay: 120').crawlDelayMs).toBe(10_000);
    expect(parseRobots(url, 'User-agent: *\nDisallow:').crawlDelayMs).toBe(0);
  });

  it('reads Sitemap lines', () => {
    expect(parseRobots(url, 'Sitemap: https://a.test/s.xml').sitemaps).toEqual([
      'https://a.test/s.xml',
    ]);
  });
});

describe('loadRobots', () => {
  it('parses a 200 response', async () => {
    const r = await loadRobots(
      await ctxWith({ body: 'User-agent: *\nDisallow: /x' }),
      'https://a.test',
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.policy.isAllowed('https://a.test/x')).toBe(false);
  });

  it.each([404, 403, 410])('allows everything on %s', async (status) => {
    const r = await loadRobots(await ctxWith({ status, body: 'no' }), 'https://a.test');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.policy.isAllowed('https://a.test/anything')).toBe(true);
  });

  it('blocks the run on 503 with a plain message', async () => {
    const r = await loadRobots(await ctxWith({ status: 503 }), 'https://a.test');
    expect(r.status).toBe('blocked');
    if (r.status === 'blocked') {
      expect(r.reason).toBe('robots-unavailable');
      expect(r.message).toContain("couldn't read this site's robots.txt");
      expect(r.message).not.toMatch(/503|ECONN|undefined/i);
    }
  });

  it('blocks the run on a network error', async () => {
    const r = await loadRobots(await ctxWith(undefined, await closedPort()), 'https://a.test');
    expect(r.status).toBe('blocked');
  });

  it('exports an allow-all policy', () => {
    expect(ALLOW_ALL.isAllowed('https://x.test/')).toBe(true);
  });
});
