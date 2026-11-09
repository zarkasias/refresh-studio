import { MAX_CRAWL_PAGES, type Project } from '../schemas/project';
import { GuardError } from './errors';

export interface CrawlCheckOptions {
  /** How many pages this crawl has already fetched. The call for the 26th page passes 25. */
  pagesCrawledSoFar: number;
}

const INCOMPLETE_CONSENT_MESSAGE =
  'The permission record for this site is incomplete. Check it before scanning.';

function badConsent(): GuardError {
  return new GuardError('bad-consent', INCOMPLETE_CONSENT_MESSAGE);
}

/** True when `path` is `prefix` or sits below it, matched on a path-segment boundary. */
function isWithinPrefix(path: string, prefix: string): boolean {
  const base = prefix.replace(/\/+$/, '');
  if (base === '') return true;
  return path === base || path.startsWith(`${base}/`);
}

/** A readable host for messages; falls back to the raw text if it can't be parsed. */
function hostOf(value: unknown): string {
  const raw = String(value);
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw;
  }
}

/**
 * Throws a GuardError unless the crawl may fetch `url` (CLAUDE.md rules 5 and 6).
 * Pure: no I/O. Fails closed: anything missing or malformed in the consent record or the
 * options blocks the scan; it never means "no limit".
 *
 * The capture layer must normalize redirects (follow them and check the final URL, too)
 * before calling, because a redirect can leave the permitted site.
 *
 * TODO(M1): robots.txt handling lives in packages/capture.
 */
export function assertCrawlAllowed(
  project: Pick<Project, 'consent'>,
  url: string,
  options: CrawlCheckOptions,
): void {
  const consent = project?.consent;
  if (!consent) {
    throw new GuardError(
      'no-consent',
      "We don't have the owner's permission to scan this site yet. Record their consent before running a scan.",
    );
  }

  // Validate the (possibly unvalidated) consent record before trusting any of it.
  const scope: unknown = (consent as { scope?: unknown }).scope;
  if (typeof scope !== 'object' || scope === null) throw badConsent();
  const { origin, pathPrefix, maxPages } = scope as {
    origin?: unknown;
    pathPrefix?: unknown;
    maxPages?: unknown;
  };
  if (typeof origin !== 'string') throw badConsent();
  let permittedOrigin: string;
  try {
    const stored = new URL(origin);
    // The stored origin must be a bare site address. Anything that narrows or changes it
    // (a path, query, login) is a malformed record, not something to silently drop.
    if (
      (stored.protocol !== 'http:' && stored.protocol !== 'https:') ||
      stored.pathname !== '/' ||
      stored.search !== '' ||
      stored.hash !== '' ||
      stored.username !== '' ||
      stored.password !== ''
    ) {
      throw badConsent();
    }
    permittedOrigin = stored.origin;
  } catch {
    throw badConsent();
  }
  if (
    pathPrefix !== undefined &&
    (typeof pathPrefix !== 'string' || !pathPrefix.startsWith('/') || pathPrefix.includes('//'))
  ) {
    throw badConsent();
  }
  if (typeof maxPages !== 'number' || !Number.isInteger(maxPages) || maxPages < 1) {
    throw badConsent();
  }
  if (
    typeof options !== 'object' ||
    options === null ||
    !Number.isInteger(options.pagesCrawledSoFar) ||
    options.pagesCrawledSoFar < 0
  ) {
    throw new GuardError(
      'page-limit',
      "We can't tell how many pages have been scanned so far, so we can't safely continue the scan.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GuardError('bad-url', `"${String(url)}" isn't a web address we can scan.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new GuardError(
      'bad-url',
      `"${url}" isn't a regular web page address (it must start with http or https).`,
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new GuardError(
      'bad-url',
      "This web address includes a login name or password, so we won't scan it.",
    );
  }

  if (parsed.origin !== permittedOrigin) {
    const here = parsed.host;
    const allowed = hostOf(origin);
    const detail =
      here === allowed
        ? `This page uses a different version of the site (secure https versus non-secure http, or a different port) than the one we have permission to scan (${allowed}).`
        : `This page is on a different website (${here}) than the one we have permission to scan (${allowed}).`;
    throw new GuardError('cross-origin', detail);
  }

  if (pathPrefix !== undefined) {
    if (/%2f|%5c/i.test(parsed.pathname) || !isWithinPrefix(parsed.pathname, pathPrefix)) {
      throw new GuardError(
        'outside-path',
        `This page (${parsed.pathname}) is outside the part of the site we have permission to scan (${pathPrefix}).`,
      );
    }
  }

  const limit = Math.min(MAX_CRAWL_PAGES, maxPages);
  if (options.pagesCrawledSoFar >= limit) {
    throw new GuardError(
      'page-limit',
      `We've already scanned ${limit} ${limit === 1 ? 'page' : 'pages'}, which is the limit for this site. No more pages can be added to this scan.`,
    );
  }
}
