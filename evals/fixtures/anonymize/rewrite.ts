/**
 * String rewriting for the anonymizer: display text, long body text, hrefs, hosts and paths.
 * Pure: everything it needs is in the `RewriteContext` built by `anonymize`.
 *
 * Byte-for-byte rule for hrefs: only letters and digits that carry identity are changed. Every
 * other character, including literal hidden characters (U+200B and friends) and every `%XX`
 * escape, is copied unchanged and stays where it was.
 */
import { type DictMatcher } from './dictionary';
import { hash32, hashStream } from './hash';
import { KEEP_WORDS, NEUTRAL_WORDS, ROLE_LOCAL_PARTS, TOLL_FREE_AREA_CODES } from './vocab';

/** Identity tokens a generated word must not contain (≥ 5 chars) or equal (3–4 chars). */
export class ForbiddenTokens {
  private readonly long: string[] = [];
  private readonly short = new Set<string>();

  constructor(tokens: Iterable<string>) {
    for (const raw of tokens) {
      const t = raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (t.length >= 5) this.long.push(t);
      else if (t.length >= 3) this.short.add(t);
    }
  }

  allows(candidate: string): boolean {
    const c = candidate.toLowerCase();
    for (const word of c.split(/[^\p{L}\p{N}]+/u)) if (this.short.has(word)) return false;
    const compact = c.replace(/[^\p{L}\p{N}]/gu, '');
    return !this.long.some((t) => compact.includes(t));
  }
}

const isPctEscapeAt = (s: string, i: number): boolean =>
  s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3));

/**
 * Fictional phone numbers in the reserved `555-0100`–`555-0199` range, one per distinct number.
 * The key is the number's digits without a leading NANP `1`, so `tel:+1…`, `(719) …` and
 * `719-…` written for the same number all get the same fake, and two different numbers never do.
 */
export class PhoneMapper {
  private readonly cache = new Map<string, string>();
  private readonly areas = new Map<string, string>();
  private readonly usedAreas = new Set<string>();
  private readonly usedLines = new Set<number>();

  constructor(private readonly seed: string) {}

  /** Map a digit string of the same length (7, 10, or 11 starting with 1; others are scrambled). */
  mapDigits(digits: string): string {
    if (digits.length === 11 && digits.startsWith('1')) return `1${this.map10(digits.slice(1))}`;
    if (digits.length === 10) return this.map10(digits);
    if (digits.length === 7) return this.map7(digits);
    const next = hashStream(this.seed, 'digits', digits);
    let out = '';
    for (let i = 0; i < digits.length; i++) out += String(next() % 10);
    return out;
  }

  /**
   * Replace the digits in `s` (a `tel:` body or a displayed number) in place. Digits inside
   * `%XX` escapes are not phone digits and are left alone, as is every non-digit character.
   */
  rewriteDigits(s: string): string {
    const positions: number[] = [];
    let digits = '';
    for (let i = 0; i < s.length;) {
      if (isPctEscapeAt(s, i)) {
        i += 3;
        continue;
      }
      const ch = s[i] ?? '';
      if (ch >= '0' && ch <= '9') {
        positions.push(i);
        digits += ch;
      }
      i++;
    }
    if (digits.length === 0) return s;
    const mapped = this.mapDigits(digits);
    const chars = s.split('');
    positions.forEach((p, k) => {
      chars[p] = mapped[k] ?? '0';
    });
    return chars.join('');
  }

  private map10(d: string): string {
    const hit = this.cache.get(d);
    if (hit) return hit;
    const fake = `${this.area(d.slice(0, 3))}55501${this.line(d)}`;
    this.cache.set(d, fake);
    return fake;
  }

