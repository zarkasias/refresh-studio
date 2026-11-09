import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, tokens } from './tokens';

const css = readFileSync(fileURLToPath(new URL('../theme.css', import.meta.url)), 'utf8');
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('studio contrast', () => {
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  for (const p of tokens.textPairs) {
    it(`${p.name} reaches AA 4.5:1 (or is marked not allowed for text)`, () => {
      const ratio = contrastRatio(tokens.colors[p.fg], tokens.colors[p.bg]);
      if (p.allowedForText) expect(ratio).toBeGreaterThanOrEqual(4.5);
      else expect(ratio).toBeLessThan(4.5);
    });
  }

  for (const p of tokens.uiPairs) {
    it(`${p.name} reaches 3:1 for non-text UI`, () => {
      expect(contrastRatio(tokens.colors[p.fg], tokens.colors[p.bg])).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('theme.css matches tokens.ts', () => {
  for (const [name, hex] of Object.entries(tokens.colors)) {
    it(`--color-studio-${kebab(name)}`, () => {
      expect(css).toContain(`--color-studio-${kebab(name)}: ${hex};`);
    });
  }
  it('radius', () => {
    expect(css).toContain(`--radius-studio: ${tokens.radius};`);
  });
  it('prefixes every variable with studio', () => {
    const names = [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toMatch(/^--(color|radius|font)-studio(-|$)/);
  });
  it('has exactly the same color set in both files', () => {
    const inCss = [...css.matchAll(/--color-studio-([\w-]+)\s*:/g)].map((m) => m[1] as string).sort();
    const inTokens = Object.keys(tokens.colors).map(kebab).sort();
    expect(inCss).toEqual(inTokens);
  });
  it('font variables reference the tokens and layout.tsx', () => {
    const layout = readFileSync(fileURLToPath(new URL('../../../apps/web/app/layout.tsx', import.meta.url)), 'utf8');
    for (const [key, f] of [['sans', tokens.fonts.sans], ['heading', tokens.fonts.heading]] as const) {
      expect(css).toContain(`--font-studio-${key}: var(${f.cssVariable}),`);
      expect(layout).toContain(`variable: '${f.cssVariable}'`);
    }
  });
});

describe('input border usage', () => {
  it('is only for white backgrounds', () => {
    expect(contrastRatio(tokens.colors.input, tokens.colors.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.colors.input, tokens.colors.surface)).toBeLessThan(3);
    expect(tokens.usage.input).toMatch(/white/);
    expect(readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')).toMatch(/white/i);
  });
});

describe('logo', () => {
  it('has meaningful alt text when alone', () => {
    expect(tokens.logo.alt).toBe('Chambers Consulting');
    expect(tokens.logo.altWhenWithVisibleName).toBe('');
  });
});
