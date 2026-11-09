import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { minimalSite } from '@srs/site-model/fixtures';
import { loadManifest } from './load-manifest';
import type { Manifest, ManifestEntry } from './manifest';
import {
  GATE_MIN_LABELED,
  LABEL_FILE,
  SITES_DIR,
  TODO_MARKER,
  checkLabel,
  formatReport,
  gateProblems,
  runConformance,
} from './conformance';

/**
 * The M0 gate test. The real labels are checked on every `pnpm test` (any label that exists must
 * conform). Whether the gate is MET (>= 10 passing labels, no open misfits) is enforced only with
 * SRS_M0_GATE=1 (`pnpm gate:m0`), so CI stays green while labeling is in progress.
 */
describe('evals/sites conformance (T9)', () => {
  const report = runConformance(loadManifest());

  it('prints the conformance and misfit summary', () => {
    console.log(formatReport(report));
  });

  it('every expected.site.json that exists conforms to the site model', () => {
    const failing = report.labels.filter((l) => l.errors.length > 0);
    expect(failing, formatReport(report)).toEqual([]);
  });

  it('has no label directories outside the manifest', () => {
    expect(report.strayDirs).toEqual([]);
  });

  it.runIf(process.env.SRS_M0_GATE === '1')('meets M0 gate items 4 and 5', () => {
    expect(gateProblems(report), formatReport(report)).toEqual([]);
  });
});

const TEMPLATE = join(SITES_DIR, '_template', LABEL_FILE);
const SLUG = 'synthetic-site';

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    slug: SLUG,
    url: 'https://example.com/',
    businessType: 'Synthetic',
    platform: 'unknown',
    platformConfidence: 0.5,
    evidence: [],
    whyUseful: 'test',
    consent: 'none',
    misfits: [],
    ...overrides,
  };
}

/** Replace every TODO placeholder in the template with a plausible value for its key. */
function fillTemplate(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && value.includes(TODO_MARKER)) {
    if (key === 'id') return `site_${SLUG}`;
    if (key === 'projectId') return `proj_${SLUG}`;
    if (key === 'hex') return '#1a2b3c';
    if (key === 'network') return 'facebook';
    if (key === 'provider') return 'meevo';
    if (['sourceUrl', 'url', 'googleBusinessUrl'].includes(key)) return 'https://example.com/';
    return 'filled';
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, k)]));
  }
  return value;
}

describe('blank template (T8)', () => {
  const template = JSON.parse(readFileSync(TEMPLATE, 'utf8')) as unknown;

  it('fails conformance while it still has placeholders', () => {
    const result = checkLabel(SLUG, template, entry());
    expect(result.errors.some((e) => e.includes(TODO_MARKER))).toBe(true);
  });

  it('passes once every placeholder is filled in', () => {
    expect(checkLabel(SLUG, fillTemplate(template), entry())).toEqual({
      slug: SLUG,
      errors: [],
      warnings: [],
    });
  });
});

