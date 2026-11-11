/**
 * Leak check for anonymized labels (M1 T5 acceptance). Given an original label and its
 * anonymized version, report every place where an original identity value survives: business
 * name (full, without legal suffix, distinctive words, own domain), phone numbers (as digits,
 * including inside percent-encoded hrefs), emails (address, domain, personal local part),
 * people, address parts (street, city, ZIP, building, service-area places, location names and
 * each distinctive word of them), the name core in slug forms (`hair-and-co`, `hairandco`) and
 * any per-slug `extraIdentity`.
 *
 * The originals are collected from the label here, independently of the anonymizer's own
 * dictionary, and with this module's own word lists (deliberately not shared with the
 * anonymizer), so the check does not trust the code it is checking. Pure.
 */
import type { Site } from '@srs/site-model';
import { parseUsAddress } from './address';
import { US_STATES } from './vocab';

export interface LeakCheckOptions {
  /** Per-slug extra identity strings (`extra-identity.ts`), checked like place names. */
  extraIdentity?: readonly string[];
}

// Own lists, separate from the anonymizer's on purpose.
const STATE_NAMES = new Set(US_STATES.map(([, n]) => n.toLowerCase()));
const STATE_ABBRS = new Set(US_STATES.map(([a]) => a));
const LEGAL = new Set(['inc', 'llc', 'ltd', 'corp', 'corporation', 'pllc']);
/** Trade and filler words: not distinctive on their own (the name core check covers them). */
const TRADE = new Set(
  (
    '& and the of co company inc llc ltd corp group services service studio plumbing plumber ' +
    'heating cooling air hvac electric electrical electrician salon spa medspa med hair dental ' +
    'dentistry dentist cafe café coffee restaurant bistro diner kitchen bar grill hardwoods ' +
    'hardwood flooring floors floor consulting chiropractic clinic center shop repair family'
  ).split(' '),
);
const ROLE_LOCALS = new Set(
  (
    'info hello contact service services support office admin sales team cafe booking bookings ' +
    'appointments frontdesk reception mail enquiries inquiries help hr jobs careers billing'
  ).split(' '),
);
const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'prof']);
const BUILDING = new Set(
  'compound plaza center centre building bldg mall square tower complex shops park suite unit the at of'.split(
    ' ',
  ),
);
const LOCATION_GENERIC = new Set(
  'main office head headquarters hq store shop location downtown uptown north south east west central satellite branch the'.split(
    ' ',
  ),
);

export type LeakKind = 'business-name' | 'phone' | 'email' | 'person' | 'place';

export interface LabelLeak {
  kind: LeakKind;
  /** The original value that survived. */
  value: string;
  /** JSON path in the anonymized label where it was found. */
  path: string;
}

interface Needle {
  kind: LeakKind;
  value: string;
  test: (text: string) => boolean;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Separators a slug or handle may put between words, or none (`lake-norman`, `lakenorman`). */
const SLUG_SEP = String.raw`(?:[\s\-_.+]|%20)*`;

/**
 * ≥ 5 letters: anywhere (catches handles), with any separator between words; shorter: whole
 * word only.
 */
function textNeedle(kind: LeakKind, value: string): Needle | undefined {
  const v = value.trim();
  const compact = v.replace(/[^\p{L}\p{N}]/gu, '');
  if (compact.length < 3) return undefined;
  const lower = v.toLowerCase();
  const words = v.split(/\s+/u).filter(Boolean);
  if (compact.length >= 5 && words.length > 1) {
    const re = new RegExp(words.map(escapeRe).join(SLUG_SEP), 'iu');
    return { kind, value: v, test: (t) => t.toLowerCase().includes(lower) || re.test(t) };
  }
  if (compact.length >= 5) return { kind, value: v, test: (t) => t.toLowerCase().includes(lower) };
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, 'iu');
  return { kind, value: v, test: (t) => re.test(t) };
}

/**
 * The name core in any slug form: "Hair & Co" matches `hair-and-co`, `hairandco`, `Hair & Co`,
 * `hair_co`, but not "Hair Color" (no lowercase letter may follow).
 */
