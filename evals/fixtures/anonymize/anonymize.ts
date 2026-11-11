/**
 * Label anonymizer (M1 T5, decision D8, ADR-010 draft).
 *
 * `anonymize(label, seed)` turns a hand label (`evals/sites/<slug>/expected.site.json`) into a
 * label-shaped document with fictional identity, so synthetic fixtures can be built from it
 * without copying client content (ADR-004: "copy a pattern, never content").
 *
 * Replaced (identity): the business name (→ `Acme <Type> Co`), phone numbers (→ `555-01xx`, one
 * fake per distinct number), emails (→ `@example.com`), streets, cities, ZIPs and building names
 * (the state is kept), people, service-area places and neighbourhood labels, licence numbers,
 * the site's own domain, handles and opaque ids in URLs, and long body text (→ neutral words of
 * the same length, keeping hours, copyright lines and the labeler's pattern notes).
 *
 * Kept (pattern): structure, section types, hours times and day ranges, hex colors, fonts, CTA
 * kinds and providers, platform fields, third-party hosts, URL paths apart from identity tokens,
 * and every non-identity character of an href byte for byte (hidden characters, `%XX`).
 *
 * Pure and deterministic: no I/O, no randomness, no clock. The same label and seed always give
 * the same output, and the output validates against `SiteSchema` like the input.
 */
import { SiteSchema, type Site } from '@srs/site-model';
import { parseUsAddress, type ParsedStreet } from './address';
import { DictMatcher, type DictEntry } from './dictionary';
import { hash32, hashStream } from './hash';
import {
  EMAIL_RE,
  EmailMapper,
  ForbiddenTokens,
  Neutralizer,
  PhoneMapper,
  type RewriteContext,
  Scrambler,
  rewriteHref,
  rewriteText,
  rewriteUrlRest,
} from './rewrite';
import {
  BUSINESS_TYPE_RULES,
  FIRST_NAMES,
  GENERIC_BUILDING_WORDS,
  GENERIC_LOCATION_WORDS,
  GENERIC_NAME_WORDS,
  GEO_NOUNS,
  LAST_NAMES,
  LEGAL_SUFFIXES,
  PERSON_TITLES,
  PLACE_PREFIXES,
  PLACE_SUFFIXES,
  PLACE_TAILS,
  ROLE_LOCAL_PARTS,
  STATE_NAMES_LOWER,
  STREET_NAMES,
  US_STATES,
} from './vocab';

export interface AnonymizeOptions {
  /**
   * The `<Type>` in `Acme <Type> Co`, e.g. `Plumbing`. Default: inferred from the business name,
   * then the page titles (`Local` if nothing matches).
   */
  businessType?: string;
  /**
   * Extra identity strings for this label that no structured field records: landmarks, regions
   * and districts named only in headings or titles (e.g. a lake the business is near). Each is
   * replaced with a fictional place name everywhere, like a service-area place. Per-slug lists
   * live in `extra-identity.ts`; `findLabelLeaks` checks them too.
   */
  extraIdentity?: readonly string[];
}

/** Body text at least this long is replaced with neutral words; shorter text keeps its wording. */
export const LONG_TEXT_MIN_LENGTH = 40;

// ---------------------------------------------------------------------------------------------
// Field classification. Keys are JSON paths with array indexes written as `*`.

const C = 'pages.*.sections.*.content';

/** Values copied unchanged (patterns, not identity). `brand.*` is kept as a whole. */
const KEEP_KEYS: ReadonlySet<string> = new Set([
  'platform',
  'platformDetails.pageBuilder',
  'platformDetails.builder',
  'platformEvidence.*.where',
  'business.socialLinks.*.network',
  'pages.*.ogImageAssetId',
  'pages.*.sections.*.type',
  `${C}.ctas.*.kind`,
  `${C}.ctas.*.provider`,
  `${C}.form.fields.*.type`,
  `${C}.imageAssetIds.*`,
  `${C}.items.*.imageAssetId`,
  `${C}.items.*.children.*.imageAssetId`,
]);