describe('checkLabel', () => {
  const valid = () => ({
    ...minimalSite(),
    id: `site_${SLUG}`,
    sourceUrl: 'https://example.com/',
    pages: [
      ...minimalSite().pages,
      {
        path: '/contact-us',
        title: '',
        sections: [{ id: 'c', type: 'contact', content: {}, confidence: 1 }],
      },
    ],
  });

  it('accepts a valid label', () => {
    expect(checkLabel(SLUG, valid(), entry()).errors).toEqual([]);
  });
  it('reports schema issues with their path', () => {
    const bad = {
      ...valid(),
      brand: { extractedColors: [{ hex: '#ABCDEF' }], extractedFonts: [] },
    };
    expect(checkLabel(SLUG, bad, entry()).errors[0]).toMatch(/^brand\.extractedColors\.0\.hex:/);
  });
  it('requires a homepage', () => {
    const noHome = { ...valid(), pages: valid().pages.filter((p) => p.path !== '/') };
    expect(checkLabel(SLUG, noHome, entry()).errors).toContain(
      'no homepage (a page with path "/")',
    );
  });
  it('requires a contact page or section', () => {
    const noContact = { ...valid(), pages: valid().pages.filter((p) => p.path === '/') };
    expect(checkLabel(SLUG, noContact, entry()).errors.join()).toMatch(/no contact page/);
  });
  it('accepts a contact section on the homepage instead of a contact page', () => {
    const site = valid();
    const home = {
      ...site.pages[0]!,
      sections: [...site.pages[0]!.sections, site.pages[1]!.sections[0]!],
    };
    expect(checkLabel(SLUG, { ...site, pages: [home] }, entry()).errors).toEqual([]);
  });
  it('requires the id to match the slug', () => {
    expect(checkLabel(SLUG, { ...valid(), id: 'site_1' }, entry()).errors).toContain(
      `id should be "site_${SLUG}"`,
    );
  });
  it('requires sourceUrl on the manifest site', () => {
    const other = { ...valid(), sourceUrl: 'https://other.example/' };
    expect(checkLabel(SLUG, other, entry()).errors.join()).toMatch(/not on the manifest's site/);
  });
  it('warns, but does not fail, when the platform differs from the manifest', () => {
    const result = checkLabel(SLUG, valid(), entry({ platform: 'wix' }));
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toMatch(/differs/);
  });
});

describe('runConformance and the gate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'srs-conformance-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const labelFor = (slug: string) => ({
    ...minimalSite(),
    id: `site_${slug}`,
    sourceUrl: `https://${slug}.example/`,
    pages: [
      {
        path: '/',
        title: '',
        sections: [{ id: 'c', type: 'contact', content: {}, confidence: 1 }],
      },
    ],
  });
  const write = (slug: string, content: string) => {
    mkdirSync(join(dir, slug), { recursive: true });
    writeFileSync(join(dir, slug, LABEL_FILE), content);
  };
  const manifestOf = (n: number, misfits: ManifestEntry['misfits'] = []): Manifest => ({
    sites: Array.from({ length: n }, (_, i) =>
      entry({ slug: `s${i}`, url: `https://s${i}.example/`, misfits: i === 0 ? misfits : [] }),
    ),
  });

  it('lists unlabeled slugs, stray dirs, and ignores _template', () => {
    write('s0', JSON.stringify(labelFor('s0')));
    write('_template', '{}');
    write('not-in-manifest', '{}');
    const report = runConformance(manifestOf(2), dir);
    expect(report.labels.map((l) => [l.slug, l.errors])).toEqual([['s0', []]]);
    expect(report.unlabeled).toEqual(['s1']);
    expect(report.strayDirs).toEqual(['not-in-manifest']);
  });

  it('reports invalid JSON as a label error', () => {
    write('s0', '{ nope');
    expect(runConformance(manifestOf(1), dir).labels[0]?.errors[0]).toMatch(/not valid JSON/);
  });

  it(`is met with ${GATE_MIN_LABELED} passing labels and every misfit resolved`, () => {
    const n = GATE_MIN_LABELED;
    for (let i = 0; i < n; i++) write(`s${i}`, JSON.stringify(labelFor(`s${i}`)));
    const resolved = runConformance(
      manifestOf(n, [{ field: 'business.hours', note: 'x', resolution: 'accepted' }]),
      dir,
    );
    expect(gateProblems(resolved)).toEqual([]);
    expect(formatReport(resolved)).toMatch(/Gate: MET/);
  });

  it('is not met with an open misfit or too few labels', () => {
    for (let i = 0; i < GATE_MIN_LABELED - 1; i++)
      write(`s${i}`, JSON.stringify(labelFor(`s${i}`)));
    const report = runConformance(
      manifestOf(GATE_MIN_LABELED, [{ field: 'business.hours', note: 'two sets of hours' }]),
      dir,
    );
    expect(gateProblems(report)).toEqual([
      `${GATE_MIN_LABELED - 1} of ${GATE_MIN_LABELED} required sites have a passing label`,
      '1 misfit(s) not yet resolved',
    ]);
    expect(formatReport(report)).toMatch(/OPEN\s+s0\s+business\.hours: two sets of hours/);
  });
});
