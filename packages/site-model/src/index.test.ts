import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/site-model', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/site-model');
  });
});
