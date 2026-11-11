import { z } from 'zod';
import {
  IdSchema,
  IsoDateTimeSchema,
  STRICT_URLS,
  memoOnUrls,
  type UrlLike,
  type UrlSchemas,
} from './primitives';

/** Hard cap on pages per crawl (CLAUDE.md rule 6). */
export const MAX_CRAWL_PAGES = 25;

export const ConsentMethodSchema = z.enum(['email', 'signed', 'own-site']);
export type ConsentMethod = z.infer<typeof ConsentMethodSchema>;

export function makeProjectSchemas<U extends UrlLike, O extends UrlLike>(urls: UrlSchemas<U, O>) {
  return memoOnUrls(urls, 'makeProjectSchemas', () => {
    // Same names as the strict exports, so the bodies below are shared unchanged.
    const UrlSchema = urls.url;
    const OriginSchema = urls.origin;
    const ConsentScopeSchema = z.strictObject({
      /** Bare origin only. Path scoping is done by `pathPrefix`, never by the origin. */
      origin: OriginSchema,
      /** Restricts the crawl to a path on a shared host, e.g. `/jollyplumbing` on `*.wixsite.com`. */
      pathPrefix: z.string().startsWith('/').optional(),
      maxPages: z.int().min(1).max(MAX_CRAWL_PAGES),
    });

    const ConsentSchema = z.strictObject({
      grantedBy: z.string().min(1),
      grantedAt: IsoDateTimeSchema,
      method: ConsentMethodSchema,
      scope: ConsentScopeSchema,
      evidenceAssetId: IdSchema.optional(),
    });

    const ProjectSchema = z.strictObject({
      id: IdSchema,
      clientName: z.string().min(1),
      siteUrl: UrlSchema,
      consent: ConsentSchema.optional(),
      createdAt: IsoDateTimeSchema,
    });
    return { ConsentScopeSchema, ConsentSchema, ProjectSchema };
  });
}

const strict = makeProjectSchemas(STRICT_URLS);
export const ConsentScopeSchema = strict.ConsentScopeSchema;
export type ConsentScope = z.infer<typeof ConsentScopeSchema>;
export const ConsentSchema = strict.ConsentSchema;
export type Consent = z.infer<typeof ConsentSchema>;
export const ProjectSchema = strict.ProjectSchema;
export type Project = z.infer<typeof ProjectSchema>;
