/**
 * Leak scan for committed fixture files (M1 T6a). Checks that no identity from the ORIGINAL
 * label (name, phone, email, people, address parts, places, own domain, extra identity) survives
 * in any generated file, in any encoding a page can use:
 *
 * - raw text, attribute values and URLs;
 * - HTML entities (`&amp;`, `&#x41;`) and percent-encoding (`%20`, `tel:%2B1...`);
 * - Cloudflare `data-cfemail` values and `email-protection#` hashes (decoded);
 * - JavaScript string escapes (`A`, `\x41`) and JSON string escapes;
 * - file paths.
 *
 * The needles are the same as the label leak check from T5 (`findLabelLeaks`), which collects
 * them from the original label independently of the anonymizer. Pure: the caller reads the
 * original label and the files.
 */
import type { Site } from '@srs/site-model';
import { findLabelLeaks, type LabelLeak } from '../anonymize';
import { decodeCfEmail } from './cfemail';

export interface FileLeak extends LabelLeak {
  /** File (relative to the site directory) where it was found. */
  file: string;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  ndash: '–',
  mdash: '—',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

function unescapeJs(text: string): string {
  return text
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\(["'\\/])/g, '$1');
}

function percentDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Every distinct string a reader (or a browser) could see in a file. */
export function segmentsOf(file: string, content: string): string[] {
  const out = new Set<string>([file]);
  const add = (s: string): void => {
    const t = s.trim();
    if (t !== '') out.add(t);
  };
  const addAll = (s: string): void => {
    add(s);
    const entities = decodeEntities(s);
    add(entities);
    add(percentDecode(entities));
    add(unescapeJs(entities));
    add(percentDecode(unescapeJs(entities)));
  };

  // Cloudflare: decode every `data-cfemail` and `email-protection#` value.
  for (const m of content.matchAll(/data-cfemail="([0-9a-f]+)"/gi))
    addAll(decodeCfEmail(m[1] ?? ''));
  for (const m of content.matchAll(/email-protection#([0-9a-f]+)/gi))
    addAll(decodeCfEmail(m[1] ?? ''));

  if (/\.json$/i.test(file)) {
    const walk = (v: unknown): void => {
      if (typeof v === 'string') addAll(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          addAll(k);
          walk(x);
        }
      }
    };
    walk(JSON.parse(content) as unknown);
    return [...out];
  }

  // Attribute values, then text between tags (HTML/SVG), then every line (CSS, JS, anything).
  for (const m of content.matchAll(/="([^"]*)"|='([^']*)'/g)) addAll(m[1] ?? m[2] ?? '');
  for (const text of content.split(/<[^>]*>/)) addAll(text);
  for (const line of content.split(/\r?\n/)) addAll(line);
  // JS string literals can hold HTML (the DVH feed); scan their contents as markup too.
  for (const m of content.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const inner = unescapeJs(m[1] ?? '');
    for (const attr of inner.matchAll(/="([^"]*)"/g)) addAll(attr[1] ?? '');
    for (const text of inner.split(/<[^>]*>/)) addAll(text);
  }
  return [...out];
}

/**
 * Every original identity value found in `files` (path -> text). `original` is the raw hand
 * label; `extraIdentity` comes from `extraIdentityFor(slug)`.
 */
export function findFileLeaks(
  original: Site,
  files: ReadonlyMap<string, string>,
  extraIdentity: readonly string[],
): FileLeak[] {
  const leaks: FileLeak[] = [];
  for (const [file, content] of files) {
    // findLabelLeaks reads every string in the object it is given; the shape doesn't matter.
    const asLabel = { segments: segmentsOf(file, content) } as unknown as Site;
    for (const leak of findLabelLeaks(original, asLabel, { extraIdentity })) {
      leaks.push({ ...leak, file });
    }
  }
  return leaks;
}
