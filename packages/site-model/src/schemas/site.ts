import { z } from 'zod';
import { ConfidenceSchema, HexColorSchema, IdSchema, SlugSchema, UrlSchema } from './primitives';
import { PageSchema } from './page';

export const SITE_SCHEMA_VERSION = 2;

export const PlatformSchema = z.enum([
  'wordpress',
  'squarespace',
  'wix',
  'godaddy',
  'webflow',
  'custom', // hand-coded
  'other-hosted', // v1: hosted builder outside this list (see platformDetails.builder)
  'unknown',
]);
export type Platform = z.infer<typeof PlatformSchema>;

export const KnownPageBuilderSchema = z.enum([
  'elementor',
  'divi',
  'gutenberg',
  'wpbakery' /* v1 */,
]);
export type KnownPageBuilder = z.infer<typeof KnownPageBuilderSchema>;

/** A known page builder, or any other builder name as a lowercase slug. */
export const PageBuilderSchema = z.union([KnownPageBuilderSchema, SlugSchema]);
export type PageBuilder = z.infer<typeof PageBuilderSchema>;

export const PlatformDetailsSchema = z.strictObject({
  theme: z.string().min(1).optional(),
  pageBuilder: PageBuilderSchema.optional(),
  /** v1: hosted builder name as a lowercase slug, e.g. `bentobox`, `chiroplanet`. */
  builder: SlugSchema.optional(),
});
export type PlatformDetails = z.infer<typeof PlatformDetailsSchema>;

export const PlatformEvidenceWhereSchema = z.enum(['html', 'header', 'asset-url', 'footer-text']);
export type PlatformEvidenceWhere = z.infer<typeof PlatformEvidenceWhereSchema>;

/** v1 */
export const PlatformEvidenceSchema = z.strictObject({
  signal: z.string().min(1),
  where: PlatformEvidenceWhereSchema,
});
export type PlatformEvidence = z.infer<typeof PlatformEvidenceSchema>;

/** v1: hours as raw text, not parsed. */
export const HoursEntrySchema = z.strictObject({
  label: z.string().optional(),
  text: z.string().min(1),
});
export type HoursEntry = z.infer<typeof HoursEntrySchema>;

/** v1 */
export const SocialLinkSchema = z.strictObject({
  /** Lowercase slug, e.g. `facebook`, `instagram`. */
  network: SlugSchema,
  url: UrlSchema,
});
export type SocialLink = z.infer<typeof SocialLinkSchema>;

/** v2 (ADR-006): a phone number or email address as displayed, with the site's own label. */
export const ContactPointSchema = z.strictObject({
  /** As displayed on the site, not normalized. */
  value: z.string().min(1),
  /** The site's own wording, e.g. `Emergency Services`, `Jesup`. */
  label: z.string().min(1).optional(),
});
export type ContactPoint = z.infer<typeof ContactPointSchema>;

/**
 * v2 (ADR-006): a physical location with an address. The top-level business fields stay the
 * primary location; a business with several equal locations may list all of them here.
 */
export const LocationSchema = z.strictObject({
  label: z.string().min(1),
  address: z.string().min(1),
  phone: z.string().optional(),
  hours: z.array(HoursEntrySchema).optional(),
  /** Kept from v1 so migrated locations lose nothing. */
  googleBusinessUrl: UrlSchema.optional(),
});
export type Location = z.infer<typeof LocationSchema>;

/** v2: a licence number as displayed. */
export const LicenseSchema = z.strictObject({
  number: z.string().min(1),
  /** Who issued it, as the site says, e.g. `State of Iowa`. */
  authority: z.string().min(1).optional(),
});
export type License = z.infer<typeof LicenseSchema>;

/** v2: an aggregate rating the site claims, e.g. 4.9 stars from 514 Google reviews. */
export const RatingSchema = z.strictObject({
  /** Where the reviews live, e.g. `Google`. */
  source: z.string().min(1),
  /** Average score as displayed, e.g. 4.9. */
  value: z.number().min(0),
  /** Number of reviews, when given. */
  count: z.number().int().min(0).optional(),
});
export type Rating = z.infer<typeof RatingSchema>;

export const CredentialKindSchema = z.enum(['certification', 'membership', 'award', 'badge']);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

/** v2: certifications, memberships, awards and badges the site shows. */
export const CredentialSchema = z.strictObject({
  kind: CredentialKindSchema,
  name: z.string().min(1),
  /** Verification or listing link, when the site gives one. */
  url: UrlSchema.optional(),
});
export type Credential = z.infer<typeof CredentialSchema>;

/** v2 (ADR-006): trust signals. Arrays may be empty. */
export const TrustSchema = z.strictObject({
  foundedYear: z.number().int().min(1600).max(2100).optional(),
  licenses: z.array(LicenseSchema),
  ratings: z.array(RatingSchema),
  credentials: z.array(CredentialSchema),
});
export type Trust = z.infer<typeof TrustSchema>;

