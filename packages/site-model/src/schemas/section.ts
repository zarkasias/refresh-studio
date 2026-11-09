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
  'features', // v2: features/benefits list ("Why choose us")
  'process', // v2: numbered steps ("How it works")
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const CtaKindSchema = z.enum([
  'call',
  'email',
  'book',
  'link',
  'order' /* v1 */,
  'pay' /* v2: pay a bill or invoice online */,
]);
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

const SectionItemFields = {
  title: z.string().optional(),
  body: z.string().optional(),
  imageAssetId: IdSchema.optional(),
  link: z.string().optional(),
};

/** An item that cannot have children (used for nav dropdown entries). */
export const SectionLeafItemSchema = z.strictObject(SectionItemFields);
export type SectionLeafItem = z.infer<typeof SectionLeafItemSchema>;

export const SectionItemSchema = z.strictObject({
  ...SectionItemFields,
  /** v2: nav dropdown entries, one level only. Allowed only in `nav` sections. */
  children: z.array(SectionLeafItemSchema).optional(),
});
export type SectionItem = z.infer<typeof SectionItemSchema>;

export const FormFieldTypeSchema = z.enum([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'file',
  'other', // e.g. a math question or captcha
]);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

/** Field types that offer a fixed list of choices. */
export const CHOICE_FIELD_TYPES: readonly FormFieldType[] = Object.freeze([
  'select',
  'radio',
  'checkbox',
] as const);

/** v2 (ADR-006): one visible form field. Hidden/honeypot fields are not listed. */
export const FormFieldSchema = z
  .strictObject({
    /** As displayed (label or placeholder). */
    label: z.string(),
    type: FormFieldTypeSchema,
    required: z.boolean(),
    /** Choices as displayed. Only for select, radio and checkbox. */
    options: z.array(z.string()).min(1).optional(),
  })
  .refine((field) => field.options === undefined || CHOICE_FIELD_TYPES.includes(field.type), {
    message: 'options are only allowed on select, radio or checkbox fields',
    path: ['options'],
  });
export type FormField = z.infer<typeof FormFieldSchema>;

/** v2 (ADR-006): a form in a section (usually contact or booking). */
export const SectionFormSchema = z.strictObject({
  fields: z.array(FormFieldSchema).min(1),
  /** Submit button text as displayed. */
  submitLabel: z.string().optional(),
  /** Message shown after a successful submit, when known. */
  confirmation: z.string().optional(),
});
export type SectionForm = z.infer<typeof SectionFormSchema>;

export const SectionContentSchema = z.strictObject({
  heading: z.string().optional(),
  subheading: z.string().optional(),
  /** Plain text or minimal markdown. */
  body: z.string().optional(),
  items: z.array(SectionItemSchema).optional(),
  ctas: z.array(CtaSchema).optional(),
  imageAssetIds: z.array(IdSchema).optional(),
  form: SectionFormSchema.optional(),
});
export type SectionContent = z.infer<typeof SectionContentSchema>;

/** Section without its refinement; derive from this, validate with `SectionSchema`. */
export const SectionObjectSchema = z.strictObject({
  id: IdSchema,
  type: SectionTypeSchema,
  content: SectionContentSchema,
  /** Where the section came from in the original DOM. */
  sourceSelector: z.string().optional(),
  /** Mapper confidence 0–1; below `REVIEW_CONFIDENCE_THRESHOLD` it is flagged for review. */
  confidence: ConfidenceSchema,
});

/** Section with its cross-field rule: item `children` only in `nav` sections. */
export const SectionSchema = SectionObjectSchema.superRefine((section, ctx) => {
  if (section.type === 'nav') return;
  section.content.items?.forEach((item, index) => {
    if (item.children !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Item children (dropdowns) are only allowed in nav sections',
        path: ['content', 'items', index, 'children'],
      });
    }
  });
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
