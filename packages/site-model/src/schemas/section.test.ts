import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalSection } from '../fixtures';
import {
  needsReview,
  REVIEW_CONFIDENCE_THRESHOLD,
  SectionSchema,
  SectionTypeSchema,
} from './section';

describe('SectionSchema', () => {
  it('accepts the minimal section', () => {
    expect(SectionSchema.safeParse(minimalSection()).success).toBe(true);
  });
  it('accepts a full menu section with an order CTA and provider', () => {
    const s = {
      id: 'sec_menu',
      type: 'menu',
      content: {
        heading: 'Menu',
        subheading: 'Breakfast all day',
        body: 'Coffee and **burritos**.',
        items: [
          {
            title: 'Breakfast burrito',
            body: '$9',
            imageAssetId: 'asset_1',
            link: '/menu#burrito',
          },
        ],
        ctas: [
          {
            label: 'Order online',
            href: 'https://order.toasttab.com/x',
            kind: 'order',
            provider: 'toast',
          },
        ],
        imageAssetIds: ['asset_1'],
      },
      sourceSelector: 'main > section:nth-of-type(2)',
      confidence: 0.65,
    };
    expect(SectionSchema.safeParse(s).success).toBe(true);
  });
  it('accepts every section type', () => {
    for (const type of SectionTypeSchema.options) {
      expect(SectionSchema.safeParse({ ...minimalSection(), type }).success).toBe(true);
    }
  });
  it('rejects an unknown section type', () => {
    expect(SectionSchema.safeParse({ ...minimalSection(), type: 'blog' }).success).toBe(false);
  });
  it('rejects an unknown cta kind', () => {
    const s = minimalSection();
    expect(
      SectionSchema.safeParse({ ...s, content: { ctas: [{ label: 'x', href: '/', kind: 'sms' }] } })
        .success,
    ).toBe(false);
  });
  it('rejects a missing confidence', () => {
    const s = omit(minimalSection(), 'confidence');
    expect(SectionSchema.safeParse(s).success).toBe(false);
  });
  it.each([0, 1])('accepts confidence %s', (confidence) => {
    expect(SectionSchema.safeParse({ ...minimalSection(), confidence }).success).toBe(true);
  });
  it.each([-0.01, 1.01])('rejects confidence %s', (confidence) => {
    expect(SectionSchema.safeParse({ ...minimalSection(), confidence }).success).toBe(false);
  });
  it.each(['toast', 'wp-bakery-custom'])('accepts cta provider %s', (provider) => {
    const s = minimalSection();
    const ctas = [{ label: 'Order', href: '/order', kind: 'order', provider }];
    expect(SectionSchema.safeParse({ ...s, content: { ctas } }).success).toBe(true);
  });
  it.each(['Toast', ' ', 'toast pos'])('rejects cta provider %j', (provider) => {
    const s = minimalSection();
    const ctas = [{ label: 'Order', href: '/order', kind: 'order', provider }];
    expect(SectionSchema.safeParse({ ...s, content: { ctas } }).success).toBe(false);
  });
  it('rejects unknown content keys', () => {
    expect(SectionSchema.safeParse({ ...minimalSection(), content: { title: 'x' } }).success).toBe(
      false,
    );
  });
});

describe('needsReview', () => {
  it('uses a 0.7 threshold', () => {
    expect(REVIEW_CONFIDENCE_THRESHOLD).toBe(0.7);
  });
  it.each([
    [0.69, true],
    [0.7, false],
    [0.71, false],
  ])('confidence %s -> %s', (confidence, expected) => {
    expect(needsReview({ ...minimalSection(), confidence })).toBe(expected);
  });
  it('flags NaN confidence', () => {
    expect(needsReview({ confidence: Number.NaN })).toBe(true);
  });
  it('flags unvalidated input without a numeric confidence', () => {
    const unvalidated = { confidence: undefined } as unknown as { confidence: number };
    expect(needsReview(unvalidated)).toBe(true);
  });
});
