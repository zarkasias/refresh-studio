/**
 * Studio brand tokens (Chambers Consulting). Values come from the
 * chambers-consulting.dev source (app/globals.css, app/layout.tsx), light theme.
 *
 * STUDIO UI ONLY. Never import from packages/sections, exporters or client previews.
 */
export const tokens = {
  colors: {
    background: '#ffffff',
    foreground: '#16324b',
    primary: '#0b6d8e',
    primaryForeground: '#ffffff',
    surface: '#eff8fa',
    mutedForeground: '#475a6b',
    cta: '#c5202e',
    ctaForeground: '#ffffff',
    border: '#d2e2e9',
    input: '#7e96a5',
    ring: '#0b6d8e',
    destructive: '#b30015',
  },
  radius: '0.375rem',
  fonts: {
    sans: { family: 'Inter', cssVariable: '--font-inter', subsets: ['latin'], display: 'swap' },
    heading: {
      family: 'DM Sans',
      cssVariable: '--font-dm-sans',
      subsets: ['latin'],
      display: 'swap',
      weight: 'medium',
      tracking: 'tight',
    },
  },
  logo: {
    src: 'cclogo-new.png',
    width: 170,
    height: 168,
    alt: 'Chambers Consulting',
    usage:
      'Beside the visible "Chambers Consulting" text in the same link, render with alt="" (the name would be announced twice). When the logo appears alone, use alt="Chambers Consulting". Site uses it at 40x40 in a rounded-full chip (gray-300 at 80%, 4px padding).',
    altWhenWithVisibleName: '',
  },
  usage: {
    input: 'Input borders are for white (background) surfaces only: on the surface tint they fall below 3:1.',
    cta: 'Reserved for the primary call to action only. Colors come from the logo, with red reserved for calls to action.',
  },
  /** Text/background pairs the studio uses. Each must reach AA (4.5:1) for normal text. */
  textPairs: [
    { name: 'foreground on background', fg: 'foreground', bg: 'background', allowedForText: true },
    { name: 'foreground on surface', fg: 'foreground', bg: 'surface', allowedForText: true },
    { name: 'muted-foreground on background', fg: 'mutedForeground', bg: 'background', allowedForText: true },
    { name: 'muted-foreground on surface', fg: 'mutedForeground', bg: 'surface', allowedForText: true },
    { name: 'primary on background (links)', fg: 'primary', bg: 'background', allowedForText: true },
    { name: 'primary on surface', fg: 'primary', bg: 'surface', allowedForText: true },
    { name: 'primary-foreground on primary', fg: 'primaryForeground', bg: 'primary', allowedForText: true },
    { name: 'cta-foreground on cta', fg: 'ctaForeground', bg: 'cta', allowedForText: true },
    { name: 'white on destructive', fg: 'background', bg: 'destructive', allowedForText: true },
    { name: 'border on background (decorative only)', fg: 'border', bg: 'background', allowedForText: false },
  ],
  /** Non-text UI pairs, 3:1 minimum. */
  uiPairs: [
    { name: 'ring on background', fg: 'ring', bg: 'background' },
    { name: 'input border on background', fg: 'input', bg: 'background' },
  ],
} as const;

export type BrandTokens = typeof tokens;
export type ColorToken = keyof BrandTokens['colors'];

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Expected a 6-digit hex color, got "${hex}"`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
