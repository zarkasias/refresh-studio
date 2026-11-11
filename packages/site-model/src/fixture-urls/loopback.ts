/**
 * Fixture-only URL schemas (ADR-010, M1 T8a). They accept everything the strict `UrlSchema`
 * accepts, plus plain `http:` URLs on a loopback host (`127.0.0.0/8`, `localhost`, `[::1]`) with
 * an optional port and no credentials. Nothing else is loosened.
 *
 * Import this only from `evals/` and test files; ESLint enforces it. Production code (mappers,
 * jobs, the app) uses the strict schemas, so a real project can never point the worker at
 * localhost.
 */
import { z } from 'zod';
import { UrlSchema, makeOriginSchema, type UrlLike, type UrlSchemas } from '../schemas/primitives';

/**
 * True for loopback hosts only: `localhost`, `127.0.0.0/8` and `::1`. Takes a URL `hostname`
 * (IPv6 in brackets) or a bare address. Anything else, including IPv4-mapped IPv6, is external.
 * A pinned copy of `isLoopbackHost` in `evals/fixtures/network-policy.ts`; a test keeps them equal.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  if (h === '::1' || h === '[::1]') return true;
  const octets = h.split('.');
  if (octets.length !== 4 || octets[0] !== '127') return false;
  return octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
}

/** Loopback hosts as literally written: dotted-decimal 127.x.x.x, `localhost` or `[::1]`. */
const LOOPBACK_SPELLING =
  /^http:\/\/(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/;

/**
 * `http:` only, loopback host, no credentials, and written canonically: the host is spelled
 * `127.x.x.x`, `localhost` or `[::1]` (not `2130706433`, `0177.0.0.1`, `127.1`, `localhost.`,
 * look-alike Unicode or a backslash trick), and the value equals what `new URL` makes of it.
 */
export function isLoopbackHttpUrl(value: string): boolean {
  if (/\s/.test(value) || !LOOPBACK_SPELLING.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      url.username === '' &&
      url.password === '' &&
      isLoopbackHost(url.hostname) &&
      (url.href === value || url.origin === value)
    );
  } catch {
    return false;
  }
}

/** Any URL the strict schema accepts, or an `http:` loopback URL. */
export const FixtureUrlSchema: UrlLike = z
  .string()
  .refine((value) => UrlSchema.safeParse(value).success || isLoopbackHttpUrl(value), {
    message: 'Expected an absolute http(s) URL, or http://127.0.0.1:<port> style loopback URL',
  });

/** A bare origin (see `OriginSchema`), loopback allowed. */
export const FixtureOriginSchema: UrlLike = makeOriginSchema(FixtureUrlSchema);

export const FIXTURE_URLS: UrlSchemas = { url: FixtureUrlSchema, origin: FixtureOriginSchema };
