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

export const VersionSchema = z.strictObject({
  id: IdSchema,
  variantId: IdSchema,
  snapshot: VersionSnapshotSchema,
  createdBy: z.string().min(1),
  /** v1 (user-approved addition, ADR-003). */
  createdAt: IsoDateTimeSchema,
  note: z.string(),
});
export type Version = z.infer<typeof VersionSchema>;
