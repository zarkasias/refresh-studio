import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, type FixtureServer } from '@srs/evals/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverPages,
  extractLinks,
  normalizeUrl,
  orderCandidates,
  parseSitemap,
} from './discover';
import type { NetContext } from './net';
import { projectFor, startSite, type Reply, type TestSite } from './test-support';

const sitesDir = path.resolve(fileURLToPath(import.meta.url), '../../../../evals/fixtures/sites');
const closers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((s) => s.close()));
});

async function site(routes: Record<string, Reply>): Promise<TestSite> {
  const s = await startSite(routes);
  closers.push(s);
  return s;
}

function ctx(
  siteUrl: string,
  port: number,
  scope: { pathPrefix?: string; maxPages?: number } = {},
): NetContext {
  const project = projectFor(siteUrl, scope);
  return {
    getProject: () => project,
    pagesCrawledSoFar: () => 0,
    fixtureHostMap: { 'a.test': port },
  };
}

const page = (links: string) => ({ body: `<html><body><nav>${links}</nav></body></html>` });
const a = (href: string, text = 'x') => `<a href="${href}">${text}</a>`;
const sitemap = (...paths: string[]) => ({
  body: `<urlset>${paths.map((p) => `<url><loc>https://a.test${p}</loc></url>`).join('')}</urlset>`,
});

describe('normalizeUrl', () => {
  it.each([
    ['https://a.test/about/#team', 'https://a.test/about'],
    ['https://a.test/p?b=2&a=1', 'https://a.test/p?a=1&b=2'],
    ['https://a.test', 'https://a.test/'],
    ['https://a.test/', 'https://a.test/'],
    ['/x/', 'https://a.test/x'],
    ['../up', 'https://a.test/up'],
  ])('%s', (input, expected) =>
    expect(normalizeUrl(input, 'https://a.test/dir/page')).toBe(expected),
  );

  it.each(['mailto:a@b.c', 'tel:123', 'javascript:void(0)', 'ftp://a.test/x'])('drops %s', (u) =>
    expect(normalizeUrl(u, 'https://a.test/')).toBeNull(),
  );
});

describe('extractLinks / parseSitemap', () => {
  it('marks nav links and decodes entities', () => {
    const html = `<a href="/top">Top</a><nav><a href='/n?b=1&amp;a=2'><span>Nav</span> link</a></nav>`;
    expect(extractLinks(html, 'https://a.test/')).toEqual([
      { url: 'https://a.test/top', text: 'Top', inNav: false },
      { url: 'https://a.test/n?a=2&b=1', text: 'Nav link', inNav: true },
    ]);
  });

  it('reads index and CDATA locs', () => {
    expect(
      parseSitemap(
        '<sitemapindex><sitemap><loc><![CDATA[https://a.test/s1.xml]]></loc></sitemap></sitemapindex>',
      ),
    ).toEqual({
      isIndex: true,
      locs: ['https://a.test/s1.xml'],
    });
  });
});

describe('orderCandidates', () => {
  it('puts priority first, then nav, then sitemap order', () => {
    const c = (url: string, inNav: boolean, text = '') => ({
      url: `https://a.test${url}`,
      text,
      inNav,
    });
    const ordered = orderCandidates([
      c('/blog', false),
      c('/gallery', true),
      c('/team', true, 'Book a visit'),
      c('/locations', false),
      c('/news', true),
    ]).map((p) => `${p.source}:${new URL(p.url).pathname}`);
    expect(ordered).toEqual([
      'priority:/team',
      'priority:/locations',
      'nav:/gallery',
      'nav:/news',
      'sitemap:/blog',
    ]);
  });
});

