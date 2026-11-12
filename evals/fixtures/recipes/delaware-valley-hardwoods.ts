/**
 * delaware-valley-hardwoods (custom): an Instagram-style feed that shows "Loading recent
 * projects..." until a script replaces it after 1.2 seconds. The manifest's only evidence is
 * prose about the absence of CMS signals, so there are no platform markers.
 */
import type { Section } from '@srs/site-model';
import { esc } from '../synthetic/html';
import type { Recipe } from '../synthetic/recipe';
import { platformFromManifest, primaryColor, squareSvg } from './common';

export const PLACEHOLDER = 'Loading recent projects...';
export const SETTLE_MS = 1200;
const POSTS = 6;
const FEED_ID = 'instagram-feed';
const FEED_SCRIPT = '/assets/feed.js';

/** The label's "Recent Projects" gallery: the one the labeler noted as a JS-loaded feed. */
const isFeed = (section: Section): boolean =>
  section.type === 'gallery' && /recent projects/i.test(section.content.heading ?? '');

function feedScript(): string {
  const figures = Array.from({ length: POSTS }, (_, i) => {
    const n = i + 1;
    return `<figure><img src="/assets/feed/post-${n}.svg" alt="Recent project photo ${n}" width="96" height="96"><figcaption>Project photo ${n}</figcaption></figure>`;
  }).join('');
  return `(function () {
  var feed = document.getElementById(${JSON.stringify(FEED_ID)});
  if (!feed) return;
  setTimeout(function () {
    feed.innerHTML = ${JSON.stringify(figures)};
    feed.setAttribute('data-loaded', 'true');
  }, ${SETTLE_MS});
})();
`;
}

export const delawareValleyHardwoods: Recipe = {
  slug: 'delaware-valley-hardwoods',
  platform: platformFromManifest('delaware-valley-hardwoods'),
  platformHosts: [],

  // The label's body is the labeler's note about the feed, not page copy.
  text: (text, field, { section }) => (field === 'body' && isFeed(section) ? '' : text),

  extraContent: ({ section, page, expect }) => {
    if (!isFeed(section)) return '';
    expect.deferredContent.push({
      page: page.path,
      sectionId: section.id,
      selector: `#${FEED_ID}`,
      placeholderText: PLACEHOLDER,
      settleMs: SETTLE_MS,
      finalItemCount: POSTS,
      finalTextIncludes: 'Project photo 1',
    });
    return `<div id="${FEED_ID}" class="feed">${esc(PLACEHOLDER)}</div>`;
  },

  bodyEnd: ({ page }) =>
    page.sections.some(isFeed) ? [`<script src="${FEED_SCRIPT}" defer></script>`] : [],

  files: (label) => ({
    [FEED_SCRIPT.slice(1)]: feedScript(),
    ...Object.fromEntries(
      Array.from({ length: POSTS }, (_, i) => [
        `assets/feed/post-${i + 1}.svg`,
        squareSvg(primaryColor(label), 96),
      ]),
    ),
  }),
};
