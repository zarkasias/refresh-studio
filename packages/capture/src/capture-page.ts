/**
 * Page capture (M1 T9): one URL in, rendered HTML, two full-page screenshots, pending-content
 * placeholders and iframe sources out. Facts extraction is T10 and reads the live page through
 * `afterViewport`. Everything the browser requests goes through the request guard in net.ts, and
 * navigation goes through `guardedGoto` (rule 5 and 6). Storage is injected (side effect at the edge).
 */
import type { BrowserContext, Page } from 'playwright';
import type { Asset } from '@srs/site-model';
import { CaptureBlockedError } from './errors';
import { guardedGoto, normalizeUrl, requestGuardFor, type NetContext } from './net';

export const WAIT_DEFAULTS = {
  /** Cap on waiting for `networkidle`. */
  networkIdleCapMs: 15_000,
  /** Quiet time after the network goes idle, before scrolling. */
  settleMs: 1_500,
  /** Cap on waiting for placeholders ("Loading...", aria-busy) to clear. */
  placeholderCapMs: 15_000,
  /** Cap on the whole page (navigation, waits, screenshots); the page is closed when it hits. */
  pageCapMs: 120_000,
} as const;
export type WaitOptions = { [K in keyof typeof WAIT_DEFAULTS]?: number };

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

/** Injected object storage (Supabase Storage in production). */
export interface Storage {
  put(
    path: string,
    data: Uint8Array | string,
    contentType: string,
  ): Promise<{ storagePath: string }>;
}

export interface PendingContent {
  selector: string;
  placeholderText: string;
}

export interface CapturePageInput {
  url: string;
  siteId: string;
  captureRunId: string;
  pageId: string;
}

export interface CapturePageOptions {
  storage: Storage;
  newId: () => string;
  now?: () => Date;
  waits?: WaitOptions;
  /**
   * Called with the live page after the waits in each viewport (for T10 facts and T14 axe).
   * Must not navigate.
   */
  afterViewport?: (page: Page, viewport: ViewportName) => Promise<void>;
  /**
   * Fixture runs: the `escaped` list from `newLockedDownContext`. Anything in it at the end means
   * the page tried to leave the sandbox, so the navigation failed (T4 review).
   */
  escaped?: readonly unknown[];
}

export interface CapturedPageParts {
  url: string;
  finalUrl: string;
  redirectChain: string[];
  httpStatus: number;
  fetchedAt: string;
  /** `page.content()` after the waits (desktop pass). */
  html: string;
  htmlAsset: Asset;
  screenshots: { mobile: Asset; desktop: Asset };
  /** Content still showing a placeholder when the cap hit. */
  pendingContent: PendingContent[];
  /** Text content of the page with the pending placeholders removed. T10 applies the visibility filter. */
  text: string;
  /** Absolute `src` of every iframe, recorded but never loaded. */
  iframeSrcs: string[];
}

export type CapturePageResult =
  | { outcome: 'captured'; page: CapturedPageParts }
  | { outcome: 'blocked'; reason: 'bot-challenge'; url: string; httpStatus: number }
  | { outcome: 'skipped'; reason: 'non-html'; url: string; httpStatus: number };

const SANDBOX_BODY = 'Blocked by fixture lockdown';
const CHALLENGE_TITLE =
  /^(just a moment|attention required|checking your browser|verify you are human)/i;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pure: is this response a bot-challenge page? We never try to get past one. */
