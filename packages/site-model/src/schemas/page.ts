import { z } from 'zod';
import { IdSchema } from './primitives';
import { SectionSchema } from './section';

export const PageSchema = z.strictObject({
  path: z.string().startsWith('/'),
  title: z.string(),
  metaDescription: z.string().optional(),
  ogImageAssetId: IdSchema.optional(),
  sections: z.array(SectionSchema),
});
export type Page = z.infer<typeof PageSchema>;
