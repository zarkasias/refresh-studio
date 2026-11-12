import { GuardError, MAX_CRAWL_PAGES, assertCrawlAllowed } from '@srs/site-model';
import { guardedFetch, type NetContext } from './net';
import { loadRobots, type RobotsPolicy } from './robots';

export type DiscoverSource = 'home' | 'priority' | 'nav' | 'sitemap';
export type SkipReason = 'robots' | 'page-limit' | 'outside-path';

export interface DiscoveredPage {
  readonly url: string;
  readonly source: DiscoverSource;
}

export interface SkippedPage {
  readonly url: string;
  readonly reason: SkipReason;
}

export type DiscoverResult =
  | {
      readonly status: 'ok';
      readonly pages: readonly DiscoveredPage[];
      readonly skipped: readonly SkippedPage[];
      readonly crawlDelayMs: number;
      readonly robots: RobotsPolicy;
    }
  | { readonly status: 'blocked'; readonly reason: 'robots-unavailable'; readonly message: string };

/** Pages whose path or link text matches this come right after the home page. */
export const PRIORITY_PATTERN = /contact|book|appointment|about|services|menu|locations/i;

/**
 * Strip the hash, sort query parameters and collapse a trailing slash (the root stays `/`).
 * Returns null for anything that isn't an http(s) URL.
 */
export function normalizeUrl(href: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");
}

export interface PageLink {
  readonly url: string;
  readonly text: string;
  readonly inNav: boolean;
}

/** `<a href>` links in document order, resolved against `baseUrl`. `inNav` marks links inside `<nav>`. */
export function extractLinks(html: string, baseUrl: string): PageLink[] {
  const navRanges: Array<[number, number]> = [];
  for (const m of html.matchAll(/<nav\b[\s\S]*?<\/nav>/gi)) {
    navRanges.push([m.index, m.index + m[0].length]);
  }
  const links: PageLink[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1] ?? '');
    const raw = href?.[1] ?? href?.[2] ?? href?.[3];
    if (raw === undefined) continue;
    const url = normalizeUrl(decodeEntities(raw), baseUrl);
    if (!url) continue;
    const text = decodeEntities((m[2] ?? '').replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    links.push({
      url,
      text,
      inNav: navRanges.some(([from, to]) => m.index >= from && m.index < to),
    });
  }
  return links;
}

/** `<loc>` entries of a sitemap; `isIndex` when it is a sitemap index. */
export function parseSitemap(xml: string): { isIndex: boolean; locs: string[] } {
  const locs = [
    ...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/loc>/gi),
  ].map((m) => decodeEntities(m[1] ?? ''));
  return { isIndex: /<sitemapindex\b/i.test(xml), locs };
}

export interface Candidate {
  readonly url: string;
  readonly text: string;
  readonly inNav: boolean;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/**
 * Order candidates (given in discovery order: homepage links, then sitemap): priority matches
 * first, then nav order, then the rest in discovery order. Pure.
 */
export function orderCandidates(candidates: readonly Candidate[]): DiscoveredPage[] {
  const isPriority = (c: Candidate) =>
    PRIORITY_PATTERN.test(pathOf(c.url)) || PRIORITY_PATTERN.test(c.text);
  const rest = candidates.filter((c) => !isPriority(c));
  return [
    ...candidates.filter(isPriority).map((c) => ({ url: c.url, source: 'priority' as const })),
    ...rest.filter((c) => c.inNav).map((c) => ({ url: c.url, source: 'nav' as const })),
    ...rest.filter((c) => !c.inNav).map((c) => ({ url: c.url, source: 'sitemap' as const })),
  ];
}

async function readSitemap(ctx: NetContext, url: string): Promise<string | null> {
  try {
    const res = await guardedFetch(ctx, url, { kind: 'sitemap' });
    return res.status >= 200 && res.status < 300 ? res.body : null;
  } catch {
    // A missing, off-limits or unreachable sitemap just means fewer candidates.
    return null;
  }
}

/**
 * Pick the pages to capture: the home page, then priority pages, nav links, sitemap URLs.
 * Same origin only; the list is cut at `min(25, consent.scope.maxPages)`. A robots.txt that can't
 * be read blocks the run. Pages that are skipped are returned with a reason. Off-site links are
 * not candidates and are not listed.
 */
export async function discoverPages(ctx: NetContext): Promise<DiscoverResult> {
  const project = await ctx.getProject();
  const home = normalizeUrl(project.siteUrl);
  if (!home)
    throw new GuardError('bad-url', `"${project.siteUrl}" isn't a web address we can scan.`);
  const origin = new URL(home).origin;
  const limit = Math.min(MAX_CRAWL_PAGES, project.consent?.scope.maxPages ?? MAX_CRAWL_PAGES);

  const robotsResult = await loadRobots(ctx, origin);
  if (robotsResult.status === 'blocked') return robotsResult;
  const robots = robotsResult.policy;
  const guarded: NetContext = { ...ctx, robots };

  const candidates = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    if (!candidates.has(c.url)) candidates.set(c.url, c);
  };

  // The home page must be fetchable; a failure here surfaces to the caller.
  const homeRes = await guardedFetch(guarded, home, { kind: 'page' });
  if (homeRes.status >= 200 && homeRes.status < 300) {
    for (const link of extractLinks(homeRes.body, homeRes.url)) add(link);
  }

  // Sitemaps: /sitemap.xml plus robots `Sitemap:` lines; indexes one level deep.
  const sitemapUrls = [
    ...new Set(
      [new URL('/sitemap.xml', origin).href, ...robots.sitemaps]
        .map((u) => normalizeUrl(u))
        .filter((u): u is string => u !== null && new URL(u).origin === origin),
    ),
  ];
  for (const sitemapUrl of sitemapUrls) {
    const body = await readSitemap(guarded, sitemapUrl);
    if (body === null) continue;
    const top = parseSitemap(body);
    let locs = top.locs;
    if (top.isIndex) {
      locs = [];
      for (const child of top.locs) {
        const childUrl = normalizeUrl(child);
        if (!childUrl || new URL(childUrl).origin !== origin) continue;
        const childBody = await readSitemap(guarded, childUrl);
        if (childBody !== null) locs.push(...parseSitemap(childBody).locs);
      }
    }
    for (const loc of locs) {
      const url = normalizeUrl(loc);
      if (url) add({ url, text: '', inNav: false });
    }
  }

  // Filter with the same guard the fetch path uses, so discovery and capture agree.
  const skipped: SkippedPage[] = [];
  const eligible: Candidate[] = [];
  for (const candidate of candidates.values()) {
    if (candidate.url === home) continue;
    try {
      assertCrawlAllowed(project, candidate.url, { pagesCrawledSoFar: 0 });
    } catch (error) {
      if (error instanceof GuardError && error.code === 'cross-origin') continue; // not ours
      if (error instanceof GuardError && error.code === 'outside-path') {
        skipped.push({ url: candidate.url, reason: 'outside-path' });
        continue;
      }
      throw error;
    }
    if (!robots.isAllowed(candidate.url)) {
      skipped.push({ url: candidate.url, reason: 'robots' });
      continue;
    }
    eligible.push(candidate);
  }

  const ordered: DiscoveredPage[] = [{ url: home, source: 'home' }, ...orderCandidates(eligible)];
  const pages = ordered.slice(0, limit);
  for (const over of ordered.slice(limit)) skipped.push({ url: over.url, reason: 'page-limit' });

  return { status: 'ok', pages, skipped, crawlDelayMs: robots.crawlDelayMs, robots };
}
