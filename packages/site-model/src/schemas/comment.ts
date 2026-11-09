import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './primitives';

export const CommentAuthorSchema = z.enum(['consultant', 'client']);
export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

export const CommentSchema = z.strictObject({
  id: IdSchema,
  versionId: IdSchema,
  sectionId: IdSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  author: CommentAuthorSchema,
  body: z.string().min(1),
  resolved: z.boolean(),
  /** v1 (user-approved addition, ADR-003). */
  createdAt: IsoDateTimeSchema,
});
export type Comment = z.infer<typeof CommentSchema>;
