import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/audit', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/audit');
  });
});