/** hrefs and URLs: host, path and scheme-specific rewriting (`tel:`, `mailto:`). */
const HREF_KEYS: ReadonlySet<string> = new Set([
  'sourceUrl',
  'business.googleBusinessUrl',
  'business.socialLinks.*.url',
  'business.locations.*.googleBusinessUrl',
  'business.trust.credentials.*.url',
  `${C}.ctas.*.href`,
  `${C}.items.*.link`,
  `${C}.items.*.children.*.link`,
]);

/** Body text: replaced with neutral words when at least LONG_TEXT_MIN_LENGTH long. */
const LONG_KEYS: ReadonlySet<string> = new Set([
  `${C}.body`,
  `${C}.items.*.body`,
  `${C}.items.*.children.*.body`,
  'pages.*.metaDescription',
  `${C}.form.confirmation`,
]);

type Mode = 'keep' | 'short' | 'long' | 'href' | 'path' | 'business-name';

function modeFor(key: string): Mode {
  if (key === 'business.name') return 'business-name';
  if (key === 'brand' || key.startsWith('brand.')) return 'keep';
  if (KEEP_KEYS.has(key)) return 'keep';
  if (HREF_KEYS.has(key)) return 'href';
  if (key === 'pages.*.path') return 'path';
  if (LONG_KEYS.has(key)) return 'long';
  // Everything else (titles, headings, labels, ids, hours, trust, people, places...) keeps its
  // wording but has every identity token replaced.
  return 'short';
}

// ---------------------------------------------------------------------------------------------
// Collecting identity from the label.

interface LabelString {
  key: string;
  value: string;
}

function collectStrings(value: unknown, path: string[], out: LabelString[]): void {
  if (typeof value === 'string') out.push({ key: path.join('.'), value });
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, [...path, '*'], out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, [...path, k], out);
  }
}

const lettersOf = (w: string): string => w.replace(/[^\p{L}]/gu, '');

function businessWords(name: string): string[] {
  return name
    .trim()
    .split(/\s+/u)
    .map((w) => w.replace(/[,.]+$/u, ''))
    .filter(Boolean);
}

function isInitial(word: string): boolean {
  return (
    /^[\p{L}.]+$/u.test(word) &&
    word.replace(/\./g, '').length <= 2 &&
    (word.includes('.') || word.length === 1)
  );
}

function personWords(name: string): string[] {
  const words = name
    .trim()
    .split(/\s+/u)
    .map((w) => w.replace(/,+$/u, ''))
    .filter(Boolean);
  while (words.length > 1 && PERSON_TITLES.has((words[0] ?? '').toLowerCase().replace(/\.$/, ''))) {
    words.shift();
  }
  return words;
}

function inferBusinessType(label: Site): string {
  const sources = [label.business.name, ...label.pages.map((p) => p.title)];
  for (const source of sources) {
    for (const [re, type] of BUSINESS_TYPE_RULES) if (re.test(source)) return type;
  }
  return 'Local';
}

