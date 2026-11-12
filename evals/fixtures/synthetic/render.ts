/**
 * Generic renderer for synthetic sites (M1 T6a). Pure: an anonymized label and a recipe in, a
 * map of `path -> file text` out. No clock, no randomness, no I/O, so the same input always
 * gives the same bytes.
 *
 * Every section is rendered the same way from its label content; nothing here knows about a
 * particular site. Recipes (`../recipes`) add the patterns.
 *
 * Rules the output keeps (checked by `synthetic.test.ts`):
 * - only URLs on the fixture origin, or on a recipe's `platformHosts`, are ever requested;
 * - links to the site's own (fictional) domain become relative, so a crawler stays on loopback;
 * - no iframes, no web fonts, no analytics.
 */
import type { Cta, Page, Section, SectionItem, Site } from '@srs/site-model';
import { esc, PHONE_IN_TEXT, samePhone } from './html';
import type { ExpectedCapture } from './expected-capture';
import type { Expectations, PageContext, Recipe, RenderedBlock, SectionContext } from './recipe';

export const CAPTURE_FILE = 'expected.capture.json';
export const LABEL_FILE = 'expected.site.json';
export const STYLESHEET = '/assets/site.css';

const BODY_TEXT_COLOR = '#1a1a1a';

/** `/` -> `index.html`; `/contact-5` and `/contact/` -> `contact-5/index.html`. */
export function pageFile(pagePath: string): string {
  const trimmed = pagePath.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? 'index.html' : `${trimmed}/index.html`;
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** Links to the site's own domain become relative; everything else is kept byte for byte. */
export function localLink(href: string, ownHost: string | undefined): string {
  if (ownHost === undefined || !/^https?:\/\//i.test(href)) return href;
  if (hostOf(href) !== ownHost) return href;
  const url = new URL(href);
  return `${url.pathname}${url.search}${url.hash}`;
}

function cssFont(name: string): string {
  const family = /^[a-z0-9_-]+$/i.test(name) ? name : `"${name}"`;
  return name === 'system-ui' ? 'system-ui, sans-serif' : `${family}, sans-serif`;
}

interface Palette {
  primary: string;
  accent: string;
  background: string;
}

function paletteOf(label: Site): Palette {
  const pick = (role: string, fallback: string): string =>
    label.brand.extractedColors.find((c) => c.role === role)?.hex ?? fallback;
  return {
    primary: pick('primary', '#1a4d8f'),
    accent: pick('accent', '#8f3a1a'),
    background: pick('background', '#ffffff'),
  };
}

interface FontRoles {
  heading: string;
  body: string;
  nav: string;
  footer: string;
}

/** Computed font names per role, from the label's families (first four, in order). */
function fontRoles(label: Site, recipe: Recipe): { roles: FontRoles; families: string[] } {
  const families = label.brand.extractedFonts.map((f) => f.family);
  const computed = (family: string): string => recipe.fontName?.(family) ?? family;
  const at = (i: number): string | undefined => families[i];
  const heading = at(0) ?? 'system-ui';
  const body = at(1) ?? heading;
  const nav = at(2) ?? body;
  const footer = at(3) ?? body;
  return {
    families,
    roles: {
      heading: computed(heading),
      body: computed(body),
      nav: computed(nav),
      footer: computed(footer),
    },
  };
}

function stylesheet(label: Site, recipe: Recipe): string {
  const p = paletteOf(label);
  const { roles } = fontRoles(label, recipe);
  return `${[
    '*, *::before, *::after { box-sizing: border-box; }',
    `body { margin: 0; background: ${p.background}; color: ${BODY_TEXT_COLOR}; font-family: ${cssFont(roles.body)}; line-height: 1.5; }`,
    `h1, h2, h3 { font-family: ${cssFont(roles.heading)}; color: ${p.primary}; line-height: 1.2; }`,
    `a { color: ${p.primary}; }`,
    `header nav { font-family: ${cssFont(roles.nav)}; }`,
    `footer { font-family: ${cssFont(roles.footer)}; }`,
    'header, main > section, footer { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem; }',
    'nav ul { display: flex; flex-wrap: wrap; gap: 1rem; list-style: none; margin: 0; padding: 0; }',
    'nav a, .cta { display: inline-block; min-height: 44px; padding: 0.6rem 0.5rem; }',
    `.cta { border: 2px solid ${p.accent}; color: ${p.accent}; font-weight: 600; text-decoration: none; }`,
    '.ctas { display: flex; flex-wrap: wrap; gap: 0.75rem; }',
    '.items { padding-left: 1.25rem; }',
    'label { display: block; margin-bottom: 0.75rem; }',
    'input, select, textarea, button { font: inherit; min-height: 44px; }',
    ...(recipe.css ? [recipe.css().trimEnd()] : []),
  ].join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// Sections

interface RenderState {
  readonly ctx: PageContext;
  readonly recipe: Recipe;
  readonly ownHost: string | undefined;
  /** True once the first hero heading on the page became the `h1`. */
  h1Used: boolean;
}

function textOf(state: RenderState, section: Section, value: string, field: string): string {
  const sectionCtx: SectionContext = { ...state.ctx, section };
  return state.recipe.text ? state.recipe.text(value, field, sectionCtx) : value;
}

function renderCta(state: RenderState, section: Section, cta: Cta): string {
  const sectionCtx: SectionContext = { ...state.ctx, section };
  const label = textOf(state, section, cta.label, 'cta.label');
  const href = localLink(cta.href, state.ownHost);
  const { expect, page } = state.ctx;

  if (/^tel:/i.test(cta.href)) {
    const shown = label.match(PHONE_IN_TEXT)?.[0];
    if (shown !== undefined && !samePhone(shown, cta.href.slice(4))) {
      expect.hrefMismatches.push({ page: page.path, sectionId: section.id, label, href: cta.href });
    } else {
      expect.phones.push({
        display: label,
        href: cta.href,
        page: page.path,
        sectionId: section.id,
      });
    }
  }
  if (/^mailto:/i.test(cta.href)) {
    const email = decodeURIComponent(cta.href.slice(7).split('?')[0] ?? '');
    const custom = state.recipe.emailLink?.(cta, email, sectionCtx);
    expect.emails.push({
      value: email,
      obfuscation: custom === undefined ? 'none' : 'cloudflare',
      page: page.path,
      sectionId: section.id,
    });
    if (custom !== undefined) return custom;
  }
  return `<a class="cta" href="${esc(href)}">${esc(label)}</a>`;
}

function renderCtas(state: RenderState, section: Section): string {
  const ctas = section.content.ctas ?? [];
  if (ctas.length === 0) return '';
  return `<p class="ctas">${ctas.map((c) => renderCta(state, section, c)).join(' ')}</p>`;
}

function link(state: RenderState, href: string | undefined, inner: string): string {
  return href === undefined
    ? inner
    : `<a href="${esc(localLink(href, state.ownHost))}">${inner}</a>`;
}

function renderNavItem(state: RenderState, section: Section, item: SectionItem): string {
  const title = textOf(state, section, item.title ?? '', 'item.title');
  const children = [
    ...(item.children ?? []),
    ...(state.recipe.navSubmenu?.(item, { ...state.ctx, section }) ?? []),
  ];
  if (children.length === 0) return `<li>${link(state, item.link, esc(title))}</li>`;
  const sub = children
    .map(
      (c) =>
        `<li>${link(state, c.link, esc(textOf(state, section, c.title ?? '', 'item.title')))}</li>`,
    )
    .join('');
  return `<li class="has-submenu">${link(state, item.link, esc(title))}<ul class="sub-menu">${sub}</ul></li>`;
}

function renderItem(state: RenderState, section: Section, item: SectionItem): string {
  const title = item.title === undefined ? '' : textOf(state, section, item.title, 'item.title');
  const body = item.body === undefined ? '' : textOf(state, section, item.body, 'item.body');
  const heading = title === '' ? '' : `<h3>${link(state, item.link, esc(title))}</h3>`;
  const para = body === '' ? '' : `<p>${esc(body)}</p>`;
  return `<li>${heading}${para}</li>`;
}

function renderForm(state: RenderState, section: Section): string {
  const form = section.content.form;
  if (form === undefined) return '';
  const fields = form.fields.map((f, i) => {
    const label = esc(textOf(state, section, f.label, 'form.label'));
    const name = `${section.id}-f${i}`;
    const req = f.required ? ' required' : '';
    switch (f.type) {
      case 'textarea':
        return `<label>${label}<textarea name="${name}"${req}></textarea></label>`;
      case 'select': {
        const opts = (f.options ?? []).map((o) => `<option>${esc(o)}</option>`).join('');
        return `<label>${label}<select name="${name}"${req}>${opts}</select></label>`;
      }
      case 'radio':
      case 'checkbox': {
        const opts = (f.options ?? [])
          .map(
            (o) =>
              `<label><input type="${f.type}" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`,
          )
          .join('');
        return `<fieldset><legend>${label}</legend>${opts}</fieldset>`;
      }
      default: {
        const type = f.type === 'other' ? 'text' : f.type;
        return `<label>${label}<input type="${type}" name="${name}"${req}></label>`;
      }
    }
  });
  const submit = form.submitLabel
    ? `<button type="submit">${esc(textOf(state, section, form.submitLabel, 'form.submit'))}</button>`
    : '';
  return `<form action="#" method="post" onsubmit="return false">${fields.join('')}${submit}</form>`;
}

function renderSection(state: RenderState, section: Section): string {
  const { content } = section;
  const t = (value: string, field: string): string => textOf(state, section, value, field);
  const tag = section.type === 'nav' ? 'header' : section.type === 'footer' ? 'footer' : 'section';
  const out: string[] = [];

  const heading = content.heading === undefined ? '' : t(content.heading, 'heading');
  if (heading !== '') {
    const level = section.type === 'hero' && !state.h1Used ? 'h1' : 'h2';
    if (level === 'h1') state.h1Used = true;
    out.push(`<${level}>${esc(heading)}</${level}>`);
  }
  const sub = content.subheading === undefined ? '' : t(content.subheading, 'subheading');
  if (sub !== '') out.push(`<p class="sub">${esc(sub)}</p>`);
  const body = content.body === undefined ? '' : t(content.body, 'body');
  if (body !== '') out.push(`<p>${esc(body)}</p>`);
  const extra = state.recipe.extraContent?.({ ...state.ctx, section });
  if (extra) out.push(extra);

  const items = content.items ?? [];
  if (section.type === 'nav') {
    if (items.length > 0) {
      out.push(
        `<nav aria-label="Main"><ul>${items.map((i) => renderNavItem(state, section, i)).join('')}</ul></nav>`,
      );
    }
  } else if (items.length > 0) {
    out.push(`<ul class="items">${items.map((i) => renderItem(state, section, i)).join('')}</ul>`);
  }
  const ctas = renderCtas(state, section);
  if (ctas) out.push(ctas);
  const form = renderForm(state, section);
  if (form) out.push(form);

  return `<${tag} id="${esc(section.id)}">\n${out.join('\n')}\n</${tag}>`;
}

// ---------------------------------------------------------------------------------------------
// Pages

function emptyExpectations(): Expectations {
  return {
    markers: [],
    phones: [],
    plainTextPhones: [],
    hrefMismatches: [],
    emails: [],
    hiddenCopies: [],
    navDropdowns: [],
    deferredContent: [],
    mustNotRecord: [],
  };
}

function renderPage(label: Site, page: Page, recipe: Recipe, expect: Expectations): string {
  const ctx: PageContext = { label, page, expect };
  const state: RenderState = { ctx, recipe, ownHost: hostOf(label.sourceUrl), h1Used: false };
  const blocks: RenderedBlock[] = page.sections.map((section) => ({
    section,
    html: renderSection(state, section),
  }));

  const lead = blocks.filter(
    (b, i) => b.section.type === 'nav' && blocks.slice(0, i).every((x) => x.section.type === 'nav'),
  );
  const rest = blocks.slice(lead.length);
  const footIndex = rest.findIndex((b) => b.section.type === 'footer');
  const main = footIndex === -1 ? rest : rest.slice(0, footIndex);
  const foot = footIndex === -1 ? [] : rest.slice(footIndex);

  const mainHtml = recipe.arrange ? recipe.arrange(main, ctx) : main.map((b) => b.html).join('\n');
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(page.title)}</title>`,
    ...(page.metaDescription
      ? [`<meta name="description" content="${esc(page.metaDescription)}">`]
      : []),
    ...(recipe.headTags?.(ctx) ?? []),
    `<link rel="stylesheet" href="${STYLESHEET}">`,
  ];
  const bodyClass = (recipe.bodyClasses?.(ctx) ?? []).join(' ');
  return `${[
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    ...head,
    '</head>',
    `<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>`,
    ...lead.map((b) => b.html),
    '<main>',
    mainHtml,
    '</main>',
    ...foot.map((b) => b.html),
    ...(recipe.bodyEnd?.(ctx) ?? []),
    '</body>',
    '</html>',
  ].join('\n')}\n`;
}

function expectedFonts(label: Site, recipe: Recipe): ExpectedCapture['fonts'] {
  const { families } = fontRoles(label, recipe);
  const byFamily = new Map<string, { computed: string; usedOn: string[] }>();
  const computed = (family: string): string => recipe.fontName?.(family) ?? family;
  const use = (family: string, role: string): void => {
    const entry = byFamily.get(family) ?? { computed: computed(family), usedOn: [] };
    entry.usedOn.push(role);
    byFamily.set(family, entry);
  };
  const at = (i: number): string | undefined => families[i];
  const heading = at(0) ?? 'system-ui';
  const body = at(1) ?? heading;
  use(heading, 'heading');
  use(body, 'body');
  use(at(2) ?? body, 'nav');
  use(at(3) ?? body, 'footer');
  return [...byFamily].map(([family, v]) => ({ family, computed: v.computed, usedOn: v.usedOn }));
}

function expectedColors(label: Site): ExpectedCapture['colors'] {
  const p = paletteOf(label);
  const byHex = new Map<string, string[]>();
  const use = (hex: string, role: string): void => {
    byHex.set(hex, [...(byHex.get(hex) ?? []), role]);
  };
  use(p.primary, 'heading');
  use(p.primary, 'link');
  use(p.accent, 'cta');
  use(BODY_TEXT_COLOR, 'body');
  use(p.background, 'background');
  return [...byHex].map(([hex, usedOn]) => ({ hex, usedOn }));
}

/**
 * Render the whole site: every page, the stylesheet, the recipe's files, the anonymized label
 * and `expected.capture.json`. Keys are paths under the site directory, sorted.
 */
export function renderSyntheticSite(
  label: Site,
  recipe: Recipe,
  seed: string,
): Map<string, string> {
  const files = new Map<string, string>();
  const expect = emptyExpectations();

  for (const page of label.pages)
    files.set(pageFile(page.path), renderPage(label, page, recipe, expect));
  files.set(STYLESHEET.slice(1), stylesheet(label, recipe));
  for (const [file, text] of Object.entries(recipe.files?.(label) ?? {})) files.set(file, text);
  files.set(LABEL_FILE, `${JSON.stringify(label, null, 2)}\n`);

  const capture: ExpectedCapture = {
    schemaVersion: 1,
    seed,
    pages: label.pages.map((p) => ({
      path: p.path,
      file: pageFile(p.path),
      title: p.title,
      sectionIds: p.sections.map((s) => s.id),
    })),
    platform: {
      platform: recipe.platform.platform,
      ...(recipe.platform.pageBuilder === undefined
        ? {}
        : { pageBuilder: recipe.platform.pageBuilder }),
      evidence: recipe.platform.evidence.map((e) => ({ signal: e.signal, where: e.where })),
      markers: expect.markers,
    },
    fonts: expectedFonts(label, recipe),
    colors: expectedColors(label),
    phones: expect.phones,
    plainTextPhones: expect.plainTextPhones,
    hrefMismatches: expect.hrefMismatches,
    emails: expect.emails,
    hiddenCopies: expect.hiddenCopies,
    navDropdowns: expect.navDropdowns,
    deferredContent: expect.deferredContent,
    mustNotRecord: expect.mustNotRecord,
  };
  files.set(CAPTURE_FILE, `${JSON.stringify(capture, null, 2)}\n`);

  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
