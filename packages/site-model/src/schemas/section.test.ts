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
  it.each(['features', 'process'])('accepts v2 section type %s', (type) => {
    expect(SectionSchema.safeParse({ ...minimalSection(), type }).success).toBe(true);
  });
  it('accepts a pay CTA', () => {
    const ctas = [{ label: 'Pay Online', href: 'https://pay.example.com/', kind: 'pay' }];
    expect(SectionSchema.safeParse({ ...minimalSection(), content: { ctas } }).success).toBe(true);
  });

  describe('nav children', () => {
    const nav = (items: unknown[], type = 'nav') => ({
      ...minimalSection(),
      id: 'sec_nav',
      type,
      content: { items },
    });
    it('accepts one level of children in a nav', () => {
      const items = [{ title: 'Services', children: [{ title: 'Implants', link: '/implants' }] }];
      expect(SectionSchema.safeParse(nav(items)).success).toBe(true);
    });
    it('rejects grandchildren', () => {
      const items = [{ title: 'A', children: [{ title: 'B', children: [{ title: 'C' }] }] }];
      expect(SectionSchema.safeParse(nav(items)).success).toBe(false);
    });
    it('rejects children outside a nav section', () => {
      const items = [{ title: 'A', children: [{ title: 'B' }] }];
      const result = SectionSchema.safeParse(nav(items, 'footer'));
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['content', 'items', 0, 'children']);
    });
  });

  describe('form', () => {
    const withForm = (form: unknown) => ({
      ...minimalSection(),
      type: 'contact',
      content: { form },
    });
    it('accepts a full form', () => {
      const form = {
        fields: [
          { label: 'Name', type: 'text', required: true },
          { label: 'Service', type: 'select', required: true, options: ['Refinishing', 'Both'] },
          { label: 'Message', type: 'textarea', required: false },
        ],
        submitLabel: 'Send',
        confirmation: 'Thanks for submitting!',
      };
      expect(SectionSchema.safeParse(withForm(form)).success).toBe(true);
    });
    it('rejects a form with no fields', () => {
      expect(SectionSchema.safeParse(withForm({ fields: [] })).success).toBe(false);
    });
    it('rejects a field without required', () => {
      expect(
        SectionSchema.safeParse(withForm({ fields: [{ label: 'Name', type: 'text' }] })).success,
      ).toBe(false);
    });
    it('rejects options on a text field', () => {
      const fields = [{ label: 'Name', type: 'text', required: true, options: ['a'] }];
      expect(SectionSchema.safeParse(withForm({ fields })).success).toBe(false);
    });
    it('rejects an unknown field type', () => {
      const fields = [{ label: 'Name', type: 'password', required: true }];
      expect(SectionSchema.safeParse(withForm({ fields })).success).toBe(false);
    });
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
