/**
 * `pnpm eval:capture` (M1 T6a): serve-and-fetch, plus a browser pass under lockdown.
 *
 * For each synthetic site in `evals/fixtures/sites/`:
 * 1. serve it with the T4 fixture server and fetch every page and every local file the pages
 *    load (all must answer 200);
 * 2. open every page in Chromium inside `newLockedDownContext`: nothing may be blocked or
 *    escape to the sinkhole, and only mapped platform assets may be served locally;
 * 3. check what the rendered page shows against `expected.capture.json`: phones, mismatched
 *    links, plain-text phones, emails (decoded), clones, dropdowns, computed fonts and colors,
 *    and late-loading content (with a fake clock, so the 1.2 s wait is exact).
 *
 * This checks the fixtures, not capture code (that arrives in T10+). One score is printed at
 * the end: checks passed / checks run. Needs Chromium: `pnpm --filter @srs/evals exec playwright
 * install chromium`.
 */
/// <reference lib="dom" />
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RECIPES } from '../recipes';
import { platformHost } from '../network-policy';
import { newLockedDownContext } from '../lockdown';
import { type FixtureServer, startFixtureServer } from '../server';
import { SYNTHETIC_SITES_DIR } from './build';
import { ExpectedCaptureSchema, type ExpectedCapture } from './expected-capture';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});

const results: { name: string; ok: boolean }[] = [];
/** Record a check; the test still fails on the first miss, but the score counts all of them. */
function check(name: string, ok: boolean): void {
  results.push({ name, ok });
  expect(ok, name).toBe(true);
}

afterAll(async () => {
  await browser?.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(
    `eval:capture score ${passed}/${results.length} (${((100 * passed) / Math.max(1, results.length)).toFixed(1)}%)`,
  );
});

const hexToRgb = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** Local files a page loads: script src, link href, img src (not anchors). */
function loadedPaths(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<(?:script|img)\b[^>]*\bsrc="(\/[^"/][^"]*)"/g))
    out.add(m[1] ?? '');
  for (const m of html.matchAll(/<link\b[^>]*\bhref="(\/[^"/][^"]*)"/g)) out.add(m[1] ?? '');
  return [...out];
}

