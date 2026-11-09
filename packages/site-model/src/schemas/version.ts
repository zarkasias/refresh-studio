import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './primitives';
import { SiteSchema } from './site';
import { VariantSchema } from './variant';

/** v1: a frozen copy of the site and variant at this version. */
export const VersionSnapshotSchema = z.strictObject({
  site: SiteSchema,
  variant: VariantSchema,
});
export type VersionSnapshot = z.infer<typeof VersionSnapshotSchema>;

/**
 * The Version object without its cross-field refinements. Zod 4 refined schemas cannot be
 * `.pick`ed, `.omit`ted or `.extend`ed, so derive from this one and validate with `VersionSchema`.
 */
export const VersionObjectSchema = z.strictObject({
  id: IdSchema,
  variantId: IdSchema,
  /** 1, 2, 3, ... per variant, in creation order; unique within the variant (ADR-005). */
  number: z.int().min(1),
  snapshot: VersionSnapshotSchema,
  createdBy: z.string().min(1),
  /** v1 (user-approved addition, ADR-003). */
  createdAt: IsoDateTimeSchema,
  note: z.string(),
  /** Set once by the consultant approval step (CLAUDE.md rule 4, ADR-005). Never cleared. */
  approvedAt: IsoDateTimeSchema.optional(),
  approvedBy: z.string().min(1).optional(),
});

/**
 * Version with its invariants: `approvedAt` and `approvedBy` are both present or both absent,
 * approval is not earlier than creation, and the snapshot belongs to this variant.
 */
export const VersionSchema = VersionObjectSchema.superRefine((version, ctx) => {
  const hasAt = version.approvedAt !== undefined;
  const hasBy = version.approvedBy !== undefined;
  if (hasAt !== hasBy) {
    ctx.addIssue({
      code: 'custom',
      message: 'approvedAt and approvedBy must be set together',
      path: [hasAt ? 'approvedBy' : 'approvedAt'],
    });
  }
  if (version.approvedAt !== undefined && version.approvedAt < version.createdAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'approvedAt cannot be earlier than createdAt',
      path: ['approvedAt'],
    });
  }
  if (version.snapshot.variant.id !== version.variantId) {
    ctx.addIssue({
      code: 'custom',
      message: 'snapshot.variant.id must equal variantId',
      path: ['snapshot', 'variant', 'id'],
    });
  }
});
export type Version = z.infer<typeof VersionSchema>;

/** True when the consultant approved this version (both approval fields present). */
export function isApprovedVersion(
  version: Pick<Version, 'approvedAt' | 'approvedBy'>,
): version is Version & { approvedAt: string; approvedBy: string } {
  return version.approvedAt !== undefined && version.approvedBy !== undefined;
}
