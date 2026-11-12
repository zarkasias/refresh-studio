import robotsParser from 'robots-parser';
import { guardedFetch, type NetContext } from './net';

export { CRAWLER_TOKEN, CRAWLER_USER_AGENT } from './identity';
import { CRAWLER_TOKEN } from './identity';

/** Longest Crawl-delay we honor, in seconds (D11). */
export const MAX_CRAWL_DELAY_SECONDS = 10;

export interface RobotsPolicy {
  /** True when robots.txt lets our crawler fetch `url`. */
  isAllowed(url: string): boolean;
  /** Crawl-delay in ms, capped at 10 s; 0 when none. */
  readonly crawlDelayMs: number;
  /** `Sitemap:` lines. */
  readonly sitemaps: readonly string[];
}

export const ALLOW_ALL: RobotsPolicy = {
  isAllowed: () => true,
  crawlDelayMs: 0,
  sitemaps: [],
};

/**
 * Parse a robots.txt body. A URL is allowed only when BOTH the `SiteRefreshStudio` group and the
 * `*` group allow it, so a named allow never overrides a `*` disallow. A group that is missing
 * has no rules, so when only one group exists it decides; with neither, everything is allowed.
 * Crawl-delay is the larger of the two groups' values, capped at 10 s.
 */
export function parseRobots(robotsUrl: string, body: string): RobotsPolicy {
  const parsed = robotsParser(robotsUrl, body);
  const delays = [parsed.getCrawlDelay(CRAWLER_TOKEN), parsed.getCrawlDelay('*')].filter(
    (d): d is number => typeof d === 'number' && Number.isFinite(d) && d > 0,
  );
  const seconds = Math.min(Math.max(0, ...delays), MAX_CRAWL_DELAY_SECONDS);
  return {
    // robots-parser returns undefined for URLs outside this robots.txt's origin; we only ask
    // about our own origin, so treat undefined as "not allowed" (fail closed).
    isAllowed: (url) =>
      parsed.isAllowed(url, CRAWLER_TOKEN) === true && parsed.isAllowed(url, '*') === true,
    crawlDelayMs: seconds * 1000,
    sitemaps: parsed.getSitemaps(),
  };
}

export type RobotsResult =
  | { readonly status: 'ok'; readonly policy: RobotsPolicy }
  | {
      readonly status: 'blocked';
      readonly reason: 'robots-unavailable';
      /** Plain English, safe to show the consultant. */
      readonly message: string;
    };

/**
 * Fetch and read `<origin>/robots.txt` (D11): 2xx parse; 4xx allow all; 5xx, network error or
 * anything else blocks the run. Goes through guardedFetch, so consent and address rules apply.
 * Consent and address errors (GuardError, private-address, redirect-refused) are not swallowed.
 */
export async function loadRobots(ctx: NetContext, origin: string): Promise<RobotsResult> {
  const robotsUrl = new URL('/robots.txt', origin).href;
  const blocked = (why: string): RobotsResult => ({
    status: 'blocked',
    reason: 'robots-unavailable',
    message: `We couldn't read this site's robots.txt (${why}), so we can't tell what we're allowed to scan. The scan has been stopped. Try again later, or ask the site owner.`,
  });
  let res;
  try {
    res = await guardedFetch({ ...ctx, robots: undefined }, robotsUrl, { kind: 'robots' });
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'network' || error.code === 'timeout' || error.code === 'too-many-redirects')
    ) {
      return blocked('the site did not answer');
    }
    throw error;
  }
  if (res.status >= 200 && res.status < 300) {
    return { status: 'ok', policy: parseRobots(res.url, res.body) };
  }
  if (res.status >= 400 && res.status < 500) return { status: 'ok', policy: ALLOW_ALL };
  return blocked('the site reported a problem');
}
