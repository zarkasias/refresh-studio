import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/agents', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/agents');
  });
});
