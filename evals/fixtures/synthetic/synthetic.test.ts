/**
 * M1 T6a acceptance, static half: the three synthetic sites build reproducibly, carry no
 * identity from their labels, request nothing outside the fixture origin (static check), and
 * hold their patterns. The browser half (lockdown, rendered DOM) is `eval-capture.test.ts`.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SiteSchema } from '@srs/site-model';
import { afterAll, describe, expect, it } from 'vitest';
import { extraIdentityFor, findLabelLeaks } from '../anonymize';
import { RECIPES, recipeFor } from '../recipes';
import { loadManifest } from '../../src/load-manifest';
import { buildSyntheticSite, FIXTURE_SEED, SYNTHETIC_SITES_DIR } from './build';
import { decodeCfEmail, encodeCfEmail } from './cfemail';
import { ExpectedCaptureSchema, type ExpectedCapture } from './expected-capture';
import { anonymizedLabel, loadRawLabel, renderSlug } from './generate';
import { findFileLeaks } from './leak-scan';
import { renderSyntheticSite } from './render';

const SLUGS = RECIPES.map((r) => r.slug);
const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function readTree(dir: string, rel = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) for (const [k, v] of await readTree(dir, next)) out.set(k, v);
    else out.set(next.split(path.sep).join('/'), await readFile(path.join(dir, next), 'utf8'));
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

const capture = (files: Map<string, string>): ExpectedCapture =>
  ExpectedCaptureSchema.parse(JSON.parse(files.get('expected.capture.json') ?? 'null'));

describe.each(SLUGS)('%s', (slug) => {
  const files = renderSlug(slug);

  it('builds the same bytes for the same seed, and different bytes for another seed', async () => {
    const a = await mkdtemp(path.join(os.tmpdir(), 'srs-synth-a-'));
    const b = await mkdtemp(path.join(os.tmpdir(), 'srs-synth-b-'));
    tmpDirs.push(a, b);
    await buildSyntheticSite(anonymizedLabel(slug), recipeFor(slug), { outDir: a });
    await buildSyntheticSite(anonymizedLabel(slug), recipeFor(slug), { outDir: b });
    const [ta, tb] = await Promise.all([readTree(a), readTree(b)]);
    expect([...ta]).toEqual([...tb]);
    expect([...ta]).toEqual([...files]);

    const other = renderSlug(slug, `${FIXTURE_SEED}-other`);
    expect(other.get('index.html')).not.toBe(files.get('index.html'));
  });

  it('matches the committed files in evals/fixtures/sites (run `pnpm fixtures:build` to refresh)', async () => {
    const committed = await readTree(path.join(SYNTHETIC_SITES_DIR, slug));
    expect([...committed.keys()]).toEqual([...files.keys()]);
    for (const [file, text] of files) expect(committed.get(file), file).toBe(text);
  });

  it('writes a valid anonymized label and a valid expected.capture.json', () => {
    const label = SiteSchema.parse(JSON.parse(files.get('expected.site.json') ?? 'null'));
    expect(label).toEqual(anonymizedLabel(slug));
    const cap = capture(files);
    expect(cap.pages.map((p) => p.path)).toEqual(label.pages.map((p) => p.path));
    for (const page of cap.pages) expect(files.has(page.file), page.file).toBe(true);
  });

  it('keeps no original identity in any file, in any encoding (generated and committed)', async () => {
    const raw = loadRawLabel(slug);
    const extra = extraIdentityFor(slug);
    expect(findFileLeaks(raw, files, extra)).toEqual([]);
    const committed = await readTree(path.join(SYNTHETIC_SITES_DIR, slug));
    expect(findFileLeaks(raw, committed, extra)).toEqual([]);
    // The label itself passes the T5 check too, so the pages cannot have taken it from there.
    expect(findLabelLeaks(raw, anonymizedLabel(slug), { extraIdentity: extra })).toEqual([]);
  });

  it('requests only same-origin files or the recipe platform hosts (static check)', () => {
    const hosts = new Set(recipeFor(slug).platformHosts);
    for (const [file, text] of files) {
      if (/\.json$/.test(file)) continue;
      // Anything that loads: src, link href, poster, srcset, css url(), @import, fetch and co.
      const loads: string[] = [];
      for (const m of text.matchAll(/\b(?:src|poster|data|action|srcset)="([^"]*)"/g))
        loads.push(m[1] ?? '');
      for (const m of text.matchAll(/<link\b[^>]*\bhref="([^"]*)"/g)) loads.push(m[1] ?? '');
      for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/g)) loads.push(m[1] ?? '');
      for (const m of text.matchAll(/@import\s+['"]?([^'";)]+)/g)) loads.push(m[1] ?? '');
      for (const url of loads) {
        if ((url.startsWith('/') && !url.startsWith('//')) || url === '#') continue;
        const host = /^https:\/\/([^/]+)\//.exec(url)?.[1];
        expect(host !== undefined && hosts.has(host), `${file}: ${url}`).toBe(true);
      }
      expect(text, file).not.toMatch(/<(?:iframe|embed|object)\b/i);
      expect(text, file).not.toMatch(
        /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b|\bimport\s*\(/,
      );
      expect(text, file).not.toMatch(/(?:src|href)=["']\/\//);
    }
  });

  it('every platform-host URL a page uses has a local file to serve', () => {
    for (const [file, text] of files) {
      for (const m of text.matchAll(/https:\/\/([a-z0-9.-]+)\/([^"')\s]+)/g)) {
        const [, host = '', rest = ''] = m;
        if (!recipeFor(slug).platformHosts.includes(host)) continue;
        expect(files.has(`platform-assets/${host}/${rest}`), `${file}: ${m[0]}`).toBe(true);
      }
    }
  });

  it('lists every manifest asset-url evidence signal as a marker in the pages', () => {
    const entry = loadManifest().sites.find((s) => s.slug === slug);
    const cap = capture(files);
    expect(cap.platform.evidence).toEqual(entry?.evidence);
    for (const e of entry?.evidence ?? []) {
      if (e.where !== 'asset-url') continue;
      expect(
        cap.platform.markers.some((m) => m.where === 'asset-url' && m.value.includes(e.signal)),
        e.signal,
      ).toBe(true);
    }
  });
});

describe('casper-plumbing patterns', () => {
  const files = renderSlug('casper-plumbing');
  const cap = capture(files);
  const html = [...files]
    .filter(([f]) => f.endsWith('.html'))
    .map(([, t]) => t)
    .join('\n');

  it('uses Wix internal font names in computed styles, real families in the label', () => {
    const css = files.get('assets/site.css') ?? '';
    const label = anonymizedLabel('casper-plumbing');
    expect(label.brand.extractedFonts.map((f) => f.family)).toContain('Futura');
    const futura = cap.fonts.find((f) => f.family === 'Futura');
    expect(futura?.computed).toMatch(/^futura-lt-w01-.*\d{5,}$/);
    expect(css).toContain(futura?.computed ?? 'missing');
    expect(css).not.toMatch(/font-family:[^;]*\bFutura\b/);
  });

  it('shows plain-text phones where the label says "(not linked)", without the note', () => {
    expect(cap.plainTextPhones.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('not linked');
    for (const p of cap.plainTextPhones) {
      expect(html).toContain(p.display);
      // No tel: link carries this number.
      const digits = p.display.replace(/\D/g, '');
      expect(html).not.toMatch(new RegExp(`href="tel:[^"]*${digits}`));
    }
  });

  it('has a link whose displayed number differs from its tel: href', () => {
    expect(cap.hrefMismatches).toHaveLength(1);
    const [m] = cap.hrefMismatches;
    expect(m?.href).toMatch(/^tel:\d+$/);
    expect(html).toContain(`href="${m?.href}">${m?.label}</a>`);
  });
});

describe('iphci patterns', () => {
  const files = renderSlug('iphci');
  const cap = capture(files);
  const home = files.get('index.html') ?? '';
  const label = anonymizedLabel('iphci');

  it('duplicates the three service blocks as .slick-cloned, aria-hidden, without ids', () => {
    const clones = [...home.matchAll(/<div class="slick-slide slick-cloned"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(clones).toHaveLength(6);
    for (const tag of clones) expect(tag).toContain('aria-hidden="true"');
    expect(cap.hiddenCopies).toHaveLength(6);
    const services = label.pages[0]?.sections.filter((s) => s.type === 'services') ?? [];
    expect(new Set(cap.hiddenCopies.map((h) => h.copyOf))).toEqual(
      new Set(services.map((s) => s.id)),
    );
    for (const s of services) expect(home.split(`id="${s.id}"`).length - 1).toBe(1);
  });

  it('hides emails behind data-cfemail; the decoded value is the anonymized email', () => {
    const emails = label.business.emails?.map((e) => e.value) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(home).not.toContain(email);
      expect(home).toContain(`data-cfemail="${encodeCfEmail(email)}"`);
      expect(decodeCfEmail(encodeCfEmail(email))).toBe(email);
    }
    expect(home).toContain('[email&#160;protected]');
    expect(cap.emails.every((e) => e.obfuscation === 'cloudflare')).toBe(true);
    expect(cap.mustNotRecord).toContain('[email protected]');
    expect(files.has('cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js')).toBe(true);
  });

  it('has a href="#" Services toggle with a submenu', () => {
    expect(home).toMatch(/<li class="has-submenu"><a href="#">Services<\/a><ul class="sub-menu">/);
    expect(cap.navDropdowns).toHaveLength(1);
    expect(cap.navDropdowns[0]?.children.map((c) => c.title)).toEqual([
      'Plumbing',
      'Heating',
      'Cooling',
    ]);
  });
});

describe('delaware-valley-hardwoods patterns', () => {
  const files = renderSlug('delaware-valley-hardwoods');
  const cap = capture(files);

  it('shows "Loading recent projects..." until a script replaces it after 1.2 s', () => {
    expect(cap.deferredContent).toHaveLength(1);
    const [d] = cap.deferredContent;
    expect(d?.settleMs).toBe(1200);
    expect(files.get('index.html')).toContain(
      `<div id="instagram-feed" class="feed">Loading recent projects...</div>`,
    );
    const script = files.get('assets/feed.js') ?? '';
    expect(script).toContain('}, 1200);');
    expect(script).toContain('Project photo 1');
    // The placeholder is the only feed text in the HTML.
    expect(files.get('index.html')).not.toContain('Project photo');
  });

  it('has no platform markers (custom site)', () => {
    expect(cap.platform.markers).toEqual([]);
  });
});

describe('leak scan', () => {
  const slug = 'iphci';
  const raw = loadRawLabel(slug);
  const extra = extraIdentityFor(slug);
  const email = raw.business.emails?.[0]?.value ?? '';
  const phone = raw.business.phones?.[0]?.value ?? '';
  const name = raw.business.name;

  const scan = (file: string, text: string) => findFileLeaks(raw, new Map([[file, text]]), extra);

  it('catches the original identity in every encoding a page can use', () => {
    expect(email).toContain('@');
    const encoded = (s: string): string =>
      [...s].map((c) => `&#x${c.codePointAt(0)?.toString(16)};`).join('');
    const js = (s: string): string =>
      [...s].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    const cases: [string, string][] = [
      ['a.html', `<p>${name}</p>`],
      ['b.html', `<p>${encoded(name)}</p>`],
      ['c.html', `<a href="tel:${phone.replace(/\D/g, '')}">call</a>`],
      ['d.html', `<a href="tel:%2B1${phone.replace(/\D/g, '')}">call</a>`],
      ['e.html', `<a href="/cdn-cgi/l/email-protection#${encodeCfEmail(email)}">x</a>`],
      [
        'f.html',
        `<span class="__cf_email__" data-cfemail="${encodeCfEmail(email)}">[email&#160;protected]</span>`,
      ],
      ['g.js', `var s = "${js(name)}";`],
      ['h.json', JSON.stringify({ x: [name] })],
      ['i.html', `<p>${email.replace('@', '&#64;')}</p>`],
      [`${name.toLowerCase().replace(/[^a-z]+/g, '-')}/index.html`, '<p>fine</p>'],
      ['j.html', `<p>${extra[0] ?? ''}</p>`],
    ];
    for (const [file, text] of cases)
      expect(scan(file, text).length, `${file}: ${text}`).toBeGreaterThan(0);
  });

  it('passes clean text', () => {
    expect(scan('ok.html', '<p>Acme Plumbing Co, 555-0123, info@example.com</p>')).toEqual([]);
  });
});

describe('render is pure', () => {
  it('does not change its input', () => {
    const label = anonymizedLabel('casper-plumbing');
    const before = JSON.stringify(label);
    renderSyntheticSite(label, recipeFor('casper-plumbing'), FIXTURE_SEED);
    expect(JSON.stringify(label)).toBe(before);
  });
});
