import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  minimalAsset,
  minimalAuditRun,
  minimalCaptureRun,
  minimalCapturedPage,
  minimalConsent,
  minimalPageFacts,
  minimalProject,
  minimalReportDoc,
  minimalReportVersion,
  minimalSite,
  minimalVersion,
} from '../fixtures';
import {
  ConsentSchema,
  ConsentScopeSchema,
  ProjectSchema,
  VersionSchema,
  SiteSchema,
  BusinessSchema,
  AssetSchema,
  CaptureRunSchema,
  PageFactsSchema,
  CapturedPageSchema,
  EvidenceSchema,
  LighthouseSummarySchema,
  AuditRunSchema,
  CheckResultSchema,
  ReportFindingSchema,
  ReportDocSchema,
  ReportVersionSchema,
  OriginSchema,
  SiteObjectSchema,
  UrlSchema,
} from '../schemas';
import {
  FixtureConsentSchema,
  FixtureConsentScopeSchema,
  FixtureProjectSchema,
  FixtureVersionSchema,
  FixtureSiteSchema,
  FixtureBusinessSchema,
  FixtureAssetSchema,
  FixtureCaptureRunSchema,
  FixturePageFactsSchema,
  FixtureCapturedPageSchema,
  FixtureEvidenceSchema,
  FixtureLighthouseSummarySchema,
  FixtureAuditRunSchema,
  FixtureCheckResultSchema,
  FixtureReportFindingSchema,
  FixtureReportDocSchema,
  FixtureReportVersionSchema,
  FixtureOriginSchema,
  FixtureUrlSchema,
  isLoopbackHttpUrl,
} from './index';

const LOOPBACK = 'http://127.0.0.1:3000';

