import { z } from 'zod';
import { ConfidenceSchema, IdSchema, SlugSchema } from './primitives';

export const SectionTypeSchema = z.enum([
  'nav',
  'hero',
  'services',
  'about',
  'testimonials',
  'gallery',
  'pricing',
  'faq',
  'team',
  'contact',
  'booking',
  'map',
  'cta',
  'footer',
  'richtext',
  'menu', // v1
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const CtaKindSchema = z.enum(['call', 'email', 'book', 'link', 'order' /* v1 */]);
export type CtaKind = z.infer<typeof CtaKindSchema>;

export const CtaSchema = z.strictObject({
  label: z.string(),
  /** Raw href as found, so `tel:`, `mailto:` and relative links are allowed. */
  href: z.string(),
  kind: CtaKindSchema,
  /** v1: external ordering/booking tool, e.g. `toast`, `meevo`, `phorest`. */
  provider: SlugSchema.optional(),
});
export type Cta = z.infer<typeof CtaSchema>;

export const SectionItemSchema = z.strictObject({
  title: z.string().optional(),
  body: z.string().optional(),
  imageAssetId: IdSchema.optional(),
  link: z.string().optional(),
});
export type SectionItem = z.infer<typeof SectionItemSchema>;

export const SectionContentSchema = z.strictObject({
  heading: z.string().optional(),
  subheading: z.string().optional(),
  /** Plain text or minimal markdown. */
  body: z.string().optional(),
  items: z.array(SectionItemSchema).optional(),
  ctas: z.array(CtaSchema).optional(),
  imageAssetIds: z.array(IdSchema).optional(),
});
export type SectionContent = z.infer<typeof SectionContentSchema>;

export const SectionSchema = z.strictObject({
  id: IdSchema,
  type: SectionTypeSchema,
  content: SectionContentSchema,
  /** Where the section came from in the original DOM. */
  sourceSelector: z.string().optional(),
  /** Mapper confidence 0–1; below `REVIEW_CONFIDENCE_THRESHOLD` it is flagged for review. */
  confidence: ConfidenceSchema,
});
export type Section = z.infer<typeof SectionSchema>;

/** Sections with confidence strictly below this go to the review queue. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * True when the mapper was unsure of this section (confidence < 0.7). Written as a negated `>=`
 * so that NaN or other unvalidated input is flagged rather than silently passed.
 */
export function needsReview(section: Pick<Section, 'confidence'>): boolean {
  return !(section.confidence >= REVIEW_CONFIDENCE_THRESHOLD);
}
