import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/brand', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/brand');
  });
});
