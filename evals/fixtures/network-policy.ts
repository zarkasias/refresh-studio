/**
 * Pure network-policy helpers for offline fixtures (M1 T4). No I/O here: the browser and
 * server edges live in `lockdown.ts`, `server.ts` and `sinkhole.ts`.
 */
import path from 'node:path';

/**
 * Maps an external platform URL to a local file under the fixture directory, so fixtures can
 * reference e.g. `https://static.wixstatic.com/...` without any network access.
 *
 * `pattern` is tested against the URL's `origin + pathname` (query and hash are ignored) and
 * must match that whole string. `target` is a path relative to the fixture root and may use
 * `$1`-style capture references, as in `String.prototype.replace`.
 */
export interface PlatformAssetRule {
  readonly pattern: RegExp;
  readonly target: string;
}

/** The folder under a fixture root that holds locally served platform assets. */
export const PLATFORM_ASSETS_DIR = 'platform-assets';

/**
 * True for loopback hosts only: `localhost`, `127.0.0.0/8` and `::1`.
 * Accepts a URL `hostname` (IPv6 in brackets) or a bare address. Anything else, including
 * IPv4-mapped IPv6 forms, is treated as external (fail closed).
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  if (h === '::1' || h === '[::1]') return true;
  const octets = h.split('.');
  if (octets.length !== 4 || octets[0] !== '127') return false;
  return octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
}

/** True when `url` parses and its host is loopback. Unparseable URLs are external. */
export function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A rule serving every `http(s)://<host>/<path>` from `platform-assets/<host>/<path>`
 * (or `<dir>/<path>` when `dir` is given, relative to the fixture root).
 * Example: `platformHost('static.wixstatic.com')`.
 */
export function platformHost(host: string, dir?: string): PlatformAssetRule {
  const target = dir ?? `${PLATFORM_ASSETS_DIR}/${host.toLowerCase()}`;
  return {
    pattern: new RegExp(`^https?://${escapeRegExp(host.toLowerCase())}/(.*)$`),
    target: `${target.replace(/\/+$/, '')}/$1`,
  };
}

/** True when `candidate` is strictly inside `dir` (not `dir` itself). Both must be absolute. */
export function isStrictlyWithin(dir: string, candidate: string): boolean {
  const rel = path.relative(dir, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The folder a rule's target can never leave: the part of `target` before the first `$`
 * reference, cut back to a whole folder. `platform-assets/static.wixstatic.com/$1` gives
 * `platform-assets/static.wixstatic.com`; a target with no `$` gives its own folder.
 */
function targetBase(absRoot: string, target: string): string {
  const dollar = target.indexOf('$');
  const fixed = dollar === -1 ? target : target.slice(0, dollar);
  const slash = fixed.lastIndexOf('/');
  const dir = dollar === -1 ? path.dirname(fixed) : slash === -1 ? '.' : fixed.slice(0, slash);
  return path.resolve(absRoot, dir);
}

export type PlatformAssetMatch =
  /** No rule matches: the request is plain external traffic. */
  | { readonly kind: 'unmatched' }
  /** A rule matched but the mapped path is unusable (leaves its folder, bad escapes). */
  | { readonly kind: 'invalid' }
  /**
   * Absolute local file to serve, and the rule's folder it must stay inside. Existence and
   * symlinks are not checked here (no I/O); the caller re-checks `base` on real paths.
   */
  | { readonly kind: 'file'; readonly file: string; readonly base: string };

/**
 * Map `url` to a local file using the first rule whose pattern matches the whole
 * `origin + pathname`. The file must sit inside the rule's own target folder (see
 * `targetBase`), which must itself be inside `root`. Pure: no file-system access.
 */
export function matchPlatformAsset(
  url: string,
  rules: readonly PlatformAssetRule[],
  root: string,
): PlatformAssetMatch {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'unmatched' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'unmatched' };
  const key = `${parsed.origin}${parsed.pathname}`;
  const absRoot = path.resolve(root);

  for (const rule of rules) {
    // Drop g/y so lastIndex state can't make matching depend on call history.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace(/[gy]/g, ''));
    const m = re.exec(key);
    if (!m || m.index !== 0 || m[0].length !== key.length) continue;

    let relative: string;
    try {
      relative = decodeURIComponent(key.replace(re, rule.target));
    } catch {
      return { kind: 'invalid' };
    }
    if (relative.includes('\0') || path.isAbsolute(relative)) return { kind: 'invalid' };
    const base = targetBase(absRoot, rule.target);
    if (base !== absRoot && !isStrictlyWithin(absRoot, base)) return { kind: 'invalid' };
    const file = path.resolve(absRoot, relative);
    return isStrictlyWithin(base, file) ? { kind: 'file', file, base } : { kind: 'invalid' };
  }
  return { kind: 'unmatched' };
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

/** Content-Type for a file name by extension; `application/octet-stream` when unknown. */
export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}
