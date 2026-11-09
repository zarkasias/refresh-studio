import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalComment } from '../fixtures';
import { CommentSchema } from './comment';

describe('CommentSchema', () => {
  it('accepts the minimal comment', () => {
    expect(CommentSchema.safeParse(minimalComment()).success).toBe(true);
  });
  it('accepts a pinned comment on a section', () => {
    const c = { ...minimalComment(), sectionId: 'sec_hero', x: 120, y: 48, author: 'consultant' };
    expect(CommentSchema.safeParse(c).success).toBe(true);
  });
  it('rejects an unknown author', () => {
    expect(CommentSchema.safeParse({ ...minimalComment(), author: 'agent' }).success).toBe(false);
  });
  it('rejects an empty body', () => {
    expect(CommentSchema.safeParse({ ...minimalComment(), body: '' }).success).toBe(false);
  });
  it('rejects a missing createdAt', () => {
    expect(CommentSchema.safeParse(omit(minimalComment(), 'createdAt')).success).toBe(false);
  });
  it('rejects a non-UTC createdAt', () => {
    const c = { ...minimalComment(), createdAt: '2026-11-09T12:00:00-05:00' };
    expect(CommentSchema.safeParse(c).success).toBe(false);
  });
  it('rejects a missing resolved flag', () => {
    const c = omit(minimalComment(), 'resolved');
    expect(CommentSchema.safeParse(c).success).toBe(false);
  });
});
