import { describe, expect, it } from 'vitest';
import { minimalSite } from '../fixtures';
import { SITE_SCHEMA_VERSION, SiteSchema } from '../schemas/site';
import { migrateSiteDoc, parseStoredSite, SiteMigrationError } from './site';

/** A v1 document as it would have been stored before ADR-006. */
function v1Site(business: Record<string, unknown> = {}): Record<string, unknown> {
  const site = minimalSite();
  return {
    ...site,
    schemaVersion: 1,
    business: { name: 'Example Plumbing', socialLinks: [], ...business },
  };
}

/** A v2 document as it would have been stored before ADR-007 (fonts are plain strings). */
function v2Site(fonts: unknown[] = ['Avenir', 'system-ui']): Record<string, unknown> {
  const site = minimalSite();
  return { ...site, schemaVersion: 2, brand: { ...site.brand, extractedFonts: fonts } };
}

describe('migrateSiteDoc', () => {
  it('is at v3', () => {
    expect(SITE_SCHEMA_VERSION).toBe(3);
  });
  it('v2 -> v3: turns font strings into { family } objects', () => {
    const site = parseStoredSite(v2Site());
    expect(site.schemaVersion).toBe(3);
    expect(site.brand.extractedFonts).toEqual([{ family: 'Avenir' }, { family: 'system-ui' }]);
  });
  it('v2 -> v3: de-duplicates by family, keeping first-seen order', () => {
    const site = parseStoredSite(v2Site(['Open Sans', 'Avenir', 'Open Sans']));
    expect(site.brand.extractedFonts).toEqual([{ family: 'Open Sans' }, { family: 'Avenir' }]);
  });
  it('v2 -> v3: handles an empty font list', () => {
    expect(parseStoredSite(v2Site([])).brand.extractedFonts).toEqual([]);
  });
  it('v1 reaches v3 through both steps', () => {
    const v1 = {
      ...v1Site({ phone: '555-0100' }),
      brand: { extractedColors: [], extractedFonts: ['Lobster', 'Lobster'] },
    };
    const site = parseStoredSite(v1);
    expect(site.schemaVersion).toBe(3);
    expect(site.business.phones).toEqual([{ value: '555-0100' }]);
    expect(site.brand.extractedFonts).toEqual([{ family: 'Lobster' }]);
  });
  it('moves phone and email into phones[] and emails[]', () => {
    const site = parseStoredSite(v1Site({ phone: '555-0100', email: 'a@example.com' }));
    expect(site.schemaVersion).toBe(3);
    expect(site.business.phones).toEqual([{ value: '555-0100' }]);
    expect(site.business.emails).toEqual([{ value: 'a@example.com' }]);
    expect(site.business).not.toHaveProperty('phone');
  });
  it('drops empty v1 phone and email strings', () => {
    const site = parseStoredSite(v1Site({ phone: '', email: '' }));
    expect(site.business.phones).toBeUndefined();
    expect(site.business.emails).toBeUndefined();
  });
  it('keeps v1 locations that have a label and address', () => {
    const locations = [{ label: 'East', address: '1 A St', googleBusinessUrl: 'https://g.co/x' }];
    expect(parseStoredSite(v1Site({ locations })).business.locations).toEqual(locations);
  });
  it('throws on a v1 location without an address instead of inventing one', () => {
    expect(() => migrateSiteDoc(v1Site({ locations: [{ label: 'East' }] }))).toThrow(
      SiteMigrationError,
    );
    try {
      migrateSiteDoc(v1Site({ locations: [{ label: 'East' }] }));
    } catch (e) {
      expect((e as SiteMigrationError).path).toBe('business.locations.0.address');
    }
  });
  it('does not mutate its input', () => {
    for (const doc of [v1Site({ phone: '555' }), v2Site(['A', 'A'])]) {
      const copy = structuredClone(doc);
      migrateSiteDoc(doc);
      expect(doc).toEqual(copy);
    }
  });
  it('leaves a current doc unchanged', () => {
    const site = minimalSite();
    expect(migrateSiteDoc(site)).toEqual(site);
  });
  it('leaves unknown versions for validation to reject', () => {
    const doc = { ...minimalSite(), schemaVersion: 99 };
    expect(migrateSiteDoc(doc)).toEqual(doc);
    expect(SiteSchema.safeParse(migrateSiteDoc(doc)).success).toBe(false);
  });
});
