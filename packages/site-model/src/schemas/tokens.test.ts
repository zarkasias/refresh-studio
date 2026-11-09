import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalTokens } from '../fixtures';
import { DesignTokensSchema, GoogleFontSchema } from './tokens';

describe('GoogleFontSchema', () => {
  it('accepts a family with weights', () => {
    expect(GoogleFontSchema.safeParse({ family: 'Inter', weights: [400, 700] }).success).toBe(true);
  });
  it.each([
    ['empty family', { family: '', weights: [400] }],
    ['no weights', { family: 'Inter', weights: [] }],
    ['non-integer weight', { family: 'Inter', weights: [400.5] }],
    ['string weight', { family: 'Inter', weights: ['400'] }],
  ])('rejects %s', (_label, v) => {
    expect(GoogleFontSchema.safeParse(v).success).toBe(false);
  });
});

describe('DesignTokensSchema', () => {
  it('accepts the minimal tokens', () => {
    expect(DesignTokensSchema.safeParse(minimalTokens()).success).toBe(true);
  });
  it('rejects an uppercase hex color', () => {
    const t = minimalTokens();
    t.color.primary = '#1D4ED8';
    expect(DesignTokensSchema.safeParse(t).success).toBe(false);
  });
  it('rejects a missing color role', () => {
    const t = minimalTokens();
    const color = omit(t.color, 'mutedText');
    expect(DesignTokensSchema.safeParse({ ...t, color }).success).toBe(false);
  });
  it('rejects an unknown radius', () => {
    expect(DesignTokensSchema.safeParse({ ...minimalTokens(), radius: 'xl' }).success).toBe(false);
  });
  it('rejects a non-positive type scale', () => {
    expect(
      DesignTokensSchema.safeParse({ ...minimalTokens(), typeScale: { base: 0, ratio: 1.2 } })
        .success,
    ).toBe(false);
  });
});