function coreNeedle(core: readonly string[]): Needle {
  const body = core
    .map((w) => (w === '&' || w.toLowerCase() === 'and' ? '(?:&amp;|&|and)?' : escapeRe(w)))
    .join(SLUG_SEP);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{Ll}])`, 'iu');
  return { kind: 'business-name', value: core.join(' '), test: (t) => re.test(t) };
}

function strings(value: unknown, path: string, out: { path: string; value: string }[]): void {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
  }
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const PHONE_RE = /(?:\+?1[^\d]{0,6})?(?:\(\d{3}\)|\d{3})[^\d]{0,6}\d{3}[^\d]{0,6}\d{4}(?!\d)/gu;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function phoneKey(text: string): string | undefined {
  const digits = text.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : undefined;
}

function originalPhones(label: Site, all: { value: string }[]): Set<string> {
  const keys = new Set<string>();
  const add = (s: string | undefined): void => {
    const k = s === undefined ? undefined : phoneKey(decode(s));
    if (k) keys.add(k);
  };
  for (const p of label.business.phones ?? []) add(p.value);
  for (const l of label.business.locations ?? []) add(l.phone);
  for (const { value } of all) {
    if (/^(?:tel|sms):/i.test(value)) add(value.slice(4));
    for (const m of decode(value).matchAll(PHONE_RE)) add(m[0]);
  }
  return keys;
}

function personNames(label: Site): string[] {
  const names = (label.business.people ?? []).map((p) => p.name);
  for (const page of label.pages) {
    for (const section of page.sections) {
      if (section.type !== 'testimonials' && section.type !== 'team') continue;
      for (const item of section.content.items ?? []) if (item.title) names.push(item.title);
    }
  }
  return names;
}

function needlesFor(label: Site, all: { value: string }[], options: LeakCheckOptions): Needle[] {
  const needles: Needle[] = [];
  const push = (n: Needle | undefined): void => {
    if (n) needles.push(n);
  };

  // Business name.
  const name = label.business.name;
  push(textNeedle('business-name', name));
  const words = name.split(/\s+/u).map((w) => w.replace(/[,.]+$/u, ''));
  const trimmed = [...words];
  while (trimmed.length > 1 && LEGAL.has((trimmed.at(-1) ?? '').toLowerCase())) trimmed.pop();
  push(textNeedle('business-name', trimmed.join(' ').replace(/,$/, '')));
  for (const w of words) {
    const lower = w.toLowerCase();
    if (TRADE.has(lower) || STATE_NAMES.has(lower)) continue;
    if (w.replace(/[^\p{L}]/gu, '').length >= 3) push(textNeedle('business-name', w));
  }
  // Name core: drop trailing legal, state, all-caps abbreviation and place words.
  const placeWords = new Set(
    [label.business.address, ...(label.business.locations ?? []).map((l) => l.address)]
      .flatMap((a) => (a ? (parseUsAddress(a).city ?? '').split(/\s+/u) : []))
      .concat((label.business.serviceArea?.places ?? []).flatMap((p) => p.split(/\s+/u)))
      .map((w) => w.toLowerCase()),
  );
  const core = [...words];
  while (core.length > 1) {
    const last = core.at(-1) ?? '';
    const letters = last.replace(/[^\p{L}]/gu, '');
    const isAbbr =
      letters.length >= 2 && letters === letters.toUpperCase() && /\p{Lu}/u.test(letters);
    const lower = last.toLowerCase();
    if (!(
      LEGAL.has(lower) ||
      STATE_NAMES.has(lower) ||
      STATE_ABBRS.has(last) ||
      isAbbr ||
      placeWords.has(lower)
    ))
      break;
    core.pop();
  }
  if (core.filter((w) => /\p{L}/u.test(w)).length >= 2) needles.push(coreNeedle(core));
  const host = /^[a-z]+:\/\/([^/?#:]+)/i.exec(label.sourceUrl)?.[1] ?? '';
  const ownLabel = host.split('.').at(-2);
  if (ownLabel) push(textNeedle('business-name', ownLabel));

  // Phones: 10-digit and 7-digit forms, anywhere in a string's digits (after %-decoding).
  for (const key of originalPhones(label, all)) {
    for (const digits of [key, key.slice(3)]) {
      needles.push({
        kind: 'phone',
        value: digits,
        test: (t) => decode(t).replace(/\D/g, '').includes(digits),
      });
    }
  }

  // Emails.
  for (const { value } of all) {
    for (const m of value.matchAll(EMAIL_RE)) {
      const address = m[0];
      const at = address.lastIndexOf('@');
      const local = address.slice(0, at);
      push(textNeedle('email', address));
      push(textNeedle('email', address.slice(at + 1)));
      if (!ROLE_LOCALS.has(local.toLowerCase())) push(textNeedle('email', local));
    }
  }

  // People: full names and each name word (no initials, no titles).
  for (const person of personNames(label)) {
    push(textNeedle('person', person));
    for (const w of person.split(/\s+/u)) {
      const bare = w.replace(/[.,]/g, '');
      if (bare.length < 3 || TITLES.has(bare.toLowerCase())) continue;
      push(textNeedle('person', bare));
    }
  }

  // Places: street, city, ZIP, building words; service-area places; location names.
  const addresses = [
    label.business.address,
    ...(label.business.locations ?? []).map((l) => l.address),
  ];
  for (const address of addresses) {
    if (!address) continue;
    const parsed = parseUsAddress(address);
    if (parsed.street) {
      const { number, direction, name: streetName } = parsed.street;
      const re = new RegExp(
        `(?<!\\d)${number}\\s+${direction ? `${escapeRe(direction)}\\.?\\s+` : ''}${escapeRe(streetName[0] ?? '')}`,
        'iu',
      );
      needles.push({
        kind: 'place',
        value: `${number} ${streetName.join(' ')}`,
        test: (t) => re.test(t),
      });
    }
    if (parsed.city) push(textNeedle('place', parsed.city));
    if (parsed.zip) {
      const zip = parsed.zip.slice(0, 5);
      const re = new RegExp(`(?<!\\d)${zip}(?!\\d)`);
      needles.push({ kind: 'place', value: zip, test: (t) => re.test(t) });
    }
    for (const w of parsed.building?.split(/\s+/u) ?? []) {
      if (!BUILDING.has(w.toLowerCase())) push(textNeedle('place', w));
    }
  }
  for (const place of label.business.serviceArea?.places ?? []) {
    if (!STATE_NAMES.has(place.toLowerCase())) push(textNeedle('place', place));
  }
  // Location names, and each of their words on its own ("prospect", "heights").
  for (const location of label.business.locations ?? []) {
    const bare = location.label.replace(/\s*\([^)]*\)/gu, '').trim();
    const locationWords = bare.split(/\s+/u).filter(Boolean);
    if (locationWords.every((w) => LOCATION_GENERIC.has(w.toLowerCase()))) continue;
    push(textNeedle('place', bare));
    for (const w of locationWords) {
      if (!LOCATION_GENERIC.has(w.toLowerCase())) push(textNeedle('place', w));
    }
  }
  for (const extra of options.extraIdentity ?? []) push(textNeedle('place', extra));

  return needles;
}

/** Every original identity value that still appears in `anonymized`. Empty means no leak. */
export function findLabelLeaks(
  original: Site,
  anonymized: Site,
  options: LeakCheckOptions = {},
): LabelLeak[] {
  const before: { path: string; value: string }[] = [];
  strings(original, '', before);
  const after: { path: string; value: string }[] = [];
  strings(anonymized, '', after);
  const leaks: LabelLeak[] = [];
  for (const needle of needlesFor(original, before, options)) {
    for (const { path, value } of after) {
      if (needle.test(value)) leaks.push({ kind: needle.kind, value: needle.value, path });
    }
  }
  return leaks;
}
