/**
 * Reusable valid fixtures for tests (T3, T5, T9). Each function returns a fresh object,
 * so tests can mutate the result without affecting each other.
 */
import type {
  Asset,
  Comment,
  Consent,
  DesignTokens,
  Project,
  Section,
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
    schemaVersion: 1,
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
