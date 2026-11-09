import { z } from 'zod';

/** Non-empty identifier. The model does not fix an id format (uuid, cuid, ...). */
export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

/** Lowercase 6-digit hex color, e.g. `#1a2b3c`. Uppercase, 3-digit and missing `#` are rejected. */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'Expected a lowercase hex color like #1a2b3c');
export type HexColor = z.infer<typeof HexColorSchema>;

/**
 * ISO 8601 datetime in UTC (`Z` suffix) with millisecond precision, exactly as produced by
 * `Date.prototype.toISOString()`, so values round-trip through Postgres `timestamptz` unchanged.
 */
export const IsoDateTimeSchema = z.iso.datetime({ precision: 3 });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** A number from 0 to 1 inclusive. */
export const ConfidenceSchema = z.number().min(0).max(1);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Absolute http(s) URL. */
export const UrlSchema = z.httpUrl();
export type Url = z.infer<typeof UrlSchema>;

function isBareOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/**
 * A bare http(s) origin such as `https://example.com`: exactly what `new URL(v).origin` returns,
 * so no path, query, hash, trailing slash, default port or uppercase host.
 */
export const OriginSchema = UrlSchema.refine(isBareOrigin, {
  message: 'Expected a bare origin like https://example.com (no path, query or trailing slash)',
});
export type Origin = z.infer<typeof OriginSchema>;

/** Lowercase slug for open-ended names (social network, provider, builder), e.g. `wp-bakery-custom`. */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Expected a lowercase slug like toast or oxygen');
export type Slug = z.infer<typeof SlugSchema>;
