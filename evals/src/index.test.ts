import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/evals', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/evals');
  });
});