  /**
   * Map every full (10/11-digit) number in `values` first, so a 7-digit form of a number seen
   * anywhere in the label (`tel:441-4444` for `307-441-4444`) maps to the same fake whatever
   * order the strings are visited in.
   */
  prime(values: Iterable<string>): void {
    for (const value of values) {
      const candidates = /^(?:tel|sms):/i.test(value) ? [value.slice(4)] : [];
      for (const m of value.matchAll(PHONE_IN_TEXT_RE)) candidates.push(m[0]);
      for (const c of candidates) {
        const digits = c.replace(/%[0-9A-Fa-f]{2}/g, '').replace(/\D/g, '');
        if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
          this.mapDigits(digits);
        }
      }
    }
  }

  /**
   * The fake local part (7 digits) of an already mapped full number whose last 7 digits are `d`,
   * or undefined. Used for 7-digit numbers in display text, which are only treated as phones when
   * they match a number the label shows in full.
   */
  knownLocal(d: string): string | undefined {
    for (const [full, fake10] of this.cache) {
      if (full.length === 10 && full.slice(3) === d) return fake10.slice(3);
    }
    return undefined;
  }

  private map7(d: string): string {
    const key = `7:${d}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    // A match stays a match: same last 7 digits as a full number → same fake local part.
    for (const [full, fake10] of this.cache) {
      if (full.length === 10 && full.slice(3) === d) {
        const fake = fake10.slice(3);
        this.cache.set(key, fake);
        return fake;
      }
    }
    const fake = `55501${this.line(key)}`;
    this.cache.set(key, fake);
    return fake;
  }

  /**
   * A fictional area code per distinct real one (same area code stays the same). Local numbers
   * never get a toll-free code; a toll-free number gets a toll-free code.
   */
  private area(real: string): string {
    const hit = this.areas.get(real);
    if (hit) return hit;
    const tollFree = TOLL_FREE_AREA_CODES.includes(real);
    for (let k = 0; ; k++) {
      const n = hash32(this.seed, 'area', real, String(k));
      const code = tollFree
        ? (TOLL_FREE_AREA_CODES[n % TOLL_FREE_AREA_CODES.length] ?? real)
        : `${2 + (n % 8)}${(n >>> 3) % 10}${(n >>> 7) % 10}`;
      if (tollFree) {
        if (this.usedAreas.has(code) && k < 50) continue;
        this.usedAreas.add(code);
        this.areas.set(real, code);
        return code;
      }
      const nEleven = code.endsWith('11');
      if (
        code === real ||
        nEleven ||
        code === '555' ||
        TOLL_FREE_AREA_CODES.includes(code) ||
        this.usedAreas.has(code)
      )
        continue;
      this.usedAreas.add(code);
      this.areas.set(real, code);
      return code;
    }
  }

  /** The `xx` of `555-01xx`, unique per distinct number within one label. */
  private line(key: string): string {
    const start = hash32(this.seed, 'line', key) % 100;
    for (let i = 0; i < 100; i++) {
      const c = (start + i) % 100;
      if (!this.usedLines.has(c)) {
        this.usedLines.add(c);
        return String(c).padStart(2, '0');
      }
    }
    throw new Error('anonymize: more than 100 distinct phone numbers in one label');
  }
}

/** Shape-preserving scramble for opaque ids: digit → digit, lower → lower, upper → upper. */
export class Scrambler {
  private readonly cache = new Map<string, string>();

  constructor(private readonly seed: string) {}

  scramble(word: string): string {
    const hit = this.cache.get(word);
    if (hit !== undefined) return hit;
    const hex = /^[0-9a-f]+$/.test(word);
    for (let attempt = 0; ; attempt++) {
      const next = hashStream(this.seed, 'opaque', word, String(attempt));
      let out = '';
      for (const ch of word) {
        if (ch >= '0' && ch <= '9') out += String(next() % 10);
        else if (ch >= 'a' && ch <= 'z')
          out += hex ? 'abcdef'[next() % 6] : String.fromCharCode(97 + (next() % 26));
        else if (ch >= 'A' && ch <= 'Z') out += String.fromCharCode(65 + (next() % 26));
        else if (/\p{L}/u.test(ch)) out += String.fromCharCode(97 + (next() % 26));
        else out += ch;
      }
      if (out !== word) {
        this.cache.set(word, out);
        return out;
      }
    }
  }
}

/** Opaque ids in URLs (`UCZ9AJ2Ul4…`, `501471`, `6fbf59_…`): 5+ characters, 2+ digits. */
const isOpaque = (word: string): boolean => word.length >= 5 && /\d.*\d/.test(word);

/** Same-length neutral words for long body text, with the original's capital letters. */
export class Neutralizer {
  private readonly byLength = new Map<number, string[]>();
  private readonly all: string[];

  constructor(
    private readonly seed: string,
    forbidden: ForbiddenTokens,
  ) {
    this.all = NEUTRAL_WORDS.filter((w) => forbidden.allows(w));
    for (const w of this.all) {
      const bucket = this.byLength.get(w.length) ?? [];
      bucket.push(w);
      this.byLength.set(w.length, bucket);
    }
  }

  word(original: string): string {
    const lower = original.toLowerCase();
    const len = original.length;
    const bucket = this.byLength.get(len);
    let base: string;
    if (bucket && bucket.length > 0) {
      base = bucket[hash32(this.seed, 'word', lower) % bucket.length] ?? '';
    } else {
      const next = hashStream(this.seed, 'word', lower);
      base = '';
      while (base.length < len) base += this.all[next() % this.all.length] ?? 'x';
      base = base.slice(0, len);
    }
    let out = '';
    for (let i = 0; i < len; i++) {
      const o = original[i] ?? '';
      const b = base[i] ?? 'x';
      out += o !== o.toLowerCase() ? b.toUpperCase() : b;
    }
    return out;
  }
}

/** Fictional emails at `example.com`, one per distinct address (case-insensitive). */
export class EmailMapper {
  private readonly cache = new Map<string, string>();
  /** fake address (lowercase) → original address (lowercase) */
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly matcher: DictMatcher,
    private readonly scrambler: Scrambler,
  ) {}

  map(address: string): string {
    const hit = this.cache.get(address);
    if (hit) return hit;
    const at = address.lastIndexOf('@');
    const local = address.slice(0, at);
    let fakeLocal: string;
    if (ROLE_LOCAL_PARTS.has(local.toLowerCase())) {
      fakeLocal = local;
    } else {
      const replaced = this.matcher.replaceAll(local).replace(/[^A-Za-z0-9._+-]/g, '');
      fakeLocal =
        replaced !== local && replaced.length > 0 ? replaced : this.scrambler.scramble(local);
    }
    const original = address.toLowerCase();
    let candidate = `${fakeLocal}@example.com`;
    for (let n = 2; ; n++) {
      const owner = this.owners.get(candidate.toLowerCase());
      if (owner === undefined || owner === original) break;
      candidate = `${fakeLocal}${n}@example.com`;
    }
    this.owners.set(candidate.toLowerCase(), original);
    this.cache.set(address, candidate);
    return candidate;
  }
}

export interface RewriteContext {
  matcher: DictMatcher;
  phones: PhoneMapper;
  emails: EmailMapper;
  scrambler: Scrambler;
  neutralizer: Neutralizer;
}

interface Span {
  start: number;
  end: number;
  text: string;
}

function addSpans(spans: Span[], found: Iterable<Span>): void {
  for (const f of found) {
    if (spans.some((s) => f.start < s.end && s.start < f.end)) continue;
    spans.push(f);
  }
}

function* matches(
  text: string,
  re: RegExp,
  rewrite: (m: string) => string,
  trimTrailing?: RegExp,
): Generator<Span> {
  for (const m of text.matchAll(re)) {
    let value = m[0];
    if (trimTrailing) value = value.replace(trimTrailing, '');
    if (value.length === 0) continue;
    yield { start: m.index, end: m.index + value.length, text: rewrite(value) };
  }
}

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_IN_TEXT_RE = /\bhttps?:\/\/[^\s"'<>·|]+/giu;
const DOMAIN_IN_TEXT_RE =
  /(?<![\p{L}\p{N}@./-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|co|dev|io|us|biz|info|me|online|app|page|site|example)(?![\p{L}\p{N}-])(?:\/[^\s"'<>·|]*)?/giu;
const TRAILING_PUNCT_RE = /[.,;:!?)\]'"’]+$/u;
/** Separators allowed inside a displayed phone number, including hidden characters. */
const PHONE_SEP = String.raw`[\s.\-\u00AD\u200B-\u200F\u2060\u202A-\u202E\uFEFF]`;
const PHONE_IN_TEXT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}.])(?:\+?1${PHONE_SEP}*)?(?:\(\d{3}\)|\d{3})${PHONE_SEP}*\d{3}${PHONE_SEP}*\d{4}(?![\p{L}\p{N}])`,
  'gu',
);
const ENTITY_RE = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g;
/**
 * A 7-digit local number in text (`473-8545`): three digits, a separator, four digits, not part of
 * a longer number, a licence (`PC.0000533`) or a word. Only mapped when it matches a full number
 * from the label (see `PhoneMapper.knownLocal`), so ZIPs, years and counts are never touched.
 */
