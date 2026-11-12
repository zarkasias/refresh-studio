/**
 * iphci (WordPress + Beaver Builder): WordPress markers from the manifest evidence, Slick slider
 * clones of the consecutive service blocks, a Cloudflare-obfuscated email (`data-cfemail`), and
 * a `href="#"` Services toggle with a submenu.
 */
import { encodeCfEmail, CF_EMAIL_DECODE_SCRIPT, CF_EMAIL_SCRIPT_PATH } from '../synthetic/cfemail';
import { esc } from '../synthetic/html';
import type { Recipe, RenderedBlock } from '../synthetic/recipe';
import { hostOf, localLink } from '../synthetic/render';
import { platformFromManifest, primaryColor, squareSvg } from './common';

const GENERATOR = '<meta name="generator" content="WordPress 6.6.2">';
const THEME = '/wp-content/themes/agency-child';
const LOGO = '/wp-content/uploads/2024/03/logo.svg';
const NAV_SCRIPT = `${THEME}/navigation.js`;

const CF_PLACEHOLDER = '[email&#160;protected]';

const NAV_TOGGLE_JS = `(function () {
  document.addEventListener('click', function (event) {
    var link = event.target.closest('.has-submenu > a[href="#"]');
    if (!link) return;
    event.preventDefault();
    var item = link.parentElement;
    var open = item.classList.toggle('open');
    link.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();
`;

/** Consecutive `services` blocks on a page form the slider. */
function sliderRun(blocks: readonly RenderedBlock[]): [number, number] | undefined {
  const start = blocks.findIndex((b) => b.section.type === 'services');
  if (start === -1) return undefined;
  let end = start;
  while (blocks[end + 1]?.section.type === 'services') end++;
  return end > start ? [start, end] : undefined;
}

const stripIds = (html: string): string => html.replace(/\sid="[^"]*"/g, '');

export const iphci: Recipe = {
  slug: 'iphci',
  platform: platformFromManifest('iphci'),
  platformHosts: [],

  headTags: ({ page, expect }) => {
    expect.markers.push({ where: 'html', value: GENERATOR, page: page.path });
    return [GENERATOR, `<link rel="stylesheet" href="${THEME}/style.css">`];
  },

  bodyClasses: () => ['wp-singular', 'page-template', 'fl-builder'],

  css: () => `.sub-menu { display: none; list-style: none; margin: 0; padding: 0 0 0 1rem; }
.has-submenu:hover > .sub-menu, .has-submenu.open > .sub-menu { display: block; }
.slick-list { overflow: hidden; }
.slick-track { display: flex; transform: translateX(-300%); }
.slick-slide { flex: 0 0 100%; min-width: 0; }
`,

  extraContent: ({ section, page, expect }) => {
    if (section.type !== 'nav') return '';
    expect.markers.push({ where: 'asset-url', value: LOGO, page: page.path });
    return `<img src="${LOGO}" alt="" width="48" height="48">`;
  },

  // The Services item is a toggle (`href="#"`); its submenu lists the service blocks' pages.
  navSubmenu: (item, { label, page, section, expect }) => {
    if (item.link !== '#') return [];
    const own = hostOf(label.sourceUrl);
    const children = page.sections
      .filter((s) => s.type === 'services')
      .flatMap((s) => {
        const cta = s.content.ctas?.[0];
        const title = s.content.subheading;
        return cta !== undefined && title !== undefined ? [{ title, link: cta.href }] : [];
      });
    if (children.length > 0) {
      expect.navDropdowns.push({
        page: page.path,
        sectionId: section.id,
        title: item.title ?? '',
        href: '#',
        children: children.map((c) => ({ title: c.title, link: localLink(c.link, own) })),
      });
    }
    return children;
  },

  emailLink: (cta, email, { page, expect }) => {
    expect.markers.push({ where: 'html', value: 'data-cfemail', page: page.path });
    for (const text of [CF_PLACEHOLDER.replace('&#160;', ' '), '[email protected]']) {
      if (!expect.mustNotRecord.includes(text)) expect.mustNotRecord.push(text);
    }
    const hex = encodeCfEmail(email);
    const span = `<span class="__cf_email__" data-cfemail="${hex}">${CF_PLACEHOLDER}</span>`;
    const label = esc(cta.label).replace(esc(email), span);
    return `<a class="cta" href="/cdn-cgi/l/email-protection#${hex}">${label}</a>`;
  },

  // The three service blocks sit in a Slick slider; Slick adds aria-hidden clones at both ends.
  arrange: (blocks, { page, expect }) => {
    const run = sliderRun(blocks);
    const plain = (bs: readonly RenderedBlock[]): string => bs.map((b) => b.html).join('\n');
    if (run === undefined) return plain(blocks);
    const [start, end] = run;
    const originals = blocks.slice(start, end + 1);
    const clone = (b: RenderedBlock, index: number): string => {
      expect.hiddenCopies.push({
        page: page.path,
        selector: `.slick-cloned[data-slick-index="${index}"]`,
        copyOf: b.section.id,
        signals: ['class', 'aria-hidden'],
      });
      return `<div class="slick-slide slick-cloned" data-slick-index="${index}" aria-hidden="true" tabindex="-1">\n${stripIds(b.html)}\n</div>`;
    };
    const n = originals.length;
    const before = originals.map((b, i) => clone(b, i - n));
    const slides = originals.map(
      (b, i) =>
        `<div class="slick-slide${i === 0 ? ' slick-current slick-active' : ''}" data-slick-index="${i}">\n${b.html}\n</div>`,
    );
    const after = originals.map((b, i) => clone(b, n + i));
    const slider = `<div class="slick-slider slick-initialized"><div class="slick-list"><div class="slick-track">\n${[...before, ...slides, ...after].join('\n')}\n</div></div></div>`;
    return [plain(blocks.slice(0, start)), slider, plain(blocks.slice(end + 1))]
      .filter(Boolean)
      .join('\n');
  },

  bodyEnd: () => [
    `<script src="${CF_EMAIL_SCRIPT_PATH}"></script>`,
    `<script src="${NAV_SCRIPT}"></script>`,
  ],

  files: (label) => ({
    [LOGO.slice(1)]: squareSvg(primaryColor(label), 48),
    [`${THEME.slice(1)}/style.css`]: '/* Theme: agency-child */\n',
    [NAV_SCRIPT.slice(1)]: NAV_TOGGLE_JS,
    [CF_EMAIL_SCRIPT_PATH.slice(1)]: CF_EMAIL_DECODE_SCRIPT,
  }),
};
