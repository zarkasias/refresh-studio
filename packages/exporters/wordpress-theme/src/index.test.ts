import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/exporter-wordpress-theme', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/exporter-wordpress-theme');
  });
});