const LOCAL_PHONE_IN_TEXT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}.\-)])\d{3}${PHONE_SEP}+\d{4}(?![\p{L}\p{N}]|${PHONE_SEP}\d)`,
  'gu',
);

function* localPhoneSpans(text: string, ctx: RewriteContext): Generator<Span> {
  for (const m of text.matchAll(LOCAL_PHONE_IN_TEXT_RE)) {
    const digits = m[0].replace(/\D/g, '');
    const fake = ctx.phones.knownLocal(digits);
    if (!fake) continue;
    let k = 0;
    const rewritten = m[0].replace(/\d/g, () => fake[k++] ?? '0');
    yield { start: m.index, end: m.index + m[0].length, text: rewritten };
  }
}

function assemble(text: string, spans: Span[], gap: (s: string) => string): string {
  spans.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const s of spans) {
    out += gap(text.slice(at, s.start)) + s.text;
    at = s.end;
  }
  return out + gap(text.slice(at));
}

function neutralizeProse(gap: string, ctx: RewriteContext): string {
  return gap.replace(/[\p{L}\p{N}]+/gu, (w) => {
    if (/\p{N}/u.test(w) || w.length <= 2 || KEEP_WORDS.has(w.toLowerCase())) return w;
    return ctx.neutralizer.word(w);
  });
}

/**
 * Rewrite display text. Emails, URLs and domains, phone numbers and dictionary entries (names,
 * people, places, streets, ZIPs, licences) are replaced wherever they appear. In `long` mode the
 * remaining prose words are also swapped for neutral words of the same length (see KEEP_WORDS).
 */
export function rewriteText(text: string, ctx: RewriteContext, long: boolean): string {
  const spans: Span[] = [];
  addSpans(
    spans,
    matches(text, EMAIL_RE, (m) => ctx.emails.map(m)),
  );
  addSpans(
    spans,
    matches(text, URL_IN_TEXT_RE, (m) => rewriteHref(m, ctx), TRAILING_PUNCT_RE),
  );
  addSpans(
    spans,
    matches(text, DOMAIN_IN_TEXT_RE, (m) => rewriteBareDomain(m, ctx), TRAILING_PUNCT_RE),
  );
  addSpans(
    spans,
    matches(text, PHONE_IN_TEXT_RE, (m) => ctx.phones.rewriteDigits(m)),
  );
  addSpans(spans, localPhoneSpans(text, ctx));
  addSpans(
    spans,
    ctx.matcher.find(text).map((m) => ({ start: m.start, end: m.end, text: m.replacement })),
  );
  // HTML entities (`&amp;`) are kept whole, after the dictionary so `Hair &amp; Co` still matches.
  addSpans(
    spans,
    matches(text, ENTITY_RE, (m) => m),
  );
  return assemble(text, spans, long ? (g) => neutralizeProse(g, ctx) : (g) => g);
}

function scrambleOpaque(gap: string, ctx: RewriteContext): string {
  let out = '';
  for (let i = 0; i < gap.length;) {
    if (isPctEscapeAt(gap, i)) {
      out += gap.slice(i, i + 3);
      i += 3;
      continue;
    }
    const word = /^[\p{L}\p{N}]+/u.exec(gap.slice(i))?.[0];
    if (word) {
      out += isOpaque(word) ? ctx.scrambler.scramble(word) : word;
      i += word.length;
    } else {
      out += gap[i] ?? '';
      i++;
    }
  }
  return out;
}

/**
 * Rewrite a path, query and fragment (or a relative href). Dictionary entries and emails are
 * replaced and opaque ids scrambled; separators and `%XX` escapes are untouched.
 */
export function rewriteUrlRest(rest: string, ctx: RewriteContext): string {
  const spans: Span[] = [];
  addSpans(
    spans,
    matches(rest, EMAIL_RE, (m) => ctx.emails.map(m)),
  );
  addSpans(
    spans,
    ctx.matcher.find(rest).map((m) => ({ start: m.start, end: m.end, text: m.replacement })),
  );
  return assemble(rest, spans, (g) => scrambleOpaque(g, ctx));
}

/**
 * Rewrite a host (`www.jollyplumbing.net`, `hairandco.mylocalsalon.com`). Identity in any label
 * is replaced; when the registrable name itself changed, the TLD becomes the reserved
 * `.example`, so the result can never be someone's real domain. Provider hosts are unchanged.
 */
export function rewriteHost(authority: string, ctx: RewriteContext): string {
  const m = /^([^@/]*@)?([^:]*)(:\d+)?$/.exec(authority);
  if (!m) return authority;
  const host = m[2] ?? '';
  const replaced = ctx.matcher
    .replaceAll(host)
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '');
  if (replaced === host.toLowerCase()) return authority;
  const labels = replaced.split('.');
  const original = host.toLowerCase().split('.');
  if (labels.length >= 2 && labels.at(-2) !== original.at(-2))
    labels[labels.length - 1] = 'example';
  return `${m[1] ?? ''}${labels.join('.')}${m[3] ?? ''}`;
}

function rewriteBareDomain(value: string, ctx: RewriteContext): string {
  const slash = value.indexOf('/');
  if (slash === -1) return rewriteHost(value, ctx);
  return rewriteHost(value.slice(0, slash), ctx) + rewriteUrlRest(value.slice(slash), ctx);
}

/**
 * Rewrite an href as found on the site: `tel:`/`sms:` digits are mapped in place, `mailto:`
 * addresses are mapped, http(s) URLs get the host and path treatment, relative hrefs the path
 * treatment. Other schemes (`javascript:`) are kept.
 */
export function rewriteHref(href: string, ctx: RewriteContext): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === 'tel' || scheme === 'sms') {
    const cut = scheme.length + 1;
    return href.slice(0, cut) + ctx.phones.rewriteDigits(href.slice(cut));
  }
  if (scheme === 'mailto') {
    const body = href.slice(7);
    const q = body.indexOf('?');
    const addresses = q === -1 ? body : body.slice(0, q);
    const query = q === -1 ? '' : body.slice(q);
    const mapped = addresses.replace(EMAIL_RE, (m) => ctx.emails.map(m));
    return `${href.slice(0, 7)}${mapped === addresses ? ctx.matcher.replaceAll(addresses) : mapped}${rewriteUrlRest(query, ctx)}`;
  }
  const abs = /^((?:https?:)?\/\/)([^/?#]*)([\s\S]*)$/i.exec(href);
  if (abs && (scheme === undefined || scheme === 'http' || scheme === 'https')) {
    return `${abs[1] ?? ''}${rewriteHost(abs[2] ?? '', ctx)}${rewriteUrlRest(abs[3] ?? '', ctx)}`;
  }
  if (scheme !== undefined) return href;
  return rewriteUrlRest(href, ctx);
}
