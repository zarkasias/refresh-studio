import { z } from 'zod';
import { ConfidenceSchema, HexColorSchema, IdSchema, SlugSchema, UrlSchema } from './primitives';
import { PageSchema } from './page';

export const SITE_SCHEMA_VERSION = 1;

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

/**
 * v1: additional locations. The top-level business fields stay as the primary location.
 * At least one field must be present (`{}` is rejected).
 */
export const LocationSchema = z
  .strictObject({
    label: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    hours: z.array(HoursEntrySchema).optional(),
    googleBusinessUrl: UrlSchema.optional(),
  })
  .refine((location) => Object.values(location).some((value) => value !== undefined), {
    message: 'A location needs at least one of label, address, phone, hours or googleBusinessUrl',
  });
export type Location = z.infer<typeof LocationSchema>;

export const BusinessSchema = z.strictObject({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  hours: z.array(HoursEntrySchema).optional(),
  googleBusinessUrl: UrlSchema.optional(),
  socialLinks: z.array(SocialLinkSchema),
  locations: z.array(LocationSchema).optional(),
});
export type Business = z.infer<typeof BusinessSchema>;

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

/** Site with uniqueness rules: `Page.path` within the site, `Section.id` across all pages. */
export const SiteSchema = SiteObjectSchema.superRefine((site, ctx) => {
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
