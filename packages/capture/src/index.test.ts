import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/capture', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/capture');
  });
});
