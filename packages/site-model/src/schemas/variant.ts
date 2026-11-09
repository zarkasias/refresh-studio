import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './primitives';
import { DesignTokensSchema } from './tokens';

export const VariantStyleSchema = z.enum(['conservative', 'modern', 'bold']);
export type VariantStyle = z.infer<typeof VariantStyleSchema>;

export const VariantStatusSchema = z.enum(['draft', 'approved', 'shared', 'selected']);
export type VariantStatus = z.infer<typeof VariantStatusSchema>;

/** Statuses that can only be reached through the consultant approval step (CLAUDE.md rule 4). */
export const APPROVAL_REQUIRED_STATUSES: readonly VariantStatus[] = [
  'approved',
  'shared',
  'selected',
];

/**
 * The Variant object without the approval invariant. Zod 4 refined schemas cannot be
 * `.pick`ed, `.omit`ted or `.extend`ed, so derive from this one and validate with `VariantSchema`.
 */
export const VariantObjectSchema = z.strictObject({
  id: IdSchema,
  siteId: IdSchema,
  name: z.string().min(1),
  style: VariantStyleSchema,
  tokens: DesignTokensSchema,
  /** Section id -> template id: which template renders each section. */
  templates: z.record(IdSchema, IdSchema),
  status: VariantStatusSchema,
  /** v1: set by the consultant approval step (CLAUDE.md rule 4). */
  approvedAt: IsoDateTimeSchema.optional(),
  /** v1 */
  approvedBy: z.string().min(1).optional(),
});

/**
 * Variant with the approval invariant: `approvedAt` and `approvedBy` are both present or both
 * absent, and `approved`, `shared` and `selected` require both.
 */
export const VariantSchema = VariantObjectSchema.superRefine((variant, ctx) => {
  const hasAt = variant.approvedAt !== undefined;
  const hasBy = variant.approvedBy !== undefined;
  if (hasAt !== hasBy) {
    ctx.addIssue({
      code: 'custom',
      message: 'approvedAt and approvedBy must be set together',
      path: [hasAt ? 'approvedBy' : 'approvedAt'],
    });
  }
  if (APPROVAL_REQUIRED_STATUSES.includes(variant.status) && !(hasAt && hasBy)) {
    ctx.addIssue({
      code: 'custom',
      message: `A ${variant.status} variant needs approvedAt and approvedBy from the consultant approval step`,
      path: ['status'],
    });
  }
});
export type Variant = z.infer<typeof VariantSchema>;
