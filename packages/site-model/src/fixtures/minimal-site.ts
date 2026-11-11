/**
 * Reusable valid fixtures for tests (T3, T5, T9). Each function returns a fresh object,
 * so tests can mutate the result without affecting each other.
 */
import type {
  Asset,
  AuditReport,
  AuditRun,
  CaptureRun,
  CapturedPage,
  Comment,
  Consent,
  DesignTokens,
  PageFacts,
  Project,
  ReportDelivery,
  ReportDoc,
  ReportExport,
  ReportVersion,
  Section,
  ShareLink,
  Site,
  Variant,
  Version,
} from '../schemas';

export function minimalConsent(): Consent {
  return {
    grantedBy: 'Pat Owner',
    grantedAt: '2026-11-01T12:00:00.000Z',
    method: 'email',
    scope: { origin: 'https://example-plumbing.com', maxPages: 25 },
  };
}

export function minimalProject(): Project {
  return {
    id: 'proj_1',
    clientName: 'Example Plumbing',
    siteUrl: 'https://example-plumbing.com/',
    consent: minimalConsent(),
    createdAt: '2026-11-01T12:00:00.000Z',
  };
}

export function minimalSection(): Section {
  return {
    id: 'sec_hero',
    type: 'hero',
    content: {
      heading: 'Fast, friendly plumbing',
      ctas: [{ label: 'Call us', href: 'tel:+15555550100', kind: 'call' }],
    },
    confidence: 0.9,
  };
}

export function minimalSite(): Site {
  return {
    id: 'site_1',
    projectId: 'proj_1',
    schemaVersion: 3,
    sourceUrl: 'https://example-plumbing.com/',
    platform: 'unknown',
    platformEvidence: [],
    platformConfidence: 0,
    business: { name: 'Example Plumbing', socialLinks: [] },
    brand: { extractedColors: [], extractedFonts: [] },
    pages: [{ path: '/', title: 'Example Plumbing', sections: [minimalSection()] }],
  };
}

export function minimalAsset(): Asset {
  return {
    id: 'asset_logo',
    siteId: 'site_1',
    kind: 'logo',
    sourceUrl: 'https://example-plumbing.com/logo.png',
  };
}

export function minimalTokens(): DesignTokens {
  return {
    color: {
      primary: '#1d4ed8',
      secondary: '#0f766e',
      accent: '#b45309',
      background: '#ffffff',
      surface: '#f8fafc',
      text: '#111827',
      mutedText: '#4b5563',
    },
    font: {
      heading: { family: 'Inter', weights: [600, 700] },
      body: { family: 'Inter', weights: [400] },
    },
    typeScale: { base: 16, ratio: 1.25 },
    spacing: { unit: 4 },
    radius: 'md',
  };
}

export function minimalVariant(): Variant {
  return {
    id: 'var_1',
    siteId: 'site_1',
    name: 'Conservative',
    style: 'conservative',
    tokens: minimalTokens(),
    templates: { sec_hero: 'hero-split' },
    status: 'draft',
  };
}

export function minimalVersion(): Version {
  return {
    id: 'ver_1',
    variantId: 'var_1',
    number: 1,
    snapshot: { site: minimalSite(), variant: minimalVariant() },
    createdBy: 'consultant',
    createdAt: '2026-11-09T12:00:00.000Z',
    note: '',
  };
}

export function minimalComment(): Comment {
  return {
    id: 'cmt_1',
    versionId: 'ver_1',
    author: 'client',
    body: 'Can the phone number be bigger?',
    resolved: false,
    createdAt: '2026-11-09T12:30:00.000Z',
  };
}

export function minimalPageFacts(): PageFacts {
  return {
    viewport: { width: 390, height: 844 },
    documentWidth: 390,
    hasViewportMeta: true,
    protocol: 'https',
    title: 'Example Plumbing',
    headings: [{ level: 1, text: 'Plumbing you can trust', selector: 'main > h1' }],
    links: [],
    phoneTexts: [],
    emails: [],
    hoursBlocks: [],
    jsonLd: [],
    iframes: [],
    forms: [],
    images: [],
    fonts: [{ raw: '"Open Sans", sans-serif', family: 'Open Sans', share: 1 }],
    colors: [{ hex: '#1a2b3c', kind: 'text', share: 1 }],
    interactive: [],
    footerText: '',
    copyrightYears: [],
    platformSignals: { bodyClasses: [], assetUrls: [], headers: {}, footerText: '' },
  };
}

export function minimalCaptureRun(): CaptureRun {
  return {
    id: 'crawl_1',
    projectId: 'proj_1',
    startUrl: 'https://example-plumbing.com/',
    status: 'done',
    userAgent: 'SiteRefreshStudioBot/1.0',
    robots: { fetchedAt: '2026-11-09T12:00:00.000Z', status: 'ok' },
    planned: ['https://example-plumbing.com/', 'https://example-plumbing.com/contact'],
    skipped: [],
    startedAt: '2026-11-09T12:00:00.000Z',
    finishedAt: '2026-11-09T12:01:00.000Z',
  };
}