async function checkPage(page: Page, cap: ExpectedCapture, pagePath: string): Promise<void> {
  const text = await page.locator('body').innerText();
  const at = (p: string): boolean => p === pagePath;

  for (const p of cap.phones.filter((x) => at(x.page))) {
    check(
      `${pagePath} phone link ${p.href}`,
      (await page.locator(`a[href="${p.href}"]`).count()) > 0,
    );
  }
  for (const m of cap.hrefMismatches.filter((x) => at(x.page))) {
    const n = await page.locator(`a[href="${m.href}"]`, { hasText: m.label }).count();
    check(`${pagePath} mismatch ${m.href} shows ${m.label}`, n > 0);
  }
  for (const p of cap.plainTextPhones.filter((x) => at(x.page))) {
    const digits = p.display.replace(/\D/g, '');
    const hrefs = await page
      .locator('a[href^="tel:"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    const linked = hrefs.filter((h) => h.replace(/\D/g, '').includes(digits)).length;
    check(`${pagePath} plain-text phone ${p.display}`, text.includes(p.display) && linked === 0);
  }
  for (const e of cap.emails.filter((x) => at(x.page))) {
    const n = await page.locator(`a[href="mailto:${e.value}"]`).count();
    check(
      `${pagePath} email ${e.obfuscation} decoded after scripts`,
      n > 0 && text.includes(e.value),
    );
  }
  for (const s of cap.mustNotRecord)
    check(`${pagePath} never shows ${JSON.stringify(s)}`, !text.includes(s));

  for (const h of cap.hiddenCopies.filter((x) => at(x.page))) {
    const el = page.locator(h.selector);
    check(
      `${pagePath} hidden copy ${h.selector}`,
      (await el.count()) === 1 && (await el.getAttribute('aria-hidden')) === 'true',
    );
  }

  for (const d of cap.navDropdowns.filter((x) => at(x.page))) {
    const toggle = page.locator(`#${d.sectionId} a[href="${d.href}"]`, { hasText: d.title });
    const sub = toggle.locator('xpath=following-sibling::ul');
    check(`${pagePath} ${d.title} submenu hidden at first`, !(await sub.isVisible()));
    await toggle.click();
    const items = await sub
      .locator('a')
      .evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
    check(`${pagePath} ${d.title} toggle opens submenu`, await sub.isVisible());
    check(
      `${pagePath} ${d.title} submenu entries`,
      JSON.stringify(items) === JSON.stringify(d.children.map((c) => [c.title, c.link])),
    );
    check(
      `${pagePath} ${d.title} href="#" stays on the page`,
      new URL(page.url()).pathname === pagePath,
    );
  }

  const heading = cap.fonts.find((f) => f.usedOn.includes('heading'));
  const h2 = page.locator('h1, h2').first();
  if (heading && (await h2.count()) > 0) {
    const family = await h2.evaluate((el) => getComputedStyle(el).fontFamily);
    const first = (family.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase();
    check(`${pagePath} heading font ${heading.computed}`, first === heading.computed.toLowerCase());
    const color = cap.colors.find((c) => c.usedOn.includes('heading'));
    const rgb = await h2.evaluate((el) => getComputedStyle(el).color);
    check(
      `${pagePath} heading color ${color?.hex}`,
      color !== undefined && rgb === hexToRgb(color.hex),
    );
  }
}

async function checkDeferred(
  server: FixtureServer,
  cap: ExpectedCapture,
  pagePath: string,
  options: Parameters<typeof newLockedDownContext>[1],
): Promise<void> {
  const lock = await newLockedDownContext(browser, options);
  try {
    const page = await lock.context.newPage();
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    await page.goto(server.url(pagePath), { waitUntil: 'load' });
    for (const d of cap.deferredContent.filter((x) => x.page === pagePath)) {
      const feed = page.locator(d.selector);
      check(
        `${pagePath} ${d.selector} shows the placeholder first`,
        (await feed.innerText()) === d.placeholderText,
      );
      await page.clock.runFor(d.settleMs - 1);
      check(
        `${pagePath} ${d.selector} still loading at ${d.settleMs - 1} ms`,
        (await feed.innerText()) === d.placeholderText,
      );
      await page.clock.runFor(1);
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(d.selector)})?.getAttribute('data-loaded') === 'true'`,
      );
      check(
        `${pagePath} ${d.selector} shows ${d.finalItemCount} items after ${d.settleMs} ms`,
        (await feed.locator('figure').count()) === d.finalItemCount &&
          (await feed.innerText()).includes(d.finalTextIncludes),
      );
    }
    check(
      `${pagePath} (deferred pass) nothing blocked or escaped`,
      lock.blocked.length === 0 && lock.escaped.length === 0,
    );
  } finally {
    await lock.close();
  }
}

describe.each(RECIPES.map((r) => r.slug))('eval:capture %s', (slug) => {
  const siteDir = path.join(SYNTHETIC_SITES_DIR, slug);
  const recipe = RECIPES.find((r) => r.slug === slug);
  let server: FixtureServer;
  let cap: ExpectedCapture;
  beforeAll(async () => {
    cap = ExpectedCaptureSchema.parse(
      JSON.parse(await readFile(path.join(siteDir, 'expected.capture.json'), 'utf8')),
    );
    server = await startFixtureServer({ root: siteDir });
  });
  afterAll(async () => {
    await server?.close();
  });

  it('serves every page and every local file the pages load', async () => {
    for (const p of cap.pages) {
      const res = await fetch(server.url(p.path));
      const html = await res.text();
      check(
        `${p.path} answers 200 as html`,
        res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/html'),
      );
      check(
        `${p.path} has its sections`,
        p.sectionIds.every((id) => html.includes(`id="${id}"`)),
      );
      for (const file of loadedPaths(html)) {
        const r = await fetch(server.url(file));
        check(`${p.path} loads ${file}`, r.status === 200);
        await r.arrayBuffer();
      }
    }
  });

  it('renders as expected in Chromium under lockdown, with no external requests', async () => {
    const platformAssets = (recipe?.platformHosts ?? []).map((h) => platformHost(h));
    const lock = await newLockedDownContext(browser, {
      root: siteDir,
      platformAssets,
      log: () => {},
    });
    try {
      const page = await lock.context.newPage();
      const requested: string[] = [];
      page.on('request', (r) => requested.push(r.url()));
      for (const p of cap.pages) {
        await page.goto(server.url(p.path), { waitUntil: 'load' });
        await checkPage(page, cap, p.path);
      }
      check('no blocked requests', lock.blocked.length === 0);
      check('nothing escaped to the sinkhole', lock.escaped.length === 0);
      const hosts = new Set(recipe?.platformHosts ?? []);
      check(
        'every request is loopback or a mapped platform asset',
        requested.every(
          (u) => new URL(u).hostname === '127.0.0.1' || hosts.has(new URL(u).hostname),
        ),
      );
      check(
        'platform assets are served from local files',
        lock.served.every(
          (s) =>
            s.file.startsWith(`${path.join(siteDir, 'platform-assets')}`) ||
            s.file.includes(`${path.sep}platform-assets${path.sep}`),
        ),
      );
      for (const marker of cap.platform.markers.filter(
        (m) => m.where === 'asset-url' && m.value.startsWith('https://'),
      )) {
        check(
          `marker ${marker.value} fulfilled locally`,
          lock.served.some((s) => s.url === marker.value),
        );
      }
    } finally {
      await lock.close();
    }
  });

  it('shows late-loading content only after its wait', async () => {
    const platformAssets = (recipe?.platformHosts ?? []).map((h) => platformHost(h));
    for (const p of new Set(cap.deferredContent.map((d) => d.page))) {
      await checkDeferred(server, cap, p, {
        root: siteDir,
        platformAssets,
        log: () => {},
      });
    }
  });
});
