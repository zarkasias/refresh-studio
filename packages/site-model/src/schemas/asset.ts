import { z } from 'zod';
import { IdSchema, STRICT_URLS, memoOnUrls, type UrlLike, type UrlSchemas } from './primitives';

export const AssetKindSchema = z.enum(['image', 'logo', 'font', 'screenshot', 'document']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export function makeAssetSchemas<U extends UrlLike, O extends UrlLike>(urls: UrlSchemas<U, O>) {
  return memoOnUrls(urls, 'makeAssetSchemas', () => {
    // Same names as the strict exports, so the bodies below are shared unchanged.
    const UrlSchema = urls.url;
    /** v1: any file the model refers to by `*AssetId`. */
    const AssetSchema = z.strictObject({
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
    return { AssetSchema };
  });
}

const strictAssetSchemas = makeAssetSchemas(STRICT_URLS);
export const AssetSchema = strictAssetSchemas.AssetSchema;
export type Asset = z.infer<typeof AssetSchema>;