export function minimalCapturedPage(): CapturedPage {
  return {
    id: 'cp_1',
    captureRunId: 'crawl_1',
    url: 'https://example-plumbing.com/',
    finalUrl: 'https://example-plumbing.com/',
    redirectChain: [],
    httpStatus: 200,
    fetchedAt: '2026-11-09T12:00:10.000Z',
    htmlAssetId: 'asset_html_1',
    screenshots: { mobile: 'asset_shot_m1', desktop: 'asset_shot_d1' },
    facts: {
      mobile: minimalPageFacts(),
      desktop: {
        ...minimalPageFacts(),
        viewport: { width: 1440, height: 900 },
        documentWidth: 1440,
      },
    },
    pendingContent: [],
  };
}

/** Fingerprint of the failed `tap-to-call` finding in `minimalAuditRun`. */
export const MINIMAL_FINDING_ID = 'tap-to-call:3f9a1c2e';

/**
 * A run with one failed check (the phone number isn't tappable) and one passed check. Its scores
 * follow `recomputeScores`: `minimalAuditRun().scores` equals `recomputeScores(run, [])`.
 */
export function minimalAuditRun(): AuditRun {
  return {
    id: 'audit_1',
    projectId: 'proj_1',
    siteId: 'site_1',
    captureRunId: 'crawl_1',
    createdAt: '2026-11-09T13:00:00.000Z',
    toolVersions: { lighthouse: '12.8.2', axe: '4.10.2', audit: '0.0.0' },
    lighthouse: [
      {
        pageUrl: 'https://example-plumbing.com/',
        preset: 'mobile',
        performance: 0.93,
        accessibility: 0.98,
        bestPractices: 1,
        seo: 0.9,
        lcpMs: 2100,
        tbtMs: 120,
        cls: 0.02,
        lhrAssetId: 'asset_lhr_1',
      },
    ],
    checks: [
      {
        id: 'tap-to-call',
        findingId: MINIMAL_FINDING_ID,
        passed: false,
        severity: 'high',
        pageUrl: 'https://example-plumbing.com/',
        evidence: [
          {
            kind: 'element',
            pageUrl: 'https://example-plumbing.com/',
            selector: 'header .phone',
            box: { x: 20, y: 12, w: 160, h: 24 },
            viewport: 'mobile',
            value: '(555) 010-0199',
          },
        ],
        plainEnglish: "Your phone number isn't tappable on phones.",
      },
      {
        id: 'https',
        findingId: 'https:7d41b0aa',
        passed: true,
        severity: 'high',
        evidence: [{ kind: 'page', pageUrl: 'https://example-plumbing.com/', value: 'https' }],
        plainEnglish: 'Your site loads securely.',
      },
    ],
    scores: {
      looksCurrent: { value: 100, contributions: [] },
      worksOnPhones: { value: 100, contributions: [] },
      easyToContact: { value: 75, contributions: [{ source: 'tap-to-call', delta: -25 }] },
      speed: { value: 93, contributions: [{ source: 'lighthouse:performance', delta: -7 }] },
      accessibility: { value: 100, contributions: [] },
    },
    weightsVersion: '2026-11-09',
  };
}

/** A draft report for `minimalAuditRun` with the one failure listed under "fix now". */
export function minimalReportDoc(): ReportDoc {
  return {
    businessName: 'Example Plumbing',
    siteUrl: 'https://example-plumbing.com/',
    auditedAt: '2026-11-09T13:00:00.000Z',
    scores: minimalAuditRun().scores,
    summary: 'Your site looks fine, but customers on phones cannot tap to call you.',
    whatsWorking: ['Your site loads securely.'],
    fixNow: [
      {
        findingId: MINIMAL_FINDING_ID,
        sentence: "Your phone number isn't tappable on phones.",
        whyItMatters: 'Most people look you up on their phone and expect to call with one tap.',
        pageUrl: 'https://example-plumbing.com/',
        annotationAssetIds: ['asset_crop_1'],
      },
    ],
    canWait: [],
    dismissed: [],
    draftSource: 'template',
  };
}

export function minimalAuditReport(): AuditReport {
  return {
    id: 'report_1',
    projectId: 'proj_1',
    auditRunId: 'audit_1',
    createdAt: '2026-11-09T13:05:00.000Z',
  };
}

export function minimalReportVersion(): ReportVersion {
  return {
    id: 'rver_1',
    reportId: 'report_1',
    number: 1,
    doc: minimalReportDoc(),
    createdBy: 'consultant',
    createdAt: '2026-11-09T13:05:00.000Z',
    note: '',
  };
}

/** A hash standing in for sha256(token); the fixture never holds a raw token. */
const FIXTURE_SHA256 = 'a'.repeat(64);

export function minimalShareLink(): ShareLink {
  return {
    id: 'share_1',
    reportId: 'report_1',
    tokenHash: FIXTURE_SHA256,
    createdAt: '2026-11-09T14:00:00.000Z',
    expiresAt: '2026-12-09T14:00:00.000Z',
  };
}

export function minimalReportExport(): ReportExport {
  return {
    id: 'export_1',
    reportVersionId: 'rver_1',
    kind: 'pdf',
    storagePath: 'reports/proj_1/report_1-v1.pdf',
    sha256: 'b'.repeat(64),
    createdAt: '2026-11-09T14:10:00.000Z',
  };
}

export function minimalReportDelivery(): ReportDelivery {
  return {
    id: 'delivery_1',
    reportVersionId: 'rver_1',
    channel: 'email-pdf',
    recipientName: 'Example Recipient',
    sentAt: '2026-11-09T15:00:00.000Z',
  };
}
