import { describe, expect, it } from 'vitest';
import {
  ConfidenceSchema,
  HexColorSchema,
  IdSchema,
  IsoDateTimeSchema,
  OriginSchema,
  SlugSchema,
  UrlSchema,
} from './primitives';

describe('HexColorSchema', () => {
  it.each(['#000000', '#ffffff', '#1a2b3c'])('accepts %s', (v) => {
    expect(HexColorSchema.safeParse(v).success).toBe(true);
  });
  it.each([
    ['uppercase', '#FFFFFF'],
    ['mixed case', '#1A2b3c'],
    ['3-digit', '#fff'],
    ['missing #', '1a2b3c'],
    ['8-digit with alpha', '#1a2b3cff'],
    ['non-hex chars', '#gggggg'],
    ['empty', ''],
  ])('rejects %s', (_label, v) => {
    expect(HexColorSchema.safeParse(v).success).toBe(false);
  });
});

describe('ConfidenceSchema', () => {
  it.each([0, 0.5, 1])('accepts %s', (v) => {
    expect(ConfidenceSchema.safeParse(v).success).toBe(true);
  });
  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (v) => {
    expect(ConfidenceSchema.safeParse(v).success).toBe(false);
  });
  it('rejects a numeric string', () => {
    expect(ConfidenceSchema.safeParse('0.5').success).toBe(false);
  });
});

describe('IsoDateTimeSchema', () => {
  it('accepts toISOString output', () => {
    expect(IsoDateTimeSchema.safeParse(new Date(0).toISOString()).success).toBe(true);
  });
  it.each(['2026-11-09', 'yesterday', '2026-11-09 12:00:00'])('rejects %s', (v) => {
    expect(IsoDateTimeSchema.safeParse(v).success).toBe(false);
  });
});

describe('UrlSchema', () => {
  it.each(['https://example.com', 'http://example.com/path?q=1'])('accepts %s', (v) => {
    expect(UrlSchema.safeParse(v).success).toBe(true);
  });
  it.each(['example.com', '/relative', 'mailto:a@example.com', 'ftp://example.com'])(
    'rejects %s',
    (v) => {
      expect(UrlSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe('IdSchema', () => {
  it('rejects an empty id', () => {
    expect(IdSchema.safeParse('').success).toBe(false);
  });
});

describe('OriginSchema', () => {
  it.each(['https://a.com', 'https://x.wixsite.com', 'https://a.com:8443'])('accepts %s', (v) => {
    expect(OriginSchema.safeParse(v).success).toBe(true);
  });
  it.each([
    ['a path', 'https://x.wixsite.com/jollyplumbing'],
    ['a trailing slash', 'https://a.com/'],
    ['a query', 'https://a.com?x=1'],
    ['a hash', 'https://a.com#top'],
    ['an uppercase host', 'https://A.com'],
    ['a default port', 'https://a.com:443'],
    ['no scheme', 'a.com'],
    ['a non-http scheme', 'ftp://a.com'],
  ])('rejects %s', (_label, v) => {
    expect(OriginSchema.safeParse(v).success).toBe(false);
  });
});

describe('SlugSchema', () => {
  it.each(['toast', 'wp-bakery-custom', '500px'])('accepts %s', (v) => {
    expect(SlugSchema.safeParse(v).success).toBe(true);
  });
  it.each(['Toast', ' ', 'toast pos', '', '-toast', 'toast_pos'])('rejects %j', (v) => {
    expect(SlugSchema.safeParse(v).success).toBe(false);
  });
});

describe('IsoDateTimeSchema offsets', () => {
  it('rejects a non-UTC offset', () => {
    expect(IsoDateTimeSchema.safeParse('2026-11-09T12:00:00+02:00').success).toBe(false);
  });
});