/** Swap every http(s) URL string in a record for a loopback one (bare origins stay bare). */
function loopbackify<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v)) {
      const url = new URL(v);
      return url.origin === v ? LOOPBACK : `${LOOPBACK}${url.pathname}${url.search}${url.hash}`;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

describe('fixture URL schema', () => {
  it.each([
    'http://127.0.0.1:3000/',
    'http://127.0.0.1/',
    'http://127.1.2.3:8080/a?b=c',
    'http://localhost:5173/',
    'http://localhost/x',
    'http://[::1]:3000/',
    'http://127.0.0.1:3000/#frag',
    'https://example.com/', // anything strict accepts still passes
  ])('accepts %s', (url) => {
    expect(FixtureUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    'https://127.0.0.1:3000/', // loopback is http only
    'http://user:pw@127.0.0.1:3000/',
    'http://:pw@localhost/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://0.0.0.0/',
    'http://[::ffff:127.0.0.1]/',
    'ftp://127.0.0.1/',
    '127.0.0.1:3000',
    'http://127.0.0.1:3000/ x',
    'http://localhost:99999/',
    '',
  ])('rejects %s', (url) => {
    expect(FixtureUrlSchema.safeParse(url).success).toBe(false);
  });

  // N3: odd spellings of loopback are not accepted; only the canonical form is.
  it.each([
    ['decimal integer host', 'http://2130706433/'],
    ['octal host', 'http://0177.0.0.1/'],
    ['hex host', 'http://0x7f.0.0.1/'],
    ['short dotted host', 'http://127.1/'],
    ['trailing-dot localhost', 'http://localhost./'],
    ['uppercase localhost', 'http://LOCALHOST/'],
    ['unicode look-alike (fullwidth digits)', 'http://\uFF11\uFF12\uFF17.0.0.1/'],
    ['unicode look-alike (ideographic dot)', 'http://127\u30020\u30020\u30021/'],
    ['backslash credential trick', 'http://127.0.0.1\\@evil.com/'],
    ['@ credential trick', 'http://127.0.0.1@evil.com/'],
    ['port with credential trick', 'http://localhost:80@evil.com/'],
    ['default port spelled out', 'http://127.0.0.1:80/'],
    ['leading-zero octet', 'http://127.000.000.001/'],
    ['octet over 255', 'http://127.0.0.256/'],
    ['subdomain of localhost', 'http://foo.localhost/'],
    ['whitespace-padded', ' http://127.0.0.1:3000/'],
  ])('rejects the odd spelling: %s', (_label, url) => {
    // Never treated as loopback, so the fixture schema agrees with the strict one (some of these
    // are public hosts the strict schema accepts, e.g. `127.0.0.1@evil.com` is host evil.com).
    expect(isLoopbackHttpUrl(url)).toBe(false);
    expect(FixtureUrlSchema.safeParse(url).success).toBe(UrlSchema.safeParse(url).success);
  });

  it('the strict schemas still reject loopback', () => {
    for (const url of ['http://127.0.0.1:3000/', 'http://localhost:3000/', 'http://[::1]:3000/']) {
      expect(UrlSchema.safeParse(url).success).toBe(false);
    }
    expect(OriginSchema.safeParse(LOOPBACK).success).toBe(false);
  });

  it('the fixture origin schema accepts bare loopback origins and nothing with a path', () => {
    expect(FixtureOriginSchema.safeParse(LOOPBACK).success).toBe(true);
    expect(FixtureOriginSchema.safeParse(`${LOOPBACK}/`).success).toBe(false);
    expect(FixtureOriginSchema.safeParse(`${LOOPBACK}/path`).success).toBe(false);
    expect(FixtureOriginSchema.safeParse('https://example.com').success).toBe(true);
  });
});

// N4: records with every URL field filled in.
const fullBusiness = () => ({
  name: 'Example Plumbing',
  googleBusinessUrl: 'https://g.page/example',
  socialLinks: [{ network: 'facebook', url: 'https://facebook.com/example' }],
  locations: [
    { label: 'Main', address: '1 Main St', googleBusinessUrl: 'https://g.page/example-main' },
  ],
  trust: {
    licenses: [],
    ratings: [],
    credentials: [{ kind: 'badge' as const, name: 'Verified', url: 'https://example.com/verify' }],
  },
});
const fullFacts = () => ({
  ...minimalPageFacts(),
  links: [
    {
      href: '/contact',
      resolved: 'https://example.com/contact',
      text: 'Contact',
      selector: 'nav a',
      region: 'nav' as const,
      box: { x: 0, y: 0, w: 10, h: 10 },
      isToggle: false,
    },
  ],
  iframes: [
    {
      src: 'https://maps.example.com/embed?x=1',
      srcOrigin: 'https://maps.example.com',
      box: { x: 0, y: 0, w: 100, h: 100 },
    },
  ],
  images: [
    {
      src: 'https://example.com/a.png',
      natural: { w: 10, h: 10 },
      rendered: { w: 10, h: 10 },
      alt: '',
      selector: 'img',
    },
  ],
});
const fullPage = () => ({
  ...minimalCapturedPage(),
  redirectChain: ['http://example.com/', 'https://example.com/'],
  facts: { mobile: fullFacts(), desktop: fullFacts() },
});
const fullSite = () => ({ ...minimalSite(), business: fullBusiness() });
const fullRun = () => ({
  ...minimalAuditRun(),
  lighthouse: [...minimalAuditRun().lighthouse],
});

const cases = [
  ['Consent', ConsentSchema, FixtureConsentSchema, minimalConsent()],
  ['ConsentScope', ConsentScopeSchema, FixtureConsentScopeSchema, minimalConsent().scope],
  ['Project', ProjectSchema, FixtureProjectSchema, minimalProject()],
  ['Version', VersionSchema, FixtureVersionSchema, minimalVersion()],
  ['Site', SiteSchema, FixtureSiteSchema, minimalSite()],
  ['Site (all URL fields)', SiteSchema, FixtureSiteSchema, fullSite()],
  ['Business (all URL fields)', BusinessSchema, FixtureBusinessSchema, fullBusiness()],
  ['Asset', AssetSchema, FixtureAssetSchema, minimalAsset()],
  ['CaptureRun', CaptureRunSchema, FixtureCaptureRunSchema, minimalCaptureRun()],
  ['PageFacts (all URL fields)', PageFactsSchema, FixturePageFactsSchema, fullFacts()],
  ['CapturedPage', CapturedPageSchema, FixtureCapturedPageSchema, minimalCapturedPage()],
  ['CapturedPage (all URL fields)', CapturedPageSchema, FixtureCapturedPageSchema, fullPage()],
  ['AuditRun', AuditRunSchema, FixtureAuditRunSchema, fullRun()],
  ['Evidence', EvidenceSchema, FixtureEvidenceSchema, minimalAuditRun().checks[0]!.evidence[0]!],
  ['CheckResult', CheckResultSchema, FixtureCheckResultSchema, minimalAuditRun().checks[0]!],
  [
    'LighthouseSummary',
    LighthouseSummarySchema,
    FixtureLighthouseSummarySchema,
    minimalAuditRun().lighthouse[0]!,
  ],
  ['ReportFinding', ReportFindingSchema, FixtureReportFindingSchema, minimalReportDoc().fixNow[0]!],
  ['ReportDoc', ReportDocSchema, FixtureReportDocSchema, minimalReportDoc()],
  ['ReportVersion', ReportVersionSchema, FixtureReportVersionSchema, minimalReportVersion()],
] as const;

describe.each(cases)('%s: strict vs fixture variant', (_name, strict, fixture, record) => {
  const loopRecord = loopbackify(record);

  it('both accept the ordinary record, with identical output', () => {
    const a = strict.safeParse(record);
    const b = fixture.safeParse(record);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(b.data).toEqual(a.data);
  });

  it('only the fixture variant accepts the loopback version of the record', () => {
    expect(JSON.stringify(loopRecord)).toContain(LOOPBACK);
    expect(strict.safeParse(loopRecord).success).toBe(false);
    expect(fixture.safeParse(loopRecord).success).toBe(true);
  });
});

describe('every URL field is covered (N4)', () => {
  const loopFields = (record: unknown) => JSON.stringify(loopbackify(record));
  const expectFields = (record: unknown, fields: string[]) => {
    const json = loopFields(record);
    for (const f of fields)
      expect(json, f).toMatch(new RegExp(`"${f}":\\[?"http://127\\.0\\.0\\.1:3000`));
  };
  it.each([
    ['Business', fullBusiness(), ['url', 'googleBusinessUrl']],
    ['PageFacts', fullFacts(), ['resolved', 'src', 'srcOrigin']],
    ['CapturedPage', fullPage(), ['url', 'finalUrl', 'redirectChain']],
    ['AuditRun', minimalAuditRun(), ['pageUrl']],
    ['CaptureRun', minimalCaptureRun(), ['startUrl', 'planned']],
    ['Site', fullSite(), ['sourceUrl']],
    ['Asset', minimalAsset(), ['sourceUrl']],
    ['Project', minimalProject(), ['siteUrl']],
    ['ConsentScope', minimalConsent().scope, ['origin']],
    ['ReportDoc', minimalReportDoc(), ['siteUrl', 'pageUrl']],
  ] as const)('%s has loopback values in %j', (_n, record, fields) => {
    expectFields(record, [...fields]);
  });
  it('Location.googleBusinessUrl and Credential.url are both inside the Business case', () => {
    const biz = fullBusiness();
    expect(biz.locations[0]!.googleBusinessUrl).toBeDefined();
    expect(biz.trust.credentials[0]!.url).toBeDefined();
    expect(FixtureBusinessSchema.safeParse(loopbackify(biz)).success).toBe(true);
    expect(BusinessSchema.safeParse(loopbackify(biz)).success).toBe(false);
  });
});

describe('cross-field rules are shared, not copied', () => {
  it('the fixture AuditRun still enforces score reproducibility', () => {
    const run = loopbackify(minimalAuditRun());
    const bad = { ...run, scores: { ...run.scores, speed: { ...run.scores.speed, value: 1 } } };
    expect(FixtureAuditRunSchema.safeParse(bad).success).toBe(false);
  });
  it('the fixture Project still rejects a missing-slash pathPrefix', () => {
    const p = loopbackify(minimalProject());
    const bad = {
      ...p,
      consent: { ...minimalConsent(), scope: { origin: LOOPBACK, pathPrefix: 'x', maxPages: 5 } },
    };
    expect(FixtureProjectSchema.safeParse(bad).success).toBe(false);
  });
  it('the fixture Version still requires snapshot.variant.id to equal variantId', () => {
    const v = loopbackify(minimalVersion());
    const bad = { ...v, variantId: 'other' };
    expect(FixtureVersionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('factories are memoized', () => {
  it('the PageFacts inside CapturedPageSchema is the exported PageFactsSchema', () => {
    const facts = CapturedPageSchema.shape.facts.shape.mobile;
    expect(facts).toBe(PageFactsSchema);
    expect(FixtureCapturedPageSchema.shape.facts.shape.mobile).toBe(FixturePageFactsSchema);
  });
  it('Business inside Site is the exported Business', () => {
    expect(SiteObjectSchema.shape.business).toBe(BusinessSchema);
  });
});

describe('inferred types are identical for strict and fixture variants', () => {
  it('compiles only if every Fixture* output and input type equals its strict type', () => {
    expectTypeOf<z.infer<typeof FixtureConsentSchema>>().toEqualTypeOf<
      z.infer<typeof ConsentSchema>
    >();
    expectTypeOf<z.input<typeof FixtureConsentSchema>>().toEqualTypeOf<
      z.input<typeof ConsentSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureConsentScopeSchema>>().toEqualTypeOf<
      z.infer<typeof ConsentScopeSchema>
    >();
    expectTypeOf<z.input<typeof FixtureConsentScopeSchema>>().toEqualTypeOf<
      z.input<typeof ConsentScopeSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureProjectSchema>>().toEqualTypeOf<
      z.infer<typeof ProjectSchema>
    >();
    expectTypeOf<z.input<typeof FixtureProjectSchema>>().toEqualTypeOf<
      z.input<typeof ProjectSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureVersionSchema>>().toEqualTypeOf<
      z.infer<typeof VersionSchema>
    >();
    expectTypeOf<z.input<typeof FixtureVersionSchema>>().toEqualTypeOf<
      z.input<typeof VersionSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureSiteSchema>>().toEqualTypeOf<z.infer<typeof SiteSchema>>();
    expectTypeOf<z.input<typeof FixtureSiteSchema>>().toEqualTypeOf<z.input<typeof SiteSchema>>();
    expectTypeOf<z.infer<typeof FixtureBusinessSchema>>().toEqualTypeOf<
      z.infer<typeof BusinessSchema>
    >();
    expectTypeOf<z.input<typeof FixtureBusinessSchema>>().toEqualTypeOf<
      z.input<typeof BusinessSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureAssetSchema>>().toEqualTypeOf<z.infer<typeof AssetSchema>>();
    expectTypeOf<z.input<typeof FixtureAssetSchema>>().toEqualTypeOf<z.input<typeof AssetSchema>>();
    expectTypeOf<z.infer<typeof FixtureCaptureRunSchema>>().toEqualTypeOf<
      z.infer<typeof CaptureRunSchema>
    >();
    expectTypeOf<z.input<typeof FixtureCaptureRunSchema>>().toEqualTypeOf<
      z.input<typeof CaptureRunSchema>
    >();
    expectTypeOf<z.infer<typeof FixturePageFactsSchema>>().toEqualTypeOf<
      z.infer<typeof PageFactsSchema>
    >();
    expectTypeOf<z.input<typeof FixturePageFactsSchema>>().toEqualTypeOf<
      z.input<typeof PageFactsSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureCapturedPageSchema>>().toEqualTypeOf<
      z.infer<typeof CapturedPageSchema>
    >();
    expectTypeOf<z.input<typeof FixtureCapturedPageSchema>>().toEqualTypeOf<
      z.input<typeof CapturedPageSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureEvidenceSchema>>().toEqualTypeOf<
      z.infer<typeof EvidenceSchema>
    >();
    expectTypeOf<z.input<typeof FixtureEvidenceSchema>>().toEqualTypeOf<
      z.input<typeof EvidenceSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureLighthouseSummarySchema>>().toEqualTypeOf<
      z.infer<typeof LighthouseSummarySchema>
    >();
    expectTypeOf<z.input<typeof FixtureLighthouseSummarySchema>>().toEqualTypeOf<
      z.input<typeof LighthouseSummarySchema>
    >();
    expectTypeOf<z.infer<typeof FixtureAuditRunSchema>>().toEqualTypeOf<
      z.infer<typeof AuditRunSchema>
    >();
    expectTypeOf<z.input<typeof FixtureAuditRunSchema>>().toEqualTypeOf<
      z.input<typeof AuditRunSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureCheckResultSchema>>().toEqualTypeOf<
      z.infer<typeof CheckResultSchema>
    >();
    expectTypeOf<z.input<typeof FixtureCheckResultSchema>>().toEqualTypeOf<
      z.input<typeof CheckResultSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureReportFindingSchema>>().toEqualTypeOf<
      z.infer<typeof ReportFindingSchema>
    >();
    expectTypeOf<z.input<typeof FixtureReportFindingSchema>>().toEqualTypeOf<
      z.input<typeof ReportFindingSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureReportDocSchema>>().toEqualTypeOf<
      z.infer<typeof ReportDocSchema>
    >();
    expectTypeOf<z.input<typeof FixtureReportDocSchema>>().toEqualTypeOf<
      z.input<typeof ReportDocSchema>
    >();
    expectTypeOf<z.infer<typeof FixtureReportVersionSchema>>().toEqualTypeOf<
      z.infer<typeof ReportVersionSchema>
    >();
    expectTypeOf<z.input<typeof FixtureReportVersionSchema>>().toEqualTypeOf<
      z.input<typeof ReportVersionSchema>
    >();
    expect(true).toBe(true);
  });
});
