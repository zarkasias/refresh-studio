import { z } from 'zod';
import { IdSchema, UrlSchema } from './primitives';

export const AssetKindSchema = z.enum(['image', 'logo', 'font', 'screenshot', 'document']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/** v1: any file the model refers to by `*AssetId`. */
export const AssetSchema = z.strictObject({
  id: IdSchema,
  siteId: IdSchema,
  kind: AssetKindSchema,
  sourceUrl: UrlSchema,
  /** Path in Supabase Storage once stored. */
  storagePath: z.string().min(1).optional(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  bytes: z.int().nonnegative().optional(),
  /** Alt text as found on the source site; empty string means decorative. */
  alt: z.string().optional(),
});
export type Asset = z.infer<typeof AssetSchema>;
