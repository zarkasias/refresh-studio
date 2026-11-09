import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/exporter-style-guide', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/exporter-style-guide');
  });
});
