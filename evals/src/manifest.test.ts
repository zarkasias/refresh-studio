import { describe, expect, it } from 'vitest';
import { loadManifest } from './load-manifest';
import {
  type ManifestEntry,
  ManifestEntrySchema,
  ManifestSchema,
  NETWORK_ELIGIBLE_CONSENT,
  isNetworkEligible,
  selectNetworkEligible,
} from './manifest';

function entry(overrides: Partial<ManifestEntry>): ManifestEntry {
  return {
    slug: 'synthetic-site',
    url: 'https://synthetic.example/',
    businessType: 'Synthetic test business',
    platform: 'unknown',
    platformConfidence: 0.5,
    evidence: [],
    whyUseful: 'In-memory test entry.',
    consent: 'none',
    misfits: [],
    ...overrides,
  };
}

const RECORDED = '2026-11-09T00:00:00.000Z';

describe('evals/sites/manifest.json', () => {
  it('loads and validates against ManifestSchema', () => {
    expect(() => loadManifest()).not.toThrow();
  });

  it('seeds the 13 sites from M0 plan section 4', () => {
    expect(loadManifest().sites).toHaveLength(13);
  });

  it('allows network use only for chambers-consulting today', () => {
    const eligible = selectNetworkEligible(loadManifest());
    expect(eligible.map((e) => e.slug)).toEqual(['chambers-consulting']);
  });

  it('stores WPBakery as a pageBuilder, not a hosted builder', () => {
    const hair = loadManifest().sites.find((s) => s.slug === 'hair-and-co-brooklyn');
    expect(hair?.pageBuilder).toBe('wpbakery');
    expect(hair?.builder).toBeUndefined();
  });
});

describe('selectNetworkEligible', () => {
  const data = {
    sites: [
      entry({ slug: 'own', consent: 'own-site', consentRecordedAt: RECORDED }),
      entry({ slug: 'granted', consent: 'granted', consentRecordedAt: '2026-11-09T12:00:00.000Z' }),
      entry({ slug: 'requested', consent: 'requested' }),
      entry({ slug: 'none', consent: 'none' }),
    ],
  };

  it('returns only own-site and granted entries', () => {
    expect(selectNetworkEligible(data).map((e) => e.slug)).toEqual(['own', 'granted']);
  });

  it('never selects none or requested', () => {
    for (const e of selectNetworkEligible(data)) {
      expect(['none', 'requested']).not.toContain(e.consent);
    }
    expect(isNetworkEligible(entry({ consent: 'none' }))).toBe(false);
    expect(isNetworkEligible(entry({ consent: 'requested' }))).toBe(false);
    // A requested entry with a date (when we asked) is still not eligible.
    expect(isNetworkEligible(entry({ consent: 'requested', consentRecordedAt: RECORDED }))).toBe(
      false,
    );
  });

  it('validates unparsed data before filtering', () => {
    const bad = {
      sites: [{ ...entry({ slug: 'g', consent: 'granted' }), consentRecordedAt: null }],
    };
    expect(() => selectNetworkEligible(bad)).toThrow();
    expect(() => selectNetworkEligible({ sites: [{ consent: 'granted' }] })).toThrow();
    expect(() => selectNetworkEligible(null)).toThrow();
  });
});

describe('isNetworkEligible rejects unparsed or malformed "granted" entries', () => {
  it('rejects a granted entry with no recorded date', () => {
    expect(isNetworkEligible(entry({ consent: 'granted' }))).toBe(false);
  });

  it('rejects consentRecordedAt: null', () => {
    expect(isNetworkEligible({ ...entry({ consent: 'granted' }), consentRecordedAt: null })).toBe(
      false,
    );
  });

  it('rejects a junk date string', () => {
    expect(isNetworkEligible(entry({ consent: 'granted', consentRecordedAt: 'yesterday' }))).toBe(
      false,
    );
  });

  it('rejects a bad slug', () => {
    expect(
      isNetworkEligible(
        entry({ slug: 'Not A Slug', consent: 'granted', consentRecordedAt: RECORDED }),
      ),
    ).toBe(false);
  });

  it('rejects non-objects and partial objects', () => {
    expect(isNetworkEligible(undefined)).toBe(false);
    expect(isNetworkEligible({ consent: 'own-site', consentRecordedAt: RECORDED })).toBe(false);
  });

  it('accepts a valid granted entry', () => {
    expect(isNetworkEligible(entry({ consent: 'granted', consentRecordedAt: RECORDED }))).toBe(
      true,
    );
  });
});

describe('NETWORK_ELIGIBLE_CONSENT', () => {
  it('is frozen, and mutating it does not widen the gate', () => {
    expect(Object.isFrozen(NETWORK_ELIGIBLE_CONSENT)).toBe(true);
    expect(() => {
      (NETWORK_ELIGIBLE_CONSENT as ManifestEntry['consent'][]).push('none');
    }).toThrow(TypeError);
    expect(NETWORK_ELIGIBLE_CONSENT).toEqual(['own-site', 'granted']);
    expect(isNetworkEligible(entry({ consent: 'none' }))).toBe(false);
    expect(isNetworkEligible(entry({ consent: 'requested' }))).toBe(false);
  });
});

describe('ManifestSchema', () => {
  it('rejects duplicate slugs', () => {
    const result = ManifestSchema.safeParse({
      sites: [entry({ slug: 'dup' }), entry({ slug: 'dup', url: 'https://other.example/' })],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sites', 1, 'slug']);
  });

  it('rejects unknown keys on the manifest and entries', () => {
    expect(ManifestSchema.safeParse({ sites: [], extra: true }).success).toBe(false);
    expect(ManifestEntrySchema.safeParse({ ...entry({}), extra: true }).success).toBe(false);
  });

  it('rejects non-slug slugs', () => {
    expect(ManifestEntrySchema.safeParse(entry({ slug: 'Casper Plumbing' })).success).toBe(false);
  });

  it('requires consentRecordedAt for own-site and granted', () => {
    expect(ManifestEntrySchema.safeParse(entry({ consent: 'granted' })).success).toBe(false);
    expect(ManifestEntrySchema.safeParse(entry({ consent: 'own-site' })).success).toBe(false);
  });

  it('rejects an unknown consent level', () => {
    expect(ManifestEntrySchema.safeParse({ ...entry({}), consent: 'maybe' }).success).toBe(false);
  });

  it('allows builder only with platform other-hosted', () => {
    expect(
      ManifestEntrySchema.safeParse(entry({ platform: 'other-hosted', builder: 'bentobox' }))
        .success,
    ).toBe(true);
    const wrong = ManifestEntrySchema.safeParse(
      entry({ platform: 'wordpress', builder: 'wpbakery' }),
    );
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.path).toEqual(['builder']);
  });

  it('allows pageBuilder only with platform wordpress', () => {
    expect(
      ManifestEntrySchema.safeParse(entry({ platform: 'wordpress', pageBuilder: 'wpbakery' }))
        .success,
    ).toBe(true);
    const wrong = ManifestEntrySchema.safeParse(
      entry({ platform: 'wix', pageBuilder: 'elementor' }),
    );
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.path).toEqual(['pageBuilder']);
  });
});