/** v2 (ADR-006): where the business works. At least one of the three must say something. */
export const ServiceAreaSchema = z
  .strictObject({
    /** The site's own wording, e.g. `Serving the Greater Des Moines Area`. */
    description: z.string().min(1).optional(),
    /** Towns, counties or regions named on the site. */
    places: z.array(z.string().min(1)),
    radiusMiles: z.number().positive().optional(),
  })
  .refine(
    (area) =>
      area.description !== undefined || area.places.length > 0 || area.radiusMiles !== undefined,
    { message: 'A service area needs a description, at least one place, or a radius' },
  );
export type ServiceArea = z.infer<typeof ServiceAreaSchema>;

/** v2 (ADR-006): owners, practitioners and staff named on the site. */
export const PersonSchema = z.strictObject({
  name: z.string().min(1),
  /** As displayed, e.g. `Owner`, `Lead Stylist`, `DMD`. */
  role: z.string().min(1).optional(),
  /** Labels of `business.locations` this person works at. */
  locations: z.array(z.string().min(1)).optional(),
});
export type Person = z.infer<typeof PersonSchema>;

export const BusinessSchema = z.strictObject({
  name: z.string().min(1),
  /** v2: first entry is the primary number. Replaces v1 `phone`. */
  phones: z.array(ContactPointSchema).optional(),
  /** v2: first entry is the primary address. Replaces v1 `email`. */
  emails: z.array(ContactPointSchema).optional(),
  address: z.string().optional(),
  hours: z.array(HoursEntrySchema).optional(),
  googleBusinessUrl: UrlSchema.optional(),
  socialLinks: z.array(SocialLinkSchema),
  locations: z.array(LocationSchema).optional(),
  trust: TrustSchema.optional(),
  serviceArea: ServiceAreaSchema.optional(),
  people: z.array(PersonSchema).optional(),
});
export type Business = z.infer<typeof BusinessSchema>;

/** Primary phone (first entry), or undefined. */
export function primaryPhone(business: Pick<Business, 'phones'>): string | undefined {
  return business.phones?.[0]?.value;
}

/** Primary email (first entry), or undefined. */
export function primaryEmail(business: Pick<Business, 'emails'>): string | undefined {
  return business.emails?.[0]?.value;
}

/** v1 */
export const ExtractedColorSchema = z.strictObject({
  hex: HexColorSchema,
  role: z.string().min(1).optional(),
  /** Share of the page this color covers, 0–1. */
  share: z.number().min(0).max(1).optional(),
});
export type ExtractedColor = z.infer<typeof ExtractedColorSchema>;

/** What the current site uses. */
export const BrandSchema = z.strictObject({
  logoAssetId: IdSchema.optional(),
  extractedColors: z.array(ExtractedColorSchema),
  /** Font family names as found; not necessarily Google Fonts. */
  extractedFonts: z.array(z.string().min(1)),
});
export type Brand = z.infer<typeof BrandSchema>;

/**
 * The Site object without its cross-field refinements. Zod 4 refined schemas cannot be
 * `.pick`ed, `.omit`ted or `.extend`ed, so derive from this one and validate with `SiteSchema`.
 */
export const SiteObjectSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  schemaVersion: z.literal(SITE_SCHEMA_VERSION),
  sourceUrl: UrlSchema,
  platform: PlatformSchema,
  platformDetails: PlatformDetailsSchema.optional(),
  platformEvidence: z.array(PlatformEvidenceSchema),
  platformConfidence: ConfidenceSchema,
  business: BusinessSchema,
  brand: BrandSchema,
  pages: z.array(PageSchema),
});

/**
 * Site with cross-field rules: `Page.path` unique within the site, `Section.id` unique across
 * all pages, location labels unique, and every `people[].locations` entry names a location.
 */
export const SiteSchema = SiteObjectSchema.superRefine((site, ctx) => {
  const locationLabels = new Set<string>();
  site.business.locations?.forEach((location, index) => {
    if (locationLabels.has(location.label)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate location label ${location.label}`,
        path: ['business', 'locations', index, 'label'],
      });
    }
    locationLabels.add(location.label);
  });
  site.business.people?.forEach((person, personIndex) => {
    person.locations?.forEach((label, labelIndex) => {
      if (!locationLabels.has(label)) {
        ctx.addIssue({
          code: 'custom',
          message: `Person ${person.name} names location "${label}", which is not in business.locations`,
          path: ['business', 'people', personIndex, 'locations', labelIndex],
        });
      }
    });
  });
  const paths = new Set<string>();
  const sectionIds = new Set<string>();
  site.pages.forEach((page, pageIndex) => {
    if (paths.has(page.path)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate page path ${page.path}`,
        path: ['pages', pageIndex, 'path'],
      });
    }
    paths.add(page.path);
    page.sections.forEach((section, sectionIndex) => {
      if (sectionIds.has(section.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate section id ${section.id}`,
          path: ['pages', pageIndex, 'sections', sectionIndex, 'id'],
        });
      }
      sectionIds.add(section.id);
    });
  });
});
export type Site = z.infer<typeof SiteSchema>;
