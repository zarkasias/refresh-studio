import { z } from 'zod';
import { IdSchema } from './primitives';
import { DesignTokensSchema } from './tokens';

export const VariantStyleSchema = z.enum(['conservative', 'modern', 'bold']);
export type VariantStyle = z.infer<typeof VariantStyleSchema>;

export const VariantStatusSchema = z.enum(['draft', 'approved', 'shared', 'selected']);
export type VariantStatus = z.infer<typeof VariantStatusSchema>;

/**
 * Statuses a variant may only have while it has an approved Version (CLAUDE.md rule 4,
 * ADR-005). Checked by `assertStatusAllowed`, because approval lives on Version, not Variant.
 */
export const APPROVAL_REQUIRED_STATUSES: readonly VariantStatus[] = [
  'approved',
  'shared',
  'selected',
];

/**
 * The working copy of a redesign option. Approval is not stored here: it belongs to an
 * immutable `Version` of the variant (ADR-005).
 */
export const VariantSchema = z.strictObject({
  id: IdSchema,
  siteId: IdSchema,
  name: z.string().min(1),
  style: VariantStyleSchema,
  tokens: DesignTokensSchema,
  /** Section id -> template id: which template renders each section. */
  templates: z.record(IdSchema, IdSchema),
  status: VariantStatusSchema,
});
export type Variant = z.infer<typeof VariantSchema>;
