import { describe, expect, it } from 'vitest';
import { minimalVariant } from '../fixtures';
import { VariantSchema } from './variant';

describe('VariantSchema', () => {
  it('accepts the minimal variant', () => {
    expect(VariantSchema.safeParse(minimalVariant()).success).toBe(true);
  });
  it.each(['draft', 'approved', 'shared', 'selected'])('accepts status %s', (status) => {
    expect(VariantSchema.safeParse({ ...minimalVariant(), status }).success).toBe(true);
  });
  it('rejects approval fields: approval belongs to a Version (ADR-005)', () => {
    const v = { ...minimalVariant(), approvedAt: '2026-11-09T10:00:00.000Z', approvedBy: 'David' };
    expect(VariantSchema.safeParse(v).success).toBe(false);
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
  it('supports .pick, .omit and .extend', () => {
    expect(() => VariantSchema.pick({ id: true })).not.toThrow();
    expect(() => VariantSchema.omit({ status: true })).not.toThrow();
    expect(() => VariantSchema.extend({ extra: VariantSchema.shape.id })).not.toThrow();
  });
});
