import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalVersion } from '../fixtures';
import { VersionSchema } from './version';

describe('VersionSchema', () => {
  it('accepts the minimal version', () => {
    expect(VersionSchema.safeParse(minimalVersion()).success).toBe(true);
  });
  it('rejects a snapshot without a variant', () => {
    const v = minimalVersion();
    expect(VersionSchema.safeParse({ ...v, snapshot: { site: v.snapshot.site } }).success).toBe(
      false,
    );
  });
  it('rejects a snapshot with an invalid site', () => {
    const v = minimalVersion();
    const snapshot = { ...v.snapshot, site: { ...v.snapshot.site, schemaVersion: 2 } };
    expect(VersionSchema.safeParse({ ...v, snapshot }).success).toBe(false);
  });
  it('rejects a snapshot whose variant breaks the approval invariant', () => {
    const v = minimalVersion();
    const snapshot = { ...v.snapshot, variant: { ...v.snapshot.variant, status: 'selected' } };
    expect(VersionSchema.safeParse({ ...v, snapshot }).success).toBe(false);
  });
  it('accepts a snapshot of an approved variant', () => {
    const v = minimalVersion();
    const variant = {
      ...v.snapshot.variant,
      status: 'approved' as const,
      approvedAt: '2026-11-09T10:00:00.000Z',
      approvedBy: 'David',
    };
    expect(VersionSchema.safeParse({ ...v, snapshot: { ...v.snapshot, variant } }).success).toBe(
      true,
    );
  });
  it('rejects a missing createdAt', () => {
    expect(VersionSchema.safeParse(omit(minimalVersion(), 'createdAt')).success).toBe(false);
  });
  it('rejects a non-UTC createdAt', () => {
    const v = { ...minimalVersion(), createdAt: '2026-11-09T12:00:00+02:00' };
    expect(VersionSchema.safeParse(v).success).toBe(false);
  });
  it('rejects a missing createdBy', () => {
    const v = omit(minimalVersion(), 'createdBy');
    expect(VersionSchema.safeParse(v).success).toBe(false);
  });
});
