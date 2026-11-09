import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalAsset } from '../fixtures';
import { AssetSchema } from './asset';

describe('AssetSchema', () => {
  it('accepts the minimal asset', () => {
    expect(AssetSchema.safeParse(minimalAsset()).success).toBe(true);
  });
  it('accepts all optional fields, including empty alt', () => {
    const a = {
      ...minimalAsset(),
      storagePath: 'sites/site_1/logo.png',
      width: 200,
      height: 80,
      bytes: 0,
      alt: '',
    };
    expect(AssetSchema.safeParse(a).success).toBe(true);
  });
  it.each(['image', 'logo', 'font', 'screenshot', 'document'])('accepts kind %s', (kind) => {
    expect(AssetSchema.safeParse({ ...minimalAsset(), kind }).success).toBe(true);
  });
  it('rejects an unknown kind', () => {
    expect(AssetSchema.safeParse({ ...minimalAsset(), kind: 'video' }).success).toBe(false);
  });
  it.each([
    ['width', 0],
    ['height', 1.5],
    ['bytes', -1],
  ])('rejects %s = %s', (key, value) => {
    expect(AssetSchema.safeParse({ ...minimalAsset(), [key]: value }).success).toBe(false);
  });
  it('rejects a missing siteId', () => {
    const a = omit(minimalAsset(), 'siteId');
    expect(AssetSchema.safeParse(a).success).toBe(false);
  });
});
