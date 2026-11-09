import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalSection, minimalSite } from '../fixtures';
import {
  PageBuilderSchema,
  PlatformSchema,
  primaryEmail,
  primaryPhone,
  SiteObjectSchema,
  SiteSchema,
} from './site';

describe('SiteSchema', () => {
  it('accepts the minimal site', () => {
    expect(SiteSchema.safeParse(minimalSite()).success).toBe(true);
  });

  it('accepts a fully populated v2 site', () => {
    const site = {
      ...minimalSite(),
      platform: 'other-hosted',
      platformDetails: { builder: 'bentobox' },
      platformEvidence: [
        { signal: 'powered by BentoBox', where: 'footer-text' },
        { signal: 'getbento.com', where: 'asset-url' },
      ],
      platformConfidence: 0.95,
      business: {
        name: "Ramsey's Diner",
        phones: [{ value: '(555) 555-0100' }, { value: '555-0199', label: 'Emergency' }],
        emails: [
          { value: 'hello@example.com' },
          { value: 'billing@example.com', label: 'Billing' },
        ],
        address: '1 Main St',
        hours: [{ label: 'Mon–Fri', text: '7am–3pm' }, { text: 'Closed Sundays' }],
        googleBusinessUrl: 'https://maps.google.com/?cid=1',
        socialLinks: [{ network: 'facebook', url: 'https://facebook.com/example' }],
        locations: [
          { label: 'Downtown', address: '2 Main St', phone: '555-0101', hours: [{ text: '8–2' }] },
        ],
        trust: {
          foundedYear: 1955,
          licenses: [{ number: 'EL080641EC', authority: 'State of Iowa' }, { number: 'PC.1' }],
          ratings: [
            { source: 'Google', value: 4.9, count: 514 },
            { source: 'Yelp', value: 4 },
          ],
          credentials: [
            { kind: 'certification', name: 'Bona Certified', url: 'https://bona.com/x' },
            { kind: 'membership', name: 'ADA' },
            { kind: 'award', name: 'Top 200 salon' },
            { kind: 'badge', name: 'BBB' },
          ],
        },
        serviceArea: { description: 'Greater Des Moines', places: ['Ames'], radiusMiles: 10 },
        people: [{ name: 'Pat', role: 'Owner', locations: ['Downtown'] }, { name: 'Sam' }],
      },
      brand: {
        logoAssetId: 'asset_logo',
        extractedColors: [{ hex: '#aa0000', role: 'primary', share: 0.4 }, { hex: '#ffffff' }],
        extractedFonts: ['Lobster', 'Open Sans'],
      },
    };
    expect(SiteSchema.safeParse(site).success).toBe(true);
  });

  describe('schemaVersion', () => {
    it.each([0, 1, 3, '2', undefined])('rejects %s', (schemaVersion) => {
      expect(SiteSchema.safeParse({ ...minimalSite(), schemaVersion }).success).toBe(false);
    });
  });

  it('accepts every platform', () => {
    for (const platform of PlatformSchema.options) {
      expect(SiteSchema.safeParse({ ...minimalSite(), platform }).success).toBe(true);
    }
  });
  it('rejects an unknown platform', () => {
    expect(SiteSchema.safeParse({ ...minimalSite(), platform: 'bentobox' }).success).toBe(false);
  });

  it.each(['elementor', 'divi', 'gutenberg', 'wpbakery', 'beaver-builder'])(
    'accepts pageBuilder %s',
    (pageBuilder) => {
      expect(
        SiteSchema.safeParse({ ...minimalSite(), platformDetails: { pageBuilder } }).success,
      ).toBe(true);
    },
  );
  it('rejects an empty pageBuilder', () => {
    expect(
      SiteSchema.safeParse({ ...minimalSite(), platformDetails: { pageBuilder: '' } }).success,
    ).toBe(false);
  });

  it('rejects an unknown evidence location', () => {
    const site = { ...minimalSite(), platformEvidence: [{ signal: 'x', where: 'cookie' }] };
    expect(SiteSchema.safeParse(site).success).toBe(false);
  });
  it.each([0, 1])('accepts platformConfidence %s', (platformConfidence) => {
    expect(SiteSchema.safeParse({ ...minimalSite(), platformConfidence }).success).toBe(true);
  });
  it.each([-0.01, 1.01])('rejects platformConfidence %s', (platformConfidence) => {
    expect(SiteSchema.safeParse({ ...minimalSite(), platformConfidence }).success).toBe(false);
  });
  it('rejects a missing platformEvidence array', () => {
    const site = omit(minimalSite(), 'platformEvidence');
    expect(SiteSchema.safeParse(site).success).toBe(false);
  });

  it('rejects hours as a plain string', () => {
    const site = minimalSite();
    expect(
      SiteSchema.safeParse({ ...site, business: { ...site.business, hours: 'Mon–Fri 9–5' } })
        .success,
    ).toBe(false);
  });
  it('rejects an hours entry without text', () => {
    const site = minimalSite();
    expect(
      SiteSchema.safeParse({ ...site, business: { ...site.business, hours: [{ label: 'Mon' }] } })
        .success,
    ).toBe(false);
  });
  it('rejects a missing business name', () => {
    const site = minimalSite();
    expect(SiteSchema.safeParse({ ...site, business: { socialLinks: [] } }).success).toBe(false);
  });
  it('rejects a social link without a URL', () => {
    const site = minimalSite();
    const business = {
      ...site.business,
      socialLinks: [{ network: 'facebook', url: 'facebook.com/x' }],
    };
    expect(SiteSchema.safeParse({ ...site, business }).success).toBe(false);
  });
  it('rejects a location with an unknown key', () => {
    const site = minimalSite();
    const business = { ...site.business, locations: [{ label: 'East', fax: '555' }] };
    expect(SiteSchema.safeParse({ ...site, business }).success).toBe(false);
  });

  it('rejects an uppercase extracted color', () => {
    const site = {
      ...minimalSite(),
      brand: { extractedColors: [{ hex: '#AA0000' }], extractedFonts: [] },
    };
    expect(SiteSchema.safeParse(site).success).toBe(false);
  });
  it('rejects an extracted color share above 1', () => {
    const site = {
      ...minimalSite(),
      brand: { extractedColors: [{ hex: '#aa0000', share: 1.5 }], extractedFonts: [] },
    };
    expect(SiteSchema.safeParse(site).success).toBe(false);
  });
  it('rejects a non-http sourceUrl', () => {
    expect(
      SiteSchema.safeParse({ ...minimalSite(), sourceUrl: 'file:///index.html' }).success,
    ).toBe(false);
  });

  describe('slugs', () => {
    const withBusiness = (network: string) => {
      const site = minimalSite();
      return {
        ...site,
        business: { ...site.business, socialLinks: [{ network, url: 'https://example.com/x' }] },
      };
    };
    it.each(['toast', 'wp-bakery-custom'])(
      'accepts %s for network, builder and pageBuilder',
      (v) => {
        expect(SiteSchema.safeParse(withBusiness(v)).success).toBe(true);
        expect(
          SiteSchema.safeParse({ ...minimalSite(), platformDetails: { builder: v } }).success,
        ).toBe(true);
        expect(PageBuilderSchema.safeParse(v).success).toBe(true);
      },
    );
    it.each(['Toast', ' ', 'toast pos'])('rejects %j for network, builder and pageBuilder', (v) => {
      expect(SiteSchema.safeParse(withBusiness(v)).success).toBe(false);
      expect(
        SiteSchema.safeParse({ ...minimalSite(), platformDetails: { builder: v } }).success,
      ).toBe(false);
      expect(
        SiteSchema.safeParse({ ...minimalSite(), platformDetails: { pageBuilder: v } }).success,
      ).toBe(false);
    });
    it('leaves theme as found', () => {
      expect(
        SiteSchema.safeParse({ ...minimalSite(), platformDetails: { theme: 'Twenty Twenty-Four' } })
          .success,
      ).toBe(true);
    });
  });

  describe('locations', () => {
    const withBusiness = (extra: Record<string, unknown>) => {
      const site = minimalSite();
      return { ...site, business: { ...site.business, ...extra } };
    };
    it('rejects an empty location {}', () => {
      expect(SiteSchema.safeParse(withBusiness({ locations: [{}] })).success).toBe(false);
    });
    it('rejects a location without an address (v2)', () => {
      expect(SiteSchema.safeParse(withBusiness({ locations: [{ label: 'East' }] })).success).toBe(
        false,
      );
    });
    it('rejects duplicate location labels', () => {
      const loc = { label: 'East', address: '1 A St' };
      const result = SiteSchema.safeParse(withBusiness({ locations: [loc, loc] }));
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['business', 'locations', 1, 'label']);
    });
  });

  describe('business v2 fields', () => {
    const withBusiness = (extra: Record<string, unknown>) => {
      const site = minimalSite();
      return { ...site, business: { ...site.business, ...extra } };
    };
    it('rejects the v1 phone and email fields', () => {
      expect(SiteSchema.safeParse(withBusiness({ phone: '555' })).success).toBe(false);
      expect(SiteSchema.safeParse(withBusiness({ email: 'a@b.c' })).success).toBe(false);
    });
    it('rejects an empty phone value', () => {
      expect(SiteSchema.safeParse(withBusiness({ phones: [{ value: '' }] })).success).toBe(false);
    });
    it('primaryPhone and primaryEmail return the first entry', () => {
      const b = { phones: [{ value: '1' }, { value: '2' }], emails: [] };
      expect(primaryPhone(b)).toBe('1');
      expect(primaryEmail(b)).toBeUndefined();
      expect(primaryPhone({})).toBeUndefined();
    });
    it('rejects a person at an unknown location', () => {
      const result = SiteSchema.safeParse(
        withBusiness({
          locations: [{ label: 'East', address: '1 A St' }],
          people: [{ name: 'Pat', locations: ['East', 'West'] }],
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['business', 'people', 0, 'locations', 1]);
    });
    it('rejects an empty service area', () => {
      expect(SiteSchema.safeParse(withBusiness({ serviceArea: { places: [] } })).success).toBe(
        false,
      );
    });
    it('accepts a service area with only places', () => {
      expect(
        SiteSchema.safeParse(withBusiness({ serviceArea: { places: ['Ames'] } })).success,
      ).toBe(true);
    });
    it('rejects an unknown credential kind', () => {
      const trust = { licenses: [], ratings: [], credentials: [{ kind: 'partner', name: 'X' }] };
      expect(SiteSchema.safeParse(withBusiness({ trust })).success).toBe(false);
    });
    it('rejects a fractional review count and a non-integer founded year', () => {
      const ratings = [{ source: 'Google', value: 4.9, count: 1.5 }];
      expect(
        SiteSchema.safeParse(withBusiness({ trust: { licenses: [], ratings, credentials: [] } }))
          .success,
      ).toBe(false);
      expect(
        SiteSchema.safeParse(
          withBusiness({
            trust: { foundedYear: 1955.5, licenses: [], ratings: [], credentials: [] },
          }),
        ).success,
      ).toBe(false);
    });
  });

  describe('uniqueness', () => {
    it('accepts distinct paths and section ids across pages', () => {
      const site = minimalSite();
      site.pages.push({
        path: '/contact',
        title: 'Contact',
        sections: [{ ...minimalSection(), id: 'sec_contact', type: 'contact' }],
      });
      expect(SiteSchema.safeParse(site).success).toBe(true);
    });
    it('rejects a duplicate page path', () => {
      const site = minimalSite();
      site.pages.push({
        path: '/',
        title: 'Home again',
        sections: [{ ...minimalSection(), id: 'sec_other' }],
      });
      const result = SiteSchema.safeParse(site);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['pages', 1, 'path']);
    });
    it('rejects a section id repeated on another page', () => {
      const site = minimalSite();
      site.pages.push({ path: '/contact', title: 'Contact', sections: [minimalSection()] });
      const result = SiteSchema.safeParse(site);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['pages', 1, 'sections', 0, 'id']);
    });
    it('rejects a section id repeated on the same page', () => {
      const site = minimalSite();
      site.pages[0]?.sections.push(minimalSection());
      expect(SiteSchema.safeParse(site).success).toBe(false);
    });
    it('SiteObjectSchema skips the uniqueness rule and still supports .pick', () => {
      const site = minimalSite();
      site.pages.push({ path: '/', title: 'Dup', sections: [] });
      expect(SiteObjectSchema.safeParse(site).success).toBe(true);
      expect(SiteObjectSchema.pick({ id: true }).safeParse({ id: 'site_1' }).success).toBe(true);
    });
  });
});
