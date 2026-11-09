import { describe, expect, it } from 'vitest';
import { omit } from '../test-utils';
import { minimalConsent, minimalProject } from '../fixtures';
import { ConsentSchema, MAX_CRAWL_PAGES, ProjectSchema } from './project';

describe('ProjectSchema', () => {
  it('accepts the minimal project', () => {
    expect(ProjectSchema.safeParse(minimalProject()).success).toBe(true);
  });
  it('accepts a project without consent (the crawl guard, not the schema, enforces it)', () => {
    const p = omit(minimalProject(), 'consent');
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });
  it('rejects a missing clientName', () => {
    const p = omit(minimalProject(), 'clientName');
    expect(ProjectSchema.safeParse(p).success).toBe(false);
  });
  it('rejects a non-URL siteUrl', () => {
    expect(ProjectSchema.safeParse({ ...minimalProject(), siteUrl: 'example.com' }).success).toBe(
      false,
    );
  });
  it('rejects a non-ISO createdAt', () => {
    expect(ProjectSchema.safeParse({ ...minimalProject(), createdAt: 'Nov 9' }).success).toBe(
      false,
    );
  });
  it('rejects unknown keys', () => {
    expect(ProjectSchema.safeParse({ ...minimalProject(), extra: true }).success).toBe(false);
  });
});

describe('ConsentSchema', () => {
  it('accepts the minimal consent', () => {
    expect(ConsentSchema.safeParse(minimalConsent()).success).toBe(true);
  });
  it('accepts a pathPrefix and evidenceAssetId', () => {
    const c = minimalConsent();
    c.scope = {
      origin: 'https://jollyplumbingco.wixsite.com',
      pathPrefix: '/jollyplumbing',
      maxPages: 10,
    };
    c.evidenceAssetId = 'asset_email';
    expect(ConsentSchema.safeParse(c).success).toBe(true);
  });
  it.each(['email', 'signed', 'own-site'])('accepts method %s', (method) => {
    expect(ConsentSchema.safeParse({ ...minimalConsent(), method }).success).toBe(true);
  });
  it('rejects an unknown method', () => {
    expect(ConsentSchema.safeParse({ ...minimalConsent(), method: 'verbal' }).success).toBe(false);
  });
  it(`accepts maxPages = ${MAX_CRAWL_PAGES}`, () => {
    const c = minimalConsent();
    c.scope.maxPages = 25;
    expect(ConsentSchema.safeParse(c).success).toBe(true);
  });
  it.each([26, 0, 2.5])('rejects maxPages = %s', (maxPages) => {
    const c = minimalConsent();
    c.scope.maxPages = maxPages;
    expect(ConsentSchema.safeParse(c).success).toBe(false);
  });
  it.each(['https://a.com', 'https://x.wixsite.com'])('accepts bare origin %s', (origin) => {
    const c = minimalConsent();
    c.scope.origin = origin;
    expect(ConsentSchema.safeParse(c).success).toBe(true);
  });
  it.each(['https://x.wixsite.com/jollyplumbing', 'https://a.com/', 'https://a.com?x=1'])(
    'rejects origin %s (path scoping belongs in pathPrefix)',
    (origin) => {
      const c = minimalConsent();
      c.scope.origin = origin;
      expect(ConsentSchema.safeParse(c).success).toBe(false);
    },
  );
  it('rejects a pathPrefix without a leading slash', () => {
    const c = minimalConsent();
    c.scope.pathPrefix = 'jollyplumbing';
    expect(ConsentSchema.safeParse(c).success).toBe(false);
  });
  it('rejects a missing grantedAt', () => {
    const c = omit(minimalConsent(), 'grantedAt');
    expect(ConsentSchema.safeParse(c).success).toBe(false);
  });
});
