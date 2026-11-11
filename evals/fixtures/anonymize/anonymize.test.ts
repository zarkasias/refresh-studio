/**
 * M1 T5 acceptance: label anonymizer.
 *
 * Snapshots (`__snapshots__/<slug>.anon.json`) hold anonymized output only. This file never
 * hardcodes label content: it finds the cases to check by structure (section id, href shape).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Site, SiteSchema } from '@srs/site-model';
import { describe, expect, it } from 'vitest';
import { LABEL_FILE, SITES_DIR } from '../../src/conformance';
import { parseUsAddress } from './address';
import { fakeLicense } from './anonymize';
import { formatLike } from './dictionary';
import { anonymize, extraIdentityFor, findLabelLeaks } from './index';
import { PhoneMapper } from './rewrite';
import { TOLL_FREE_AREA_CODES } from './vocab';

const SEED = 'm1-t5';

const SLUGS = readdirSync(SITES_DIR)
  .filter((d) => !d.startsWith('_') && existsSync(join(SITES_DIR, d, LABEL_FILE)))
  .sort();

function load(slug: string): Site {
  return SiteSchema.parse(JSON.parse(readFileSync(join(SITES_DIR, slug, LABEL_FILE), 'utf8')));
}

interface Leaf {
  path: string;
  value: string;
}

function leaves(value: unknown, path = '', out: Leaf[] = []): Leaf[] {
  if (typeof value === 'string') out.push({ path, value });
  else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

/** Digits of a `tel:` body, skipping `%XX` escapes, without a leading NANP 1. */
function telKey(href: string): string {
  const body = href.replace(/^tel:/i, '').replace(/%[0-9A-Fa-f]{2}/g, '');
  const digits = body.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

const PHONE_TEXT_RE =
  /(?<![\p{L}\p{N}.])(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.\-\u200B]*\d{3}[\s.\-\u200B]*\d{4}(?![\p{L}\p{N}])/gu;

/** Phone keys in a string, in order: one for a `tel:` href, else each displayed number. */
function phoneKeys(value: string): string[] {
  if (/^tel:/i.test(value)) return [telKey(value)];
  if (/^https?:\/\//i.test(value)) return []; // ids in URLs are scrambled, not phone numbers
  return [...value.matchAll(PHONE_TEXT_RE)].map((m) => telKey(m[0]));
}

const pctEscapes = (s: string): string[] => s.match(/%[0-9A-Fa-f]{2}/g) ?? [];
const sectionTypes = (s: Site): string[] => s.pages.flatMap((p) => p.sections.map((x) => x.type));

/** Options every caller uses for a labeled site: its extra identity strings. */
const opts = (slug: string) => ({ extraIdentity: extraIdentityFor(slug) });

const anonymized = new Map(SLUGS.map((slug) => [slug, anonymize(load(slug), SEED, opts(slug))]));
const anon = (slug: string): Site => {
  const out = anonymized.get(slug);
  if (!out) throw new Error(`no label for ${slug}`);
  return out;
};

describe('anonymize: every labeled site', () => {
  it('covers the labeled test set', () => {
    expect(SLUGS.length).toBeGreaterThanOrEqual(10);
    for (const slug of ['jolly-plumbing', 'casper-plumbing', 'hair-and-co-brooklyn']) {
      expect(SLUGS).toContain(slug);
    }
  });

  describe.each(SLUGS)('%s', (slug) => {
    it('leaks no original phone, email, business name, person or address part', () => {
      expect(findLabelLeaks(load(slug), anon(slug), opts(slug))).toEqual([]);
    });

    it('still validates against the site schema', () => {
      expect(SiteSchema.safeParse(anon(slug)).success).toBe(true);
    });

    it('is deterministic and does not modify its input', () => {
      const label = load(slug);
      const before = JSON.stringify(label);
      const a = anonymize(label, SEED, opts(slug));
      const b = anonymize(load(slug), SEED, opts(slug));
      expect(JSON.stringify(label)).toBe(before);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(anonymize(label, 42, opts(slug))).toEqual(anonymize(label, '42', opts(slug)));
    });

    it('keeps structure, section types, brand, hours, CTA kinds and providers', () => {
      const label = load(slug);
      const out = anon(slug);
      expect(sectionTypes(out)).toEqual(sectionTypes(label));
      expect(out.brand).toEqual(label.brand);
      expect(out.business.hours).toEqual(label.business.hours);
      expect(out.platform).toBe(label.platform);
      expect(out.platformDetails).toEqual(label.platformDetails);
      expect(leaves(out).map((l) => l.path)).toEqual(leaves(label).map((l) => l.path));
      const ctas = (s: Site): unknown[] =>
        s.pages.flatMap((p) =>
          p.sections.flatMap((x) => (x.content.ctas ?? []).map((c) => [c.kind, c.provider])),
        );
      expect(ctas(out)).toEqual(ctas(label));
      expect(out.business.name).toMatch(/^Acme [A-Z][A-Za-z]+ Co$/);
      for (const e of out.business.emails ?? []) expect(e.value).toMatch(/@example\.com$/);
    });

    it('maps each distinct phone number to one distinct 555-01xx number everywhere', () => {
      const before = leaves(load(slug));
      const after = leaves(anon(slug));
      const forward = new Map<string, string>();
      const backward = new Map<string, string>();
      before.forEach((leaf, i) => {
        const inKeys = phoneKeys(leaf.value);
        const outKeys = phoneKeys(after[i]?.value ?? '');
        expect(outKeys.length, leaf.path).toBe(inKeys.length);
        inKeys.forEach((k, j) => {
          const o = outKeys[j] ?? '';
          expect(o, leaf.path).toMatch(/^(?:\d{3})?55501\d{2}$/);
          expect(forward.get(k) ?? o, `same number, same fake (${leaf.path})`).toBe(o);
          expect(backward.get(o) ?? k, `different numbers, different fakes (${leaf.path})`).toBe(k);
          forward.set(k, o);
          backward.set(o, k);
        });
      });
    });

    it('keeps href shapes: non-digit characters of tel: links and %XX escapes byte for byte', () => {
      const before = leaves(load(slug));
      const after = leaves(anon(slug));
      before.forEach((leaf, i) => {
        const out = after[i]?.value ?? '';
        if (/^tel:/i.test(leaf.value)) {
          // Same characters except digits outside escapes: hidden characters, separators and
          // percent-encodings stay at the same positions.
          const mask = (s: string): string =>
            s.replace(/%[0-9A-Fa-f]{2}|\d/g, (m) => (m.length === 3 ? m : '#'));
          expect(mask(out), leaf.path).toBe(mask(leaf.value));
        }
        if (/^https?:\/\//i.test(leaf.value)) {
          // Path depth, query separators and fragment marker. (An "&" inside a path segment can
          // be part of a business name, as in a slug, so only the query's "&" counts.)
          const shape = (s: string): string => {
            const rest = s.replace(/^https?:\/\/[^/?#]*/i, '');
            const q = rest.search(/[?#]/);
            const path = q === -1 ? rest : rest.slice(0, q);
            const tail = q === -1 ? '' : rest.slice(q);
            return `${path.replace(/[^/]/g, '')}${tail.replace(/[^?#&=]/g, '')}`;
          };
          expect(shape(out), leaf.path).toBe(shape(leaf.value));
          expect(pctEscapes(out), leaf.path).toEqual(pctEscapes(leaf.value));
          expect(out.slice(0, 5).toLowerCase(), leaf.path).toBe(
            leaf.value.slice(0, 5).toLowerCase(),
          );
        }
      });
      const paths = (s: Site): number[] => s.pages.map((p) => p.path.split('/').length);
      expect(paths(anon(slug))).toEqual(paths(load(slug)));
    });
  });

  it('gives different fictional values for a different seed', () => {
    const label = load('jolly-plumbing');
    const other = anonymize(label, `${SEED}-other`, opts('jolly-plumbing'));
    expect(other.business.phones).not.toEqual(anon('jolly-plumbing').business.phones);
    expect(sectionTypes(other)).toEqual(sectionTypes(anon('jolly-plumbing')));
  });

  it('parses every structured address in the labels (so the leak check covers streets)', () => {
    for (const slug of SLUGS) {
      const b = load(slug).business;
      for (const address of [b.address, ...(b.locations ?? []).map((l) => l.address)]) {
        if (!address) continue;
        const parsed = parseUsAddress(address);
        expect(parsed.street, slug).toBeDefined();
        expect(parsed.city, slug).toBeTruthy();
        expect(parsed.state, slug).toBeTruthy();
        expect(parsed.zip, slug).toMatch(/^\d{5}/);
      }
    }
  });

  it('has a leak check that does find leaks', () => {
    const label = load('hair-and-co-brooklyn');
    const kinds = new Set(findLabelLeaks(label, label).map((l) => l.kind));
    expect([...kinds].sort()).toEqual(['business-name', 'email', 'person', 'phone', 'place']);
  });

  it('leak check: reports a name core and a location word planted in an anonymized label', () => {
    const label = load('hair-and-co-brooklyn');
    const planted = structuredClone(anon('hair-and-co-brooklyn'));
    const page0 = planted.pages[0];
    const page1 = planted.pages[1];
    const section = page0?.sections.find((x) => x.type === 'team');
    if (!page0 || !page1 || !section) throw new Error('unexpected label shape');
    // Built from the original label's own words, so no client content is written here.
    const core = label.business.name.split(' ').slice(0, 3); // e.g. ["Hair", "&", "Co"]
    const slugCore = core.map((w) => (w === '&' ? 'and' : w.toLowerCase())).join('-');
    const compactCore = slugCore.replace(/-/g, '');
    const locationWord = (label.business.locations?.[0]?.label.split(' ')[0] ?? '').toLowerCase();
    planted.id = `site_${slugCore}-x`;
    section.id = `home-team-${locationWord}`;
    page1.path = `/about-${compactCore}/`;
    const paths = new Set(
      findLabelLeaks(label, planted, opts('hair-and-co-brooklyn')).map((l) => l.path),
    );
    expect(paths).toContain('id');
    expect([...paths].some((p) => /^pages\[0\]\.sections\[\d+\]\.id$/.test(p))).toBe(true);
    expect(paths).toContain('pages[1].path');
    // And the unplanted output is clean (the per-site leak test covers this for all labels).
    expect(
      findLabelLeaks(label, anon('hair-and-co-brooklyn'), opts('hair-and-co-brooklyn')),
    ).toEqual([]);
  });

  it('leak check: reports extra identity that the anonymizer was not given', () => {
    const slug = 'bella-lago-salon';
    expect(extraIdentityFor(slug).length).toBeGreaterThan(0);
    const without = anonymize(load(slug), SEED);
    const leaks = findLabelLeaks(load(slug), without, opts(slug));
    expect(leaks.some((l) => l.kind === 'place')).toBe(true);
    expect(findLabelLeaks(load(slug), anon(slug), opts(slug))).toEqual([]);
  });

  it('hair-and-co-brooklyn: the name core and location words are gone from ids, paths and slugs', () => {
    const out = anon('hair-and-co-brooklyn');
    expect(out.id).toMatch(/^site_acme-salon-co-/);
    const json = JSON.stringify(out).toLowerCase();
    expect(json).not.toMatch(/hair-?(and)?-?co(?![a-z])/);
    expect(json).not.toMatch(/prospect|heights|ridge/);
  });

  it('keeps long body text within 10% of its original length', () => {
    for (const slug of SLUGS) {
      const before = leaves(load(slug));
      const after = leaves(anon(slug));
      before.forEach((leaf, i) => {
        if (!/(?:\.body|metaDescription|confirmation)$/.test(leaf.path) || leaf.value.length < 40) {
          return;
        }
        const out = after[i]?.value ?? '';
        expect(
          Math.abs(out.length - leaf.value.length),
          `${slug} ${leaf.path}`,
        ).toBeLessThanOrEqual(Math.ceil(leaf.value.length * 0.1));
      });
    }
  });

  it('maps a person named twice to the same fictional name both times', () => {
    let repeats = 0;
    for (const slug of SLUGS) {
      const names = (s: Site): string[] => [
        ...(s.business.people ?? []).map((p) => p.name),
        ...s.pages.flatMap((p) =>
          p.sections
            .filter((x) => x.type === 'team' || x.type === 'testimonials')
            .flatMap((x) => (x.content.items ?? []).map((i) => i.title ?? '')),
        ),
      ];
      const before = names(load(slug));
      const after = names(anon(slug));
      const seen = new Map<string, string>();
      before.forEach((name, i) => {
        const fake = after[i] ?? '';
        const prior = seen.get(name);
        if (prior !== undefined) {
          repeats++;
          expect(fake, `${slug}: same person, same fake`).toBe(prior);
        }
        seen.set(name, fake);
      });
    }
    expect(repeats).toBeGreaterThan(0);
  });
});

describe('anonymize: acceptance snapshots', () => {
  it('jolly-plumbing: the encoded zero-width space survives and the two numbers stay distinct', async () => {
    const label = load('jolly-plumbing');
    const out = anon('jolly-plumbing');
    const before = leaves(label);
    const after = leaves(out);
    const zwsp = before.flatMap((l, i) => (l.value.includes('%E2%80%8B') ? [i] : []));
    expect(zwsp.length).toBeGreaterThan(0);
    for (const i of zwsp) {
      const original = before[i]?.value ?? '';
      const mapped = after[i]?.value ?? '';
      expect(mapped.indexOf('%E2%80%8B')).toBe(original.indexOf('%E2%80%8B'));
      expect(mapped).toMatch(/^tel:\+1%E2%80%8B\d{3}-555-01\d{2}$/);
    }
    const phones = (out.business.phones ?? []).map((p) => telKey(p.value));
    expect(phones).toHaveLength(2);
    expect(new Set(phones).size).toBe(2);
    // The hidden-character link and the plain link for the same number get the same fake.
    const hiddenKey = telKey(after[zwsp[0] ?? -1]?.value ?? '');
    expect(phones).toContain(hiddenKey);
    await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/jolly-plumbing.anon.json',
    );
  });

  it('casper-plumbing: the header link digits still differ from the displayed digits', async () => {
    const label = load('casper-plumbing');
    const out = anon('casper-plumbing');
    const navCall = (s: Site) =>
      s.pages[0]?.sections
        .find((x) => x.type === 'nav')
        ?.content.ctas?.find((c) => c.kind === 'call');
    const inCta = navCall(label);
    const outCta = navCall(out);
    expect(inCta && outCta).toBeTruthy();
    if (!inCta || !outCta) return;
    // Precondition from the label: the href and the display disagree.
    expect(telKey(inCta.href)).not.toBe(phoneKeys(inCta.label)[0]);
    // After mapping they still disagree, and the display is the business's main number.
    expect(telKey(outCta.href)).not.toBe(phoneKeys(outCta.label)[0]);
    expect(phoneKeys(outCta.label)[0]).toBe(phoneKeys(out.business.phones?.[0]?.value ?? '')[0]);
    expect(telKey(outCta.href)).toMatch(/^\d{3}55501\d{2}$/);
    await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/casper-plumbing.anon.json',
    );
  });

  it('hair-and-co-brooklyn: %28...%29%20 survives in the tel: link', async () => {
    const label = load('hair-and-co-brooklyn');
    const out = anon('hair-and-co-brooklyn');
    const ctas = (s: Site) =>
      s.pages.flatMap((p) => p.sections.flatMap((x) => x.content.ctas ?? []));
    const pairs = ctas(label)
      .map((c, i) => [c, ctas(out)[i]] as const)
      .filter(([c]) => c.href.startsWith('tel:%28'));
    expect(pairs.length).toBeGreaterThan(0);
    for (const [before, after] of pairs) {
      expect(after?.href).toMatch(/^tel:%28\d{3}%29%20555-01\d{2}$/);
      expect(pctEscapes(after?.href ?? '')).toEqual(pctEscapes(before.href));
      // The link still matches its own label after mapping.
      expect(telKey(after?.href ?? '')).toBe(phoneKeys(after?.label ?? '')[0]);
    }
    await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/hair-and-co-brooklyn.anon.json',
    );
  });
});

describe('anonymize: details', () => {
  it('never gives a local number a toll-free area code, and keeps toll-free numbers toll-free', () => {
    for (let area = 200; area <= 999; area++) {
      const code = String(area);
      const fake = new PhoneMapper('toll').mapDigits(`${code}5550100`).slice(0, 3);
      expect(TOLL_FREE_AREA_CODES.includes(fake), code).toBe(TOLL_FREE_AREA_CODES.includes(code));
    }
  });

  it('maps a 7-digit form to the same fake as its full number, whatever comes first', () => {
    const label = load('casper-plumbing');
    const main = label.business.phones?.[0]?.value ?? '';
    const digits = main.replace(/\D/g, '').slice(-10);
    const nav = label.pages[0]?.sections.find((x) => x.type === 'nav');
    if (!nav?.content.ctas) throw new Error('unexpected label shape');
    // Visited before any full form of the number.
    nav.content.ctas.unshift({
      label: 'Call',
      href: `tel:${digits.slice(3, 6)}-${digits.slice(6)}`,
      kind: 'call',
    });
    const out = anonymize(label, SEED, opts('casper-plumbing'));
    const sevenOut =
      out.pages[0]?.sections.find((x) => x.type === 'nav')?.content.ctas?.[0]?.href ?? '';
    const mainOut = (out.business.phones?.[0]?.value ?? '').replace(/\D/g, '');
    expect(sevenOut.replace(/\D/g, '')).toBe(mainOut.slice(3));
  });

  it('keeps leading zeros and the digit count of licence numbers', () => {
    expect(fakeLicense('AB.0000123', 's')).toMatch(/^AB\.0000[1-9]\d\d$/);
    expect(fakeLicense('XY010203ZZ', 's')).toMatch(/^XY0[1-9]\d{4}ZZ$/);
    expect(fakeLicense('AB.0000123', 's')).not.toBe('AB.0000123');
    expect(fakeLicense('NO.0000', 's')).toBe('NO.0000');
  });

  it('keeps literal hidden characters in a tel: href at the same positions', () => {
    const label = load('jolly-plumbing');
    const cta = label.pages[0]?.sections.find((x) => x.type === 'nav')?.content.ctas?.[0];
    expect(cta?.href).toMatch(/^tel:/);
    if (!cta) return;
    const plain = cta.href;
    cta.href = `tel:\u200B${plain.slice(4, 7)}\u2060${plain.slice(7)}`;
    const out = anonymize(label, SEED, opts('jolly-plumbing'));
    const outHref = out.pages[0]?.sections.find((x) => x.type === 'nav')?.content.ctas?.[0]?.href;
    const plainOut = anon('jolly-plumbing').pages[0]?.sections.find((x) => x.type === 'nav')
      ?.content.ctas?.[0]?.href;
    expect(outHref).toBe(`tel:\u200B${plainOut?.slice(4, 7)}\u2060${plainOut?.slice(7)}`);
  });

  it('accepts a business type override', () => {
    expect(anonymize(load('casper-plumbing'), SEED, { businessType: 'Bakery' }).business.name).toBe(
      'Acme Bakery Co',
    );
  });

  it('rejects a label that is not a valid site', () => {
    const broken = { ...load('casper-plumbing'), schemaVersion: 2 } as unknown as Site;
    expect(() => anonymize(broken, SEED)).toThrow();
  });

  it('parses US address shapes', () => {
    expect(parseUsAddress('Example Plaza | 12 N Fake St. Testville, NM 87000')).toEqual({
      building: 'Example Plaza',
      street: { number: '12', direction: 'N', name: ['Fake'] },
      city: 'Testville',
      state: 'NM',
      zip: '87000',
    });
    expect(parseUsAddress('40 2nd Ave SW, Suite 5, Sample City, New York 10000-1234')).toEqual({
      street: { number: '40', name: ['2nd'] },
      city: 'Sample City',
      state: 'New York',
      zip: '10000-1234',
    });
  });

  it('formats replacements like the text they replace', () => {
    expect(formatLike('Santa Fe', 'Oakmere Hollow')).toBe('Oakmere Hollow');
    expect(formatLike('santa-fe', 'Oakmere Hollow')).toBe('oakmere-hollow');
    expect(formatLike('santafe', 'Oakmere Hollow')).toBe('oakmerehollow');
    expect(formatLike('SANTA FE', 'Oakmere')).toBe('OAKMERE');
    expect(formatLike('Santa_Fe', 'Oak Mere')).toBe('Oak_Mere');
    expect(formatLike('santa%20fe', 'Oak Mere')).toBe('oak%20mere');
  });

  it('is pure: no I/O, randomness or clock in the anonymizer source', () => {
    const dir = new URL('.', import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const src = readFileSync(new URL(file, dir), 'utf8');
      for (const m of src.matchAll(/\bfrom\s+'([^']+)'|\bimport\(\s*'([^']+)'/g)) {
        const spec = m[1] ?? m[2] ?? '';
        expect(spec.startsWith('./') || spec === '@srs/site-model', `${file}: ${spec}`).toBe(true);
      }
      expect(src, file).not.toMatch(/Math\.random|Date\.now|new Date|process\.|require\(|fetch\(/);
    }
  });
});
