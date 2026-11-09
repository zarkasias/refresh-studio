import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@srs/exporter-astro-site', () => {
  it('loads', () => {
    expect(packageName).toBe('@srs/exporter-astro-site');
  });
});
