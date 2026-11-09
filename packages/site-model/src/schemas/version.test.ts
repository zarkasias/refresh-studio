import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalVersion } from '../fixtures';
import { VersionObjectSchema, VersionSchema, isApprovedVersion } from './version';

const APPROVED_AT = '2026-11-09T13:00:00.000Z';

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
  it('rejects a snapshot of a different variant', () => {
    const v = minimalVersion();
    const snapshot = { ...v.snapshot, variant: { ...v.snapshot.variant, id: 'var_other' } };
    const result = VersionSchema.safeParse({ ...v, snapshot });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['snapshot', 'variant', 'id']);
  });
  it('rejects a missing createdAt', () => {
    expect(VersionSchema.safeParse(omit(minimalVersion(), 'createdAt')).success).toBe(false);
  });
  it('rejects a non-UTC createdAt', () => {
    const v = { ...minimalVersion(), createdAt: '2026-11-09T12:00:00+02:00' };
    expect(VersionSchema.safeParse(v).success).toBe(false);
  });
  it('rejects a missing createdBy', () => {
    expect(VersionSchema.safeParse(omit(minimalVersion(), 'createdBy')).success).toBe(false);
  });
  it.each([0, -1, 1.5])('rejects number %s', (number) => {
    expect(VersionSchema.safeParse({ ...minimalVersion(), number }).success).toBe(false);
  });
  it('rejects a missing number', () => {
    expect(VersionSchema.safeParse(omit(minimalVersion(), 'number')).success).toBe(false);
  });

  describe('approval (ADR-005)', () => {
    it('accepts an approved version', () => {
      const v = { ...minimalVersion(), approvedAt: APPROVED_AT, approvedBy: 'David' };
      expect(VersionSchema.safeParse(v).success).toBe(true);
      expect(isApprovedVersion(v)).toBe(true);
    });
    it('treats a version without approval fields as unapproved', () => {
      expect(isApprovedVersion(minimalVersion())).toBe(false);
    });
    it('rejects approvedAt without approvedBy', () => {
      const result = VersionSchema.safeParse({ ...minimalVersion(), approvedAt: APPROVED_AT });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['approvedBy']);
    });
    it('rejects approvedBy without approvedAt', () => {
      const result = VersionSchema.safeParse({ ...minimalVersion(), approvedBy: 'David' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['approvedAt']);
    });
    it('rejects an empty approvedBy', () => {
      const v = { ...minimalVersion(), approvedAt: APPROVED_AT, approvedBy: '' };
      expect(VersionSchema.safeParse(v).success).toBe(false);
    });
    it('rejects a non-ISO approvedAt', () => {
      const v = { ...minimalVersion(), approvedAt: 'today', approvedBy: 'David' };
      expect(VersionSchema.safeParse(v).success).toBe(false);
    });
    it('rejects approval before the version was created', () => {
      const v = { ...minimalVersion(), approvedAt: '2026-11-09T11:59:59.999Z', approvedBy: 'D' };
      expect(VersionSchema.safeParse(v).success).toBe(false);
    });
    it('accepts approval at the same instant as creation', () => {
      const v = minimalVersion();
      expect(
        VersionSchema.safeParse({ ...v, approvedAt: v.createdAt, approvedBy: 'David' }).success,
      ).toBe(true);
    });
  });

  describe('VersionObjectSchema', () => {
    it('skips the refinements', () => {
      const v = { ...minimalVersion(), approvedAt: APPROVED_AT };
      expect(VersionObjectSchema.safeParse(v).success).toBe(true);
    });
  });
});
