import { describe, expect, it } from 'vitest';
import { minimalVariant } from '../fixtures';
import { VariantObjectSchema, VariantSchema } from './variant';

const APPROVED_AT = '2026-11-09T10:00:00.000Z';

describe('VariantSchema', () => {
  it('accepts the minimal variant', () => {
    expect(VariantSchema.safeParse(minimalVariant()).success).toBe(true);
  });
  it.each(['approved', 'shared', 'selected'])(
    'accepts a %s variant with approvedAt and approvedBy',
    (status) => {
      const v = { ...minimalVariant(), status, approvedAt: APPROVED_AT, approvedBy: 'David' };
      expect(VariantSchema.safeParse(v).success).toBe(true);
    },
  );
  it('accepts a draft that was approved and then moved back to draft', () => {
    const v = { ...minimalVariant(), approvedAt: APPROVED_AT, approvedBy: 'David' };
    expect(VariantSchema.safeParse(v).success).toBe(true);
  });
  it('rejects a non-ISO approvedAt', () => {
    expect(
      VariantSchema.safeParse({ ...minimalVariant(), approvedAt: 'today', approvedBy: 'David' })
        .success,
    ).toBe(false);
  });
  it('rejects an empty approvedBy', () => {
    expect(
      VariantSchema.safeParse({ ...minimalVariant(), approvedAt: APPROVED_AT, approvedBy: '' })
        .success,
    ).toBe(false);
  });
  it.each([
    ['style', 'playful'],
    ['status', 'published'],
  ])('rejects unknown %s %s', (key, value) => {
    expect(VariantSchema.safeParse({ ...minimalVariant(), [key]: value }).success).toBe(false);
  });
  it('rejects a non-string template id', () => {
    expect(
      VariantSchema.safeParse({ ...minimalVariant(), templates: { sec_hero: 3 } }).success,
    ).toBe(false);
  });

  describe('approval invariant', () => {
    it.each(['draft', 'approved', 'shared', 'selected'])(
      'rejects status %s with approvedAt but no approvedBy',
      (status) => {
        const v = { ...minimalVariant(), status, approvedAt: APPROVED_AT };
        expect(VariantSchema.safeParse(v).success).toBe(false);
      },
    );
    it.each(['draft', 'approved', 'shared', 'selected'])(
      'rejects status %s with approvedBy but no approvedAt',
      (status) => {
        const v = { ...minimalVariant(), status, approvedBy: 'David' };
        expect(VariantSchema.safeParse(v).success).toBe(false);
      },
    );
    it.each(['approved', 'shared', 'selected'])('rejects status %s with neither', (status) => {
      const v = { ...minimalVariant(), status };
      const result = VariantSchema.safeParse(v);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['status']);
    });
  });

  describe('VariantObjectSchema', () => {
    it('skips the approval invariant', () => {
      expect(
        VariantObjectSchema.safeParse({ ...minimalVariant(), status: 'selected' }).success,
      ).toBe(true);
    });
    it('supports .pick, .omit and .extend', () => {
      expect(() => VariantObjectSchema.pick({ id: true })).not.toThrow();
      expect(() => VariantObjectSchema.omit({ approvedAt: true, approvedBy: true })).not.toThrow();
      expect(() =>
        VariantObjectSchema.extend({ extra: VariantObjectSchema.shape.id }),
      ).not.toThrow();
    });
  });
});
