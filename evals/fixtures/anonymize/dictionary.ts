/**
 * The identity dictionary: every name, place, street, ZIP and licence found in a label, each
 * with its fictional replacement. One matcher finds them in display text, ids and URL parts.
 *
 * Matching is case-insensitive and tolerant of the separators sites use between words
 * (`Santa Fe`, `santa-fe`, `Santa_Fe`, `santafe`, `Santa+Fe`, `santa%20fe`), so a handle or a
 * path segment is caught as well as display text. The replacement copies the matched text's
 * case style and separator.
 */

export type EntryKind =
  'business' | 'own-domain' | 'person' | 'place' | 'street' | 'zip' | 'license' | 'name-token';

export interface DictEntry {
  /** The original words, e.g. `['Colorado', 'Springs']`. */
  words: readonly string[];
  /** The fictional text, words separated by single spaces, e.g. `Oakmere`. */
  replacement: string;
  kind: EntryKind;
  /**
   * Must not be followed by a lowercase letter. For entries made of common words (the "Hair & Co"
   * core of a name), so `hair-and-co` and `hairandco/` match but "Hair Color" does not.
   */
  endGuard?: boolean;
  /**
   * Must sit on word boundaries whatever its length. For single words from location labels
   * ("Prospect"): `home-team-prospect` matches, "Prospective" and "Prospects" do not.
   */
  wordBoundary?: boolean;
}

export interface DictMatch {
  start: number;
  end: number;
  /** The fictional text formatted like the matched text. */
  replacement: string;
  kind: EntryKind;
}

/** Separators allowed between the words of an entry (none is fine too: `santafe`). */
const SEP = String.raw`(?:[\s\-_.+,’']|%20|%2[dD]|%2[bB])*`;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export const compactOf = (words: readonly string[]): string =>
  words
    .join('')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

function wordPattern(word: string): string {
  const lower = word.toLowerCase();
  // "&" may be written "and", "&amp;", or dropped in a slug ("heating-cooling").
  if (lower === '&' || lower === 'and' || lower === '&amp;') return '(?:&amp;|&|and)?';
  // "Springs" also matches the possessive "Spring’s".
  if (/^\p{L}{4,}s$/u.test(word)) return `${escapeRe(word.slice(0, -1))}(?:s|[’']s?)`;
  return escapeRe(word);
}

/** Short tokens and anything with digits must sit on word boundaries; longer ones may sit inside a handle. */
function needsBoundary(entry: DictEntry): boolean {
  const compact = compactOf(entry.words);
  return entry.wordBoundary === true || compact.length < 5 || /\d/.test(compact);
}

function entrySource(entry: DictEntry): string {
  const body = entry.words.map(wordPattern).join(SEP);
  if (needsBoundary(entry)) return `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
  return entry.endGuard ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{Ll}])` : body;
}

/**
 * Format `replacement` like `matched`: same separator between words (none for `santafe`-style
 * compact text) and same case style (ALL CAPS, all lower, or as given).
 */
export function formatLike(matched: string, replacement: string): string {
  const words = replacement.split(' ').filter(Boolean);
  // Display text ("Santa Fe", "T.J. Haas") joins with a space; handles and URL parts keep their
  // own separator ("santa-fe", "delaware.valley", "Santa_Fe", "santa%20fe") or none ("santafe").
  let joiner = '';
  if (/\s/.test(matched)) joiner = ' ';
  else {
    const sep = /[\p{L}\p{N}]((?:[-_.+,’']|%20|%2[dDbB])+)[\p{L}\p{N}]/u.exec(matched);
    if (sep?.[1] !== undefined) joiner = sep[1];
  }
  let out = words.join(joiner);
  const letters = matched.replace(/[^\p{L}]/gu, '');
  if (
    letters.length >= 2 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  ) {
    out = out.toUpperCase();
  } else if (letters.length > 0 && letters === letters.toLowerCase()) {
    out = out.toLowerCase();
  }
  return out;
}

export class DictMatcher {
  private readonly entries: DictEntry[];
  private readonly re: RegExp | undefined;

  constructor(entries: readonly DictEntry[]) {
    // Longest first, so "West Des Moines" wins over "Des Moines", and a full business name wins
    // over the city inside it. Among equal lengths, the earlier entry wins (stable sort).
    const seen = new Set<string>();
    const unique: DictEntry[] = [];
    const sorted = [...entries].sort(
      (a, b) => compactOf(b.words).length - compactOf(a.words).length,
    );
    for (const entry of sorted) {
      if (compactOf(entry.words).length === 0) continue;
      const source = entrySource(entry);
      const key = source.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(entry);
    }
    this.entries = unique;
    this.re =
      unique.length > 0
        ? new RegExp(unique.map((e) => `(${entrySource(e)})`).join('|'), 'giu')
        : undefined;
  }

  /** All non-overlapping matches, left to right. */
  find(text: string): DictMatch[] {
    if (!this.re) return [];
    const out: DictMatch[] = [];
    this.re.lastIndex = 0;
    for (let m = this.re.exec(text); m; m = this.re.exec(text)) {
      const group = m.findIndex((g, i) => i > 0 && g !== undefined);
      const entry = this.entries[group - 1];
      if (!entry || m[0].length === 0) {
        this.re.lastIndex = m.index + 1;
        continue;
      }
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        replacement: formatLike(m[0], entry.replacement),
        kind: entry.kind,
      });
    }
    return out;
  }

  /** Replace every match in `text`. */
  replaceAll(text: string): string {
    let out = '';
    let at = 0;
    for (const m of this.find(text)) {
      out += text.slice(at, m.start) + m.replacement;
      at = m.end;
    }
    return out + text.slice(at);
  }
}
