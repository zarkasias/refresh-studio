/**
 * casper-plumbing (Wix): Wix markers from the manifest evidence, Wix internal font names, a
 * `tel:` href that doesn't match the displayed number (comes from the label), and phones shown
 * as plain text where the label says "(not linked)".
 */
import { PHONE_IN_TEXT } from '../synthetic/html';
import type { Recipe } from '../synthetic/recipe';
import { platformFromManifest, primaryColor, squareSvg } from './common';

const WIX_HOST = 'static.wixstatic.com';
const LOGO_PATH = 'media/logo_a1b2c3.svg';
const LOGO_URL = `https://${WIX_HOST}/${LOGO_PATH}`;
const GENERATOR = '<meta name="generator" content="Wix.com Website Builder">';

/** Wix reports its own font names in computed styles; the labels use the real family. */
const WIX_FONT_NAMES: Readonly<Record<string, string>> = {
  Futura: 'futura-lt-w01-book1475496',
  'Cormorant Garamond': 'cormorant garamond',
  Bitter: 'bitter',
  Georgia: 'georgia',
};

const NOT_LINKED = / ?\(not linked\)/g;

export const casperPlumbing: Recipe = {
  slug: 'casper-plumbing',
  platform: platformFromManifest('casper-plumbing'),
  platformHosts: [WIX_HOST],

  fontName: (family) => WIX_FONT_NAMES[family] ?? family,

  headTags: ({ page, expect }) => {
    expect.markers.push({ where: 'html', value: GENERATOR, page: page.path });
    return [GENERATOR];
  },

  extraContent: ({ section, page, expect }) => {
    if (section.type !== 'nav') return '';
    expect.markers.push({ where: 'asset-url', value: LOGO_URL, page: page.path });
    return `<img src="${LOGO_URL}" alt="" width="48" height="48">`;
  },

  // "(not linked)" is the labeler's note: the page shows the number as plain text.
  text: (text, field, { page, section, expect }) => {
    if (field !== 'body' || !NOT_LINKED.test(text)) return text;
    NOT_LINKED.lastIndex = 0;
    for (const m of text.matchAll(
      new RegExp(`(${PHONE_IN_TEXT.source})${NOT_LINKED.source}`, 'g'),
    )) {
      expect.plainTextPhones.push({ display: m[1] ?? '', page: page.path, sectionId: section.id });
    }
    return text.replace(NOT_LINKED, '');
  },

  files: (label) => ({
    [`platform-assets/${WIX_HOST}/${LOGO_PATH}`]: squareSvg(primaryColor(label), 48),
  }),
};
