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

describe('migrateSiteDoc', () => {
  it('is at v2', () => {
    expect(SITE_SCHEMA_VERSION).toBe(2);
  });
  it('moves phone and email into phones[] and emails[]', () => {
    const site = parseStoredSite(v1Site({ phone: '555-0100', email: 'a@example.com' }));
    expect(site.schemaVersion).toBe(2);
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
    const doc = v1Site({ phone: '555' });
    const copy = structuredClone(doc);
    migrateSiteDoc(doc);
    expect(doc).toEqual(copy);
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
