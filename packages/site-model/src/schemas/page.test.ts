import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalSection } from '../fixtures';
import { PageSchema } from './page';

const page = () => ({ path: '/', title: 'Home', sections: [minimalSection()] });

describe('PageSchema', () => {
  it('accepts a minimal page', () => {
    expect(PageSchema.safeParse(page()).success).toBe(true);
  });
  it('accepts optional metaDescription and ogImageAssetId', () => {
    expect(
      PageSchema.safeParse({ ...page(), metaDescription: 'x', ogImageAssetId: 'asset_og' }).success,
    ).toBe(true);
  });
  it('rejects a path without a leading slash', () => {
    expect(PageSchema.safeParse({ ...page(), path: 'contact' }).success).toBe(false);
  });
  it('rejects missing sections', () => {
    const p = omit(page(), 'sections');
    expect(PageSchema.safeParse(p).success).toBe(false);
  });
  it('rejects an invalid nested section', () => {
    expect(
      PageSchema.safeParse({ ...page(), sections: [{ ...minimalSection(), confidence: 2 }] })
        .success,
    ).toBe(false);
  });
});