export function isBotChallenge(headers: Readonly<Record<string, string>>, title: string): boolean {
  return (
    (headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge' ||
    CHALLENGE_TITLE.test(title.trim())
  );
}

// Page-side scripts are strings: this package has no DOM lib, and they run in the browser.
const SELECTOR_FN = `
const selectorOf = (el) => {
  if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
  const parts = [];
  for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
    let i = 1;
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
    parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
  }
  return parts.join(' > ');
};`;

const FIND_PENDING = `(() => {
  ${SELECTOR_FN}
  const out = [];
  const els = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (el.closest('script,style,noscript,template')) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3)
      .map((n) => n.textContent || '').join(' ').replace(/\\s+/g, ' ').trim();
    if (el.getAttribute('aria-busy') === 'true') {
      out.push({ selector: selectorOf(el), placeholderText: text, el });
    } else if (/^loading\\b/i.test(own)) {
      out.push({ selector: selectorOf(el), placeholderText: own, el });
    }
  }
  // Keep the outermost of nested matches.
  const kept = out.filter((a) => !out.some((b) => b !== a && b.el.contains(a.el)));
  return kept.map(({ selector, placeholderText }) => ({ selector, placeholderText }));
})()`;

const PAGE_TEXT = (pending: PendingContent[]) => `(() => {
  const selectors = ${JSON.stringify(pending.map((p) => p.selector))};
  const all = Array.from(document.body.querySelectorAll('*'));
  const clone = document.body.cloneNode(true);
  const cloneAll = clone.querySelectorAll('*');
  const drop = [];
  for (const s of selectors) {
    const live = document.querySelector(s);
    const i = live ? all.indexOf(live) : -1;
    if (i >= 0 && cloneAll[i]) drop.push(cloneAll[i]);
  }
  for (const el of drop) el.remove();
  for (const el of clone.querySelectorAll('script,style,noscript,template')) el.remove();
  return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
})()`;

const IFRAME_SRCS = `(() => {
  const out = [];
  for (const f of document.querySelectorAll('iframe')) {
    const raw = f.getAttribute('src');
    if (!raw) continue;
    try {
      const u = new URL(raw, location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push(u.href);
    } catch {}
  }
  return out;
})()`;

async function findPending(page: Page): Promise<PendingContent[]> {
  return (await page.evaluate(FIND_PENDING)) as PendingContent[];
}

async function lazyScroll(page: Page, stepPx: number, deadline: number): Promise<void> {
  for (let i = 0; i < 80 && Date.now() < deadline; i += 1) {
    const state = (await page.evaluate(
      `(() => { window.scrollBy(0, ${stepPx}); return { bottom: Math.ceil(window.scrollY + window.innerHeight), height: document.documentElement.scrollHeight }; })()`,
    )) as { bottom: number; height: number };
    await sleep(120);
    if (state.bottom >= state.height) break;
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

async function settleAndScroll(
  page: Page,
  viewport: { width: number; height: number },
  waits: Required<WaitOptions>,
  settleMs: number,
): Promise<PendingContent[]> {
  await page
    .waitForLoadState('networkidle', { timeout: waits.networkIdleCapMs })
    .catch(() => undefined);
  await sleep(settleMs);
  await lazyScroll(page, viewport.height, Date.now() + 10_000);
  const deadline = Date.now() + waits.placeholderCapMs;
  let pending = await findPending(page);
  while (pending.length > 0 && Date.now() < deadline) {
    await sleep(250);
    pending = await findPending(page);
  }
  return pending;
}

/** Width and height from a PNG header. */
export function pngSize(png: Uint8Array): { width: number; height: number } | undefined {
  if (png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50) return undefined;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

async function captureOnPage(
  ctx: NetContext,
  page: Page,
  input: CapturePageInput,
  options: CapturePageOptions,
  waits: Required<WaitOptions>,
): Promise<CapturePageResult> {
  const now = options.now ?? (() => new Date());
  await page.setViewportSize(VIEWPORTS.desktop);
  const nav = await guardedGoto(ctx, page, input.url);

  // The sandbox's refusal page is a failed navigation, never page content.
  const escapedNow = () => (options.escaped?.length ?? 0) > 0;
  if (escapedNow()) {
    throw new CaptureBlockedError(
      'network',
      'The page tried to reach outside the test sandbox.',
      input.url,
    );
  }
  if (nav.status === 403 && (await page.content()).includes(SANDBOX_BODY)) {
    throw new CaptureBlockedError('network', 'The test sandbox refused this page.', input.url);
  }

  const title = await page.title().catch(() => '');
  if (isBotChallenge(nav.headers, title)) {
    return {
      outcome: 'blocked',
      reason: 'bot-challenge',
      url: nav.finalUrl,
      httpStatus: nav.status,
    };
  }
  const contentType = (nav.headers['content-type'] ?? '').toLowerCase();
  if (contentType && !/html|xml/.test(contentType)) {
    return { outcome: 'skipped', reason: 'non-html', url: nav.finalUrl, httpStatus: nav.status };
  }
  const fetchedAt = now().toISOString();
  const guard = requestGuardFor(page.context());
  let popups = 0;
  page.on('popup', (popup) => {
    popups += 1;
    void popup.close().catch(() => undefined);
  });
  // Anything that moved the main frame after guardedGoto returned (meta refresh, Refresh header,
  // script, click, popup) means the content is not the page we were asked for.
  const assertStayedPut = (): void => {
    const stray = guard?.pageState(page).unexpected ?? [];
    let moved = false;
    try {
      moved = normalizeUrl(page.url()) !== normalizeUrl(nav.finalUrl);
    } catch {
      moved = true; // chrome-error:// or an unparseable URL
    }
    if (stray.length > 0 || popups > 0 || moved) {
      throw new CaptureBlockedError(
        'redirect-refused',
        'This page tried to send visitors somewhere else after it loaded, so we did not use what we saw.',
        stray[0] ?? page.url(),
      );
    }
  };

  const pending = new Map<string, PendingContent>();
  const shots = {} as Record<ViewportName, Buffer>;
  let html = '';
  let text = '';
  let iframeSrcs: string[] = [];

  for (const name of ['desktop', 'mobile'] as const) {
    const viewport = VIEWPORTS[name];
    if (name === 'mobile') {
      await page.setViewportSize(viewport);
    }
    const found = await settleAndScroll(
      page,
      viewport,
      waits,
      name === 'desktop' ? waits.settleMs : 500,
    );
    for (const p of found) pending.set(p.selector, p);
    if (name === 'desktop') {
      html = await page.content();
      iframeSrcs = (await page.evaluate(IFRAME_SRCS)) as string[];
      text = (await page.evaluate(PAGE_TEXT([...pending.values()]))) as string;
    }
    assertStayedPut();
    await options.afterViewport?.(page, name);
    shots[name] = await page.screenshot({ fullPage: true, type: 'png' });
  }
  assertStayedPut();
  if (escapedNow()) {
    throw new CaptureBlockedError(
      'network',
      'The page tried to reach outside the test sandbox.',
      input.url,
    );
  }

  const base = `${input.siteId}/captures/${input.captureRunId}/${input.pageId}`;
  const upload = async (
    kind: 'screenshot' | 'document',
    file: string,
    data: Uint8Array | string,
    contentType: string,
    size?: { width: number; height: number },
  ): Promise<Asset> => {
    const { storagePath } = await options.storage.put(`${base}/${file}`, data, contentType);
    return {
      id: options.newId(),
      siteId: input.siteId,
      kind,
      sourceUrl: nav.finalUrl,
      storagePath,
      ...(size ? { width: size.width, height: size.height } : {}),
      bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength,
    };
  };
  const htmlAsset = await upload('document', 'page.html', html, 'text/html; charset=utf-8');
  const desktop = await upload(
    'screenshot',
    'desktop.png',
    shots.desktop,
    'image/png',
    pngSize(shots.desktop),
  );
  const mobile = await upload(
    'screenshot',
    'mobile.png',
    shots.mobile,
    'image/png',
    pngSize(shots.mobile),
  );

  return {
    outcome: 'captured',
    page: {
      url: input.url,
      finalUrl: nav.finalUrl,
      redirectChain: nav.chain.filter((u) => u !== nav.finalUrl),
      httpStatus: nav.status,
      fetchedAt,
      html,
      htmlAsset,
      screenshots: { mobile, desktop },
      pendingContent: [...pending.values()],
      text,
      iframeSrcs,
    },
  };
}

/**
 * Capture one page in a context that carries the request guard (`newGuardedContext`). Opens a
 * page, always closes it, and never runs past `pageCapMs`.
 */
export async function capturePage(
  ctx: NetContext,
  context: BrowserContext,
  input: CapturePageInput,
  options: CapturePageOptions,
): Promise<CapturePageResult> {
  const waits = { ...WAIT_DEFAULTS, ...options.waits } as Required<WaitOptions>;
  const page = await context.newPage();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void page.close().catch(() => undefined);
      reject(new CaptureBlockedError('timeout', 'This page took too long to capture.', input.url));
    }, waits.pageCapMs);
  });
  try {
    return await Promise.race([captureOnPage(ctx, page, input, options, waits), deadline]);
  } finally {
    clearTimeout(timer);
    await page.close().catch(() => undefined);
  }
}