describe('discoverPages', () => {
  it('orders home, priority, nav, sitemap and dedupes', async () => {
    const s = await site({
      '/': page(
        a('/gallery') +
          a('/contact/', 'Contact us') +
          a('/about#team') +
          a('https://other.example/x'),
      ),
      '/sitemap.xml': sitemap('/about', '/blog', '/gallery/'),
    });
    const r = await discoverPages(ctx('https://a.test', s.port));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.pages.map((p) => `${p.source}:${new URL(p.url).pathname}`)).toEqual([
      'home:/',
      'priority:/contact',
      'priority:/about',
      'nav:/gallery',
      'sitemap:/blog',
    ]);
    expect(r.skipped).toEqual([]);
  });

  it('skips robots-disallowed pages with reason robots, and they do not use a slot', async () => {
    const s = await site({
      '/robots.txt': { body: 'User-agent: *\nDisallow: /private\nCrawl-delay: 2' },
      '/': page(a('/private/x') + a('/open')),
    });
    const r = await discoverPages(ctx('https://a.test', s.port, { maxPages: 2 }));
    if (r.status !== 'ok') throw new Error('blocked');
    expect(r.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/open']);
    expect(r.skipped).toEqual([{ url: 'https://a.test/private/x', reason: 'robots' }]);
    expect(r.crawlDelayMs).toBe(2000);
    expect(s.hits).not.toContain('/private/x');
  });

  it('blocks the run when robots.txt answers 503', async () => {
    const s = await site({ '/robots.txt': { status: 503 }, '/': page(a('/x')) });
    const r = await discoverPages(ctx('https://a.test', s.port));
    expect(r.status).toBe('blocked');
    if (r.status === 'blocked') expect(r.message).toContain('stopped');
    expect(s.hits).toEqual(['/robots.txt']);
  });

  it('cuts at 25 and marks the 26th onward page-limit', async () => {
    const paths = Array.from({ length: 30 }, (_, i) => `/p${String(i).padStart(2, '0')}`);
    const s = await site({ '/': page(''), '/sitemap.xml': sitemap(...paths) });
    const r = await discoverPages(ctx('https://a.test', s.port));
    if (r.status !== 'ok') throw new Error('blocked');
    expect(r.pages).toHaveLength(25);
    expect(r.pages[24]!.url).toBe('https://a.test/p23');
    expect(r.skipped.map((x) => x.reason)).toEqual(Array(6).fill('page-limit'));
    expect(r.skipped[0]!.url).toBe('https://a.test/p24');
  });

  it('respects a lower consent maxPages', async () => {
    const s = await site({ '/': page(a('/a') + a('/b') + a('/c')) });
    const r = await discoverPages(ctx('https://a.test', s.port, { maxPages: 2 }));
    if (r.status !== 'ok') throw new Error('blocked');
    expect(r.pages).toHaveLength(2);
    expect(r.skipped).toEqual([
      { url: 'https://a.test/b', reason: 'page-limit' },
      { url: 'https://a.test/c', reason: 'page-limit' },
    ]);
  });

  it('reads sitemap indexes one level deep and Sitemap: lines from robots', async () => {
    const s = await site({
      '/robots.txt': { body: 'Sitemap: https://a.test/extra.xml' },
      '/': page(''),
      '/sitemap.xml': {
        body: '<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>',
      },
      '/s1.xml': {
        body: '<sitemapindex><sitemap><loc>https://a.test/deeper.xml</loc></sitemap></sitemapindex>',
      },
      '/deeper.xml': sitemap('/too-deep'),
      '/extra.xml': sitemap('/from-robots'),
    });
    const r = await discoverPages(ctx('https://a.test', s.port));
    if (r.status !== 'ok') throw new Error('blocked');
    const paths = r.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toContain('/from-robots');
    expect(paths).not.toContain('/too-deep');
  });

  it('wixsite-style pathPrefix: pages outside the prefix are skipped as outside-path', async () => {
    const s = await site({
      '/jolly': page(a('/jolly/about') + a('/jolly') + a('/other/page') + a('/jollyx')),
      '/sitemap.xml': sitemap('/jolly/menu', '/other/two'),
    });
    const r = await discoverPages(ctx('https://a.test/jolly', s.port, { pathPrefix: '/jolly' }));
    if (r.status !== 'ok') throw new Error('blocked');
    expect(r.pages.map((p) => new URL(p.url).pathname)).toEqual([
      '/jolly',
      '/jolly/about',
      '/jolly/menu',
    ]);
    expect(r.skipped.every((x) => x.reason === 'outside-path')).toBe(true);
    expect(r.skipped.map((x) => new URL(x.url).pathname).sort()).toEqual(
      ['/jollyx', '/other/page', '/other/two'].sort(),
    );
  });

  it('pathPrefix: only /robots.txt and /sitemap.xml at the root are exempt; other sitemaps and redirect hops stay inside the prefix', async () => {
    const s = await site({
      '/robots.txt': {
        body: 'Sitemap: https://a.test/outside-map.xml\nSitemap: https://a.test/jolly/map.xml',
      },
      '/jolly': page(''),
      '/sitemap.xml': {
        body: '<sitemapindex><sitemap><loc>https://a.test/child-outside.xml</loc></sitemap><sitemap><loc>https://a.test/jolly/child.xml</loc></sitemap></sitemapindex>',
      },
      '/outside-map.xml': sitemap('/jolly/from-outside-map'),
      '/child-outside.xml': sitemap('/jolly/from-outside-child'),
      '/jolly/child.xml': sitemap('/jolly/from-inside-child'),
      '/jolly/map.xml': sitemap('/jolly/from-inside-map'),
    });
    const r = await discoverPages(ctx('https://a.test/jolly', s.port, { pathPrefix: '/jolly' }));
    if (r.status !== 'ok') throw new Error('blocked');
    const paths = r.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toEqual(['/jolly', '/jolly/from-inside-child', '/jolly/from-inside-map']);
    expect(s.hits).toContain('/robots.txt');
    expect(s.hits).toContain('/sitemap.xml');
    expect(s.hits).not.toContain('/outside-map.xml');
    expect(s.hits).not.toContain('/child-outside.xml');
  });

  it('pathPrefix: a redirect from /sitemap.xml or /robots.txt to outside the prefix is not followed', async () => {
    const s = await site({
      '/robots.txt': { status: 302, headers: { Location: '/elsewhere.txt' } },
      '/elsewhere.txt': { body: 'User-agent: *\nDisallow: /' },
    });
    // The redirect hop is outside the prefix, so it is refused and never requested.
    await expect(
      discoverPages(ctx('https://a.test/jolly', s.port, { pathPrefix: '/jolly' })),
    ).rejects.toMatchObject({ code: 'redirect-refused' });
    expect(s.hits).not.toContain('/elsewhere.txt');
  });

  it('pathPrefix: a /sitemap.xml redirect to outside the prefix is not followed', async () => {
    const s = await site({
      '/jolly': page(a('/jolly/about')),
      '/sitemap.xml': { status: 302, headers: { Location: '/elsewhere.xml' } },
      '/elsewhere.xml': sitemap('/jolly/from-elsewhere'),
    });
    const r = await discoverPages(ctx('https://a.test/jolly', s.port, { pathPrefix: '/jolly' }));
    if (r.status !== 'ok') throw new Error('blocked');
    expect(r.pages.map((p) => new URL(p.url).pathname)).toEqual(['/jolly', '/jolly/about']);
    expect(s.hits).toContain('/sitemap.xml');
    expect(s.hits).not.toContain('/elsewhere.xml');
  });

  it('ignores sitemap URLs on other origins', async () => {
    const s = await site({
      '/': page(''),
      '/sitemap.xml': { body: '<urlset><url><loc>https://evil.example/x</loc></url></urlset>' },
    });
    const r = await discoverPages(ctx('https://a.test', s.port));
    if (r.status !== 'ok') throw new Error('blocked');
    expect(r.pages).toHaveLength(1);
    expect(r.skipped).toEqual([]);
  });

  describe('T6a synthetic sites (some internal links were never generated; those 404s are expected)', () => {
    async function fixtureCtx(name: string): Promise<{ ctx: NetContext; server: FixtureServer }> {
      const server = await startFixtureServer({ root: path.join(sitesDir, name) });
      closers.push(server);
      return { ctx: ctx('https://a.test', server.port), server };
    }

    it.each(['iphci', 'delaware-valley-hardwoods', 'casper-plumbing'])(
      '%s: home first, same-origin, within limit',
      async (name) => {
        const { ctx: c } = await fixtureCtx(name);
        const r = await discoverPages(c);
        if (r.status !== 'ok') throw new Error('blocked');
        expect(r.pages[0]).toEqual({ url: 'https://a.test/', source: 'home' });
        expect(r.pages.length).toBeGreaterThan(1);
        expect(r.pages.length).toBeLessThanOrEqual(25);
        for (const p of r.pages) expect(new URL(p.url).origin).toBe('https://a.test');
        expect(new Set(r.pages.map((p) => p.url)).size).toBe(r.pages.length);
      },
    );

    it('iphci: the contact page is ranked right after home', async () => {
      const { ctx: c } = await fixtureCtx('iphci');
      const r = await discoverPages(c);
      if (r.status !== 'ok') throw new Error('blocked');
      expect(r.pages[1]).toEqual({ url: 'https://a.test/contact', source: 'priority' });
    });
  });
});