function ownDomainLabel(sourceUrl: string): string | undefined {
  const host = /^[a-z]+:\/\/([^/?#:]+)/i.exec(sourceUrl)?.[1]?.toLowerCase();
  const labels = host?.split('.') ?? [];
  return labels.length >= 2 ? labels.at(-2) : undefined;
}

/** Deterministic pick from `list` that the forbidden set allows and nothing else has taken. */
function pickFake(
  list: readonly string[],
  key: string,
  seed: string,
  salt: string,
  used: Set<string>,
  forbidden: ForbiddenTokens,
): string {
  const start = hash32(seed, salt, key.toLowerCase()) % list.length;
  // First pass: a fake within 2 characters of the original's length, so text keeps its length
  // roughly (a list of 24 towns stays about as long). Second pass: any length.
  for (const maxDiff of [2, Infinity]) {
    for (let i = 0; i < list.length; i++) {
      const candidate = list[(start + i) % list.length] ?? '';
      const lower = candidate.toLowerCase();
      if (Math.abs(candidate.length - key.length) > maxDiff) continue;
      if (!used.has(lower) && forbidden.allows(candidate) && lower !== key.toLowerCase()) {
        used.add(lower);
        return candidate;
      }
    }
  }
  for (let n = 2; ; n++) {
    const candidate = `${list[start] ?? 'Fake'}${n}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

function fakeDigits(original: string, seed: string, salt: string): string {
  for (let attempt = 0; ; attempt++) {
    const next = hashStream(seed, salt, original, String(attempt));
    let out = '';
    for (const ch of original) {
      if (ch >= '0' && ch <= '9') out += String(out.length === 0 ? 1 + (next() % 9) : next() % 10);
      else out += ch;
    }
    if (out !== original) return out;
  }
}

/** Same shape, fictional digits; the first digit (the national ZIP area) is kept. */
function fakeZip(zip: string, seed: string): string {
  for (let attempt = 0; ; attempt++) {
    const next = hashStream(seed, 'zip', zip, String(attempt));
    const out = zip.replace(/\d/g, (d, i: number) => (i === 0 ? d : String(next() % 10)));
    if (out !== zip) return out;
  }
}

/**
 * Licence numbers keep their letters, punctuation, digit count and leading zeros; only the
 * significant digits are fictional (`PC.0000533` → `PC.0000xyz`, x non-zero).
 */
export function fakeLicense(license: string, seed: string): string {
  if (!/[1-9]/.test(license)) return license;
  for (let attempt = 0; ; attempt++) {
    const next = hashStream(seed, 'license', license, String(attempt));
    const out = license.replace(/\d+/g, (run) => {
      const zeros = /^0*/.exec(run)?.[0] ?? '';
      const significant = run.slice(zeros.length);
      if (significant.length === 0) return run;
      let fake = String(1 + (next() % 9));
      for (let i = 1; i < significant.length; i++) fake += String(next() % 10);
      return zeros + fake;
    });
    if (out !== license) return out;
  }
}

const ORDINAL_RE = /^\d+(?:st|nd|rd|th)$/i;

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen
    ? 'th'
    : n % 10 === 1
      ? 'st'
      : n % 10 === 2
        ? 'nd'
        : n % 10 === 3
          ? 'rd'
          : 'th';
  return `${n}${suffix}`;
}

const PLACE_NAMES: readonly string[] = PLACE_PREFIXES.flatMap((p) =>
  PLACE_SUFFIXES.map((s) => `${p}${s}`),
);
/** For multi-word originals ("Colorado Springs"): one- or two-word fakes ("Oakmere Landing"). */
const MULTI_WORD_PLACE_NAMES: readonly string[] = [
  ...PLACE_NAMES,
  ...PLACE_NAMES.flatMap((p) => PLACE_TAILS.map((t) => `${p} ${t}`)),
];

function buildContext(
  label: Site,
  seed: string,
  options: AnonymizeOptions,
): {
  rewrite: RewriteContext;
  anonName: string;
} {
  const strings: LabelString[] = [];
  collectStrings(label, [], strings);

  // 1. Gather the originals.
  const nameWords = businessWords(label.business.name);
  const distinctive = nameWords.filter(
    (w) => !GENERIC_NAME_WORDS.has(w.toLowerCase()) && lettersOf(w).length >= 3,
  );
  const ownLabel = ownDomainLabel(label.sourceUrl);

  const people: string[][] = [];
  const addPerson = (name: string): void => {
    const words = personWords(name);
    if (words.some((w) => !isInitial(w) && lettersOf(w).length >= 2)) people.push(words);
  };
  for (const person of label.business.people ?? []) addPerson(person.name);
  for (const page of label.pages) {
    for (const section of page.sections) {
      for (const item of section.content.items ?? []) {
        if ((section.type === 'testimonials' || section.type === 'team') && item.title) {
          addPerson(item.title);
        }
        // Portfolio-style titles: "Angled Bob by <Name>".
        const by = item.title
          ? /\bby\s+(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)\b/u.exec(item.title)
          : null;
        if (by?.[1]) addPerson(by[1]);
      }
    }
  }
  for (const { value } of strings) {
    for (const m of value.matchAll(
      /\b(?:[Ss]ite(?:\s+design(?:ed)?)?|[Dd]esign(?:ed)?)\s+by\s+(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)/gu,
    )) {
      if (m[1]) addPerson(m[1]);
    }
    for (const m of value.matchAll(/\bDr\.?\s+(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)/gu)) {
      if (m[1]) addPerson(m[1]);
    }
  }

  const places: string[][] = [];
  const addPlace = (text: string, evenIfState = false): void => {
    const words = text.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) return;
    if (!evenIfState && STATE_NAMES_LOWER.has(words.join(' ').toLowerCase())) return;
    places.push(words);
  };
  const streets: ParsedStreet[] = [];
  const zips: string[] = [];
  const addresses = [
    label.business.address,
    ...(label.business.locations ?? []).map((l) => l.address),
  ].filter((a): a is string => typeof a === 'string' && a.length > 0);
  for (const address of addresses) {
    const parsed = parseUsAddress(address);
    if (parsed.street) streets.push(parsed.street);
    if (parsed.city) addPlace(parsed.city);
    if (parsed.zip) zips.push(parsed.zip);
    for (const w of parsed.building?.split(/\s+/u) ?? []) {
      if (!GENERIC_BUILDING_WORDS.has(w.toLowerCase()) && lettersOf(w).length >= 3) addPlace(w);
    }
  }
  for (const place of label.business.serviceArea?.places ?? []) addPlace(place);
  // Location labels ("Prospect Heights"): the phrase, and each distinctive word on its own
  // ("prospect" in a section id). Geographic nouns ("Heights", "Ridge") are too common to replace
  // alone; they are caught next to a name in a slug instead (see below).
  const locationNames: string[] = [];
  for (const location of label.business.locations ?? []) {
    const name = location.label.replace(/\s*\([^)]*\)/gu, '').trim();
    const words = name.split(/\s+/u).filter(Boolean);
    if (words.length > 0 && !words.every((w) => GENERIC_LOCATION_WORDS.has(w.toLowerCase()))) {
      addPlace(name);
      locationNames.push(name);
      if (words.length > 1) {
        for (const w of words) {
          const lower = w.toLowerCase();
          if (
            lettersOf(w).length >= 3 &&
            !GENERIC_LOCATION_WORDS.has(lower) &&
            !GEO_NOUNS.has(lower)
          ) {
            addPlace(w);
          }
        }
      }
    }
  }
  for (const extra of options.extraIdentity ?? []) addPlace(extra, true);

  const licenses = (label.business.trust?.licenses ?? []).map((l) => l.number);

  const emailLocals = new Set<string>();
  const emailDomains = new Set<string>();
  for (const { value } of strings) {
    for (const m of value.matchAll(EMAIL_RE)) {
      const at = m[0].lastIndexOf('@');
      emailLocals.add(m[0].slice(0, at));
      emailDomains.add(m[0].slice(at + 1).toLowerCase());
    }
  }

  // 2. Forbidden tokens: no fake or filler word may contain any of these.
  const forbidden = new ForbiddenTokens([
    ...distinctive,
    ...(ownLabel ? [ownLabel] : []),
    ...people.flat().filter((w) => !isInitial(w)),
    ...places.flat(),
    ...streets.flatMap((s) => s.name),
    ...[...emailLocals].filter((l) => !ROLE_LOCAL_PARTS.has(l.toLowerCase())),
    ...[...emailDomains].flatMap((d) => d.split('.').slice(0, -1)),
  ]);

  // 3. Fakes and dictionary entries.
  const anonName = `Acme ${options.businessType ?? inferBusinessType(label)} Co`;
  const entries: DictEntry[] = [];

  entries.push({ words: nameWords, replacement: anonName, kind: 'business' });
  const withoutSuffix = [...nameWords];
  while (
    withoutSuffix.length > 1 &&
    LEGAL_SUFFIXES.has((withoutSuffix.at(-1) ?? '').toLowerCase())
  ) {
    withoutSuffix.pop();
  }
  if (withoutSuffix.length !== nameWords.length) {
    entries.push({ words: withoutSuffix, replacement: anonName, kind: 'business' });
  }
  if (ownLabel) {
    entries.push({ words: ownLabel.split('-'), replacement: anonName, kind: 'own-domain' });
  }
  // The name core: the name without trailing place, state, abbreviation and legal words
  // ("Hair & Co BKLYN" → "Hair & Co"). Made of common words, so it only matches when not
  // followed by more lowercase letters: hair-and-co, hairandco/, Hair & Co, not "Hair Color".
  const placeWordsLower = new Set(places.flat().map((w) => w.toLowerCase()));
  const stateAbbrs = new Set(US_STATES.map(([abbr]) => abbr));
  const core = [...nameWords];
  while (core.length > 1) {
    const last = core.at(-1) ?? '';
    const lower = last.toLowerCase();
    const letters = lettersOf(last);
    const strip =
      LEGAL_SUFFIXES.has(lower) ||
      STATE_NAMES_LOWER.has(lower) ||
      stateAbbrs.has(last) ||
      placeWordsLower.has(lower) ||
      (letters.length >= 2 &&
        letters === letters.toUpperCase() &&
        letters !== letters.toLowerCase());
    if (!strip) break;
    core.pop();
  }
  const coreNameWords = core.filter((w) => lettersOf(w).length > 0);
  const nameCore =
    coreNameWords.length >= 2 && core.length < withoutSuffix.length ? core : undefined;
  if (nameCore) {
    entries.push({ words: nameCore, replacement: anonName, kind: 'business', endGuard: true });
  }

  const usedPeople = new Set<string>();
  const personFakes = new Map<string, string>();
  const fakePersonToken = (token: string, position: 'first' | 'last'): string => {
    const key = token.toLowerCase();
    const hit = personFakes.get(key);
    if (hit) return hit;
    const fake = pickFake(
      position === 'first' ? FIRST_NAMES : LAST_NAMES,
      key,
      seed,
      `person-${position}`,
      usedPeople,
      forbidden,
    );
    personFakes.set(key, fake);
    return fake;
  };
  const personEntries = (words: string[]): void => {
    let seenFirst = false;
    const fakeWords = words.map((w) => {
      if (isInitial(w)) return w;
      const fake = fakePersonToken(w, seenFirst ? 'last' : 'first');
      seenFirst = true;
      return fake;
    });
    if (words.length > 1) {
      entries.push({ words, replacement: fakeWords.join(' '), kind: 'person' });
    }
    words.forEach((w, i) => {
      if (!isInitial(w) && lettersOf(w).length >= 3) {
        entries.push({ words: [w], replacement: fakeWords[i] ?? w, kind: 'person' });
      }
    });
  };
  for (const words of people) personEntries(words);

  const usedPlaces = new Set<string>();
  const placeFakes = new Map<string, string>();
  for (const words of places) {
    const key = words.join(' ').toLowerCase();
    let fake = placeFakes.get(key);
    if (!fake) {
      const list = words.length > 1 ? MULTI_WORD_PLACE_NAMES : PLACE_NAMES;
      fake = pickFake(list, key, seed, 'place', usedPlaces, forbidden);
      placeFakes.set(key, fake);
    }
    entries.push({ words, replacement: fake, kind: 'place' });
  }
  // "Heights"/"Ridge" from a location label, glued to the business name in a slug
  // ("…bklynheights"): replaced together with the name.
  const nameVariants: { words: readonly string[]; replacement: string }[] = [
    { words: nameWords, replacement: anonName },
    ...(ownLabel ? [{ words: ownLabel.split('-'), replacement: anonName }] : []),
    ...(nameCore ? [{ words: nameCore, replacement: anonName }] : []),
    ...distinctive
      .filter((w) => !STATE_NAMES_LOWER.has(w.toLowerCase()))
      .map((w) => ({ words: [w], replacement: 'Acme' })),
  ];
  for (const location of locationNames) {
    const fake = placeFakes.get(location.toLowerCase());
    if (!fake) continue;
    const words = location.split(/\s+/u);
    const last = words.at(-1) ?? '';
    for (const v of nameVariants) {
      const replacement = `${v.replacement} ${fake}`;
      entries.push({ words: [...v.words, ...words], replacement, kind: 'place' });
      if (words.length > 1 && GEO_NOUNS.has(last.toLowerCase())) {
        entries.push({ words: [...v.words, last], replacement, kind: 'place' });
      }
    }
  }

  const usedStreets = new Set<string>();
  const streetNameFakes = new Map<string, string>();
  const numberFakes = new Map<string, string>();
  for (const street of streets) {
    const nameKey = street.name.join(' ').toLowerCase();
    let fakeName = streetNameFakes.get(nameKey);
    if (!fakeName) {
      fakeName = street.name.every((w) => ORDINAL_RE.test(w))
        ? ordinal(2 + (hash32(seed, 'ordinal', nameKey) % 97))
        : pickFake(STREET_NAMES, nameKey, seed, 'street', usedStreets, forbidden);
      if (fakeName.toLowerCase() === nameKey)
        fakeName = ordinal(2 + (hash32(seed, 'ordinal2', nameKey) % 97));
      streetNameFakes.set(nameKey, fakeName);
    }
    let fakeNumber = numberFakes.get(street.number);
    if (!fakeNumber) {
      fakeNumber = fakeDigits(street.number, seed, 'house');
      numberFakes.set(street.number, fakeNumber);
    }
    const dir = street.direction ? [street.direction] : [];
    entries.push({
      words: [street.number, ...dir, ...street.name],
      replacement: [fakeNumber, ...dir, fakeName].join(' '),
      kind: 'street',
    });
  }
  for (const zip of zips)
    entries.push({ words: [zip], replacement: fakeZip(zip, seed), kind: 'zip' });
  for (const license of licenses) {
    entries.push({ words: [license], replacement: fakeLicense(license, seed), kind: 'license' });
  }

  // Distinctive words of the business name on their own ("Jolly", "BELLA", "Bella Lago") become
  // "Acme". State names inside a business name ("Delaware Valley ...") stay: the state is kept.
  const runs: string[][] = [];
  let run: string[] = [];
  for (const w of nameWords) {
    if (distinctive.includes(w)) run.push(w);
    else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  for (const r of runs) entries.push({ words: r, replacement: 'Acme', kind: 'name-token' });
  for (const w of distinctive) {
    if (!STATE_NAMES_LOWER.has(w.toLowerCase())) {
      entries.push({ words: [w], replacement: 'Acme', kind: 'name-token' });
    }
  }

  // Personal email local parts (not a role like info@, not already a known name) are people too,
  // so "Steven@..." and a standalone "Steven" get the same fictional name.
  const provisional = new DictMatcher(entries);
  for (const local of emailLocals) {
    if (ROLE_LOCAL_PARTS.has(local.toLowerCase())) continue;
    if (provisional.find(local).length > 0) continue;
    if (/^\p{L}{3,}$/u.test(local)) personEntries([local]);
  }

  const matcher = new DictMatcher(entries);
  const scrambler = new Scrambler(seed);
  const phones = new PhoneMapper(seed);
  phones.prime(strings.map((s) => s.value));
  return {
    anonName,
    rewrite: {
      matcher,
      phones,
      emails: new EmailMapper(matcher, scrambler),
      scrambler,
      neutralizer: new Neutralizer(seed, forbidden),
    },
  };
}

// ---------------------------------------------------------------------------------------------

function transform(value: string, key: string, ctx: RewriteContext, anonName: string): string {
  switch (modeFor(key)) {
    case 'keep':
      return value;
    case 'business-name':
      return anonName;
    case 'href':
      return rewriteHref(value, ctx);
    case 'path':
      return rewriteUrlRest(value, ctx);
    case 'long':
      return rewriteText(value, ctx, value.length >= LONG_TEXT_MIN_LENGTH);
    case 'short':
      return rewriteText(value, ctx, false);
  }
}

function walk(value: unknown, path: string[], ctx: RewriteContext, anonName: string): unknown {
  if (typeof value === 'string') return transform(value, path.join('.'), ctx, anonName);
  if (Array.isArray(value)) return value.map((v) => walk(v, [...path, '*'], ctx, anonName));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, [...path, k], ctx, anonName);
    return out;
  }
  return value;
}

/**
 * Anonymize a hand label. `label` must be a valid v3 Site (it is validated first); the result is
 * a new Site, validated with the same schema. The input is not modified.
 *
 * Deterministic: the same label and seed give an identical result. A different seed gives
 * different fictional values with the same patterns.
 */
export function anonymize(
  label: Site,
  seed: string | number,
  options: AnonymizeOptions = {},
): Site {
  const input = SiteSchema.parse(label);
  const seedText = String(seed);
  const { rewrite, anonName } = buildContext(input, seedText, options);
  const output = walk(input, [], rewrite, anonName);
  const result = SiteSchema.safeParse(output);
  if (!result.success) {
    // Paths and messages only: never echo label content.
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`anonymize: output does not match the site schema: ${issues.join('; ')}`);
  }
  return result.data;
}
