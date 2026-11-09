/**
 * M1 T4 acceptance: a test page that requests real external URLs produces aborted requests
 * and zero sockets to non-loopback addresses.
 *
 * Two layers are checked:
 * - Node: every outbound TCP connect from this process (`net.connect`, `net.createConnection`,
 *   `tls.connect`, and the `net.Socket.prototype.connect` they all funnel into) is recorded.
 *   This covers the fixture server, Playwright's route fulfilment and any helper code.
 * - Chromium (a separate process the Node spy can't see): every locked-down context's proxy is
 *   its own loopback sinkhole, so non-loopback traffic that gets past the routes (redirects,
 *   overriding routes, removed routes) shows up in `escaped` instead of reaching the network.
 *   A control test proves escapes do land there. In CI the test step also runs with no network
 *   at all (see .github/workflows/ci.yml).
 *
 * Needs Chromium for Playwright 1.65: `pnpm --filter @srs/evals exec playwright install chromium`.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { type Browser, type Request, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as publicApi from './index';
import { LOOPBACK_PROXY_BYPASS, newLockedDownContext } from './lockdown';
import { isLoopbackHost, platformHost } from './network-policy';
import { type FixtureServer, startFixtureServer } from './server';
import { type Sinkhole, startSinkhole } from './sinkhole';

const ROOT = new URL('./lockdown-test-site', import.meta.url).pathname;
const PLATFORM_ASSETS = [platformHost('static.wixstatic.com')];
const quiet = { log: () => {} };

interface ConnectAttempt {
  via: string;
  host: string;
  port: string;
}

/** Pull host/port out of any of the net/tls connect argument shapes. */
function describeConnect(via: string, args: readonly unknown[]): ConnectAttempt {
  let first: unknown = args[0];
  // Socket#connect receives Node's internal normalized-args array from net.connect().
  if (Array.isArray(first)) first = first[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as { host?: unknown; port?: unknown; path?: unknown };
    if (typeof o.path === 'string') return { via, host: 'ipc', port: o.path };
    return { via, host: String(o.host ?? 'localhost'), port: String(o.port ?? '') };
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    const host = typeof args[1] === 'string' ? args[1] : 'localhost';
    return { via, host, port: String(first) };
  }
  // A string that isn't a port is a unix socket / pipe path.
  return { via, host: 'ipc', port: String(first) };
}

function isLocal(attempt: ConnectAttempt): boolean {
  return attempt.host === 'ipc' || isLoopbackHost(attempt.host);
}

/** A loopback server whose every response is a 302 to an external host. */
async function startExternalRedirector(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'https://example.com/redirected' }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/go`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('network lockdown (acceptance)', () => {
  const attempts: ConnectAttempt[] = [];
  let server: FixtureServer;
  let browser: Browser;

  beforeAll(async () => {
    // Install the spies before anything opens a socket. Each spy records and calls through.
    const record = <T extends object, K extends keyof T & string>(
      target: T,
      key: K,
      via: string,
    ) => {
      const original = target[key] as unknown as (...a: unknown[]) => unknown;
      vi.spyOn(target, key as never).mockImplementation(function (this: unknown, ...a: unknown[]) {
        attempts.push(describeConnect(via, a));
        return original.apply(this, a);
      } as never);
    };
    record(net, 'connect', 'net.connect');
    record(net, 'createConnection', 'net.createConnection');
    record(tls, 'connect', 'tls.connect');
    record(net.Socket.prototype, 'connect', 'Socket#connect');

    server = await startFixtureServer({ root: ROOT });
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      throw new Error(
        `Chromium for Playwright isn't installed. Run: pnpm --filter @srs/evals exec playwright install chromium\n${String(err)}`,
      );
    }
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // The real acceptance check, after every test: nothing in this process dialled out.
    expect(attempts.filter((a) => !isLocal(a))).toEqual([]);
  });

  it('the Node socket spy is live (positive control on loopback)', async () => {
    const before = attempts.length;
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(server.port, '127.0.0.1', () => {
        socket.end();
        resolve();
      });
      socket.on('error', reject);
    });
    const seen = attempts.slice(before);
    expect(seen.some((a) => a.via === 'net.connect' && a.host === '127.0.0.1')).toBe(true);
    expect(seen.some((a) => a.via === 'Socket#connect')).toBe(true);
  });

  it('only exposes the contained path publicly', () => {
    expect('newLockedDownContext' in publicApi).toBe(true);
    expect('installRoutePolicy' in publicApi).toBe(false);
    expect('lockdownContext' in publicApi).toBe(false);
  });

  it('aborts real external requests, serves mapped platform assets locally, and opens no external sockets', async () => {
    const log = vi.fn();
    const locked = await newLockedDownContext(browser, {
      root: server.root,
      platformAssets: PLATFORM_ASSETS,
      log,
    });
    const failed: Request[] = [];
    const page = await locked.context.newPage();
    page.on('requestfailed', (r) => failed.push(r));

    const response = await page.goto(server.url('/'), { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    expect(await page.evaluate('window.externalFetch')).toBe('failed');
    // The mapped Wix script ran, so it was fulfilled from platform-assets/.
    expect(await page.evaluate('window.wixAssetLoaded')).toBe(true);
    await locked.close();

    expect(locked.blocked.map((b) => [b.reason, b.url])).toEqual(
      expect.arrayContaining([
        ['external', 'https://example.com/real-image.png'],
        ['external', 'https://www.google.com/generate_204'],
        ['missing-asset', 'https://static.wixstatic.com/media/not-there.png'],
      ]),
    );
    expect(locked.blocked.every((b) => !isLoopbackHost(new URL(b.url).hostname))).toBe(true);
    expect(locked.served.map((s) => s.url)).toEqual(['https://static.wixstatic.com/media/app.js']);
    // Aborted by us, in the browser, before any connection.
    const externalFailures = failed.filter((r) => r.url().startsWith('https://example.com/'));
    expect(externalFailures.map((r) => r.failure()?.errorText)).toEqual([
      expect.stringContaining('ERR_BLOCKED_BY_CLIENT'),
    ]);
    // Logged.
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'blocked', url: 'https://example.com/real-image.png' }),
    );
    // Nothing got past the routes to the sinkhole either.
    expect(locked.escaped).toEqual([]);
  });

  it('contains a loopback 302 to an external host (routes do not see redirects)', async () => {
    const redirector = await startExternalRedirector();
    const locked = await newLockedDownContext(browser, quiet);
    try {
      const page = await locked.context.newPage();
      // A top-level navigation follows the redirect. (A cross-origin fetch would stop at CORS
      // before following, which wouldn't test anything.)
      await expect(page.goto(redirector.url)).rejects.toThrow(/ERR_TUNNEL_CONNECTION_FAILED/);
      // The routes never saw the redirected request...
      expect(locked.blocked).toEqual([]);
      // ...so the sinkhole is what contained it.
      expect(locked.escaped).toContainEqual({ method: 'CONNECT', target: 'example.com:443' });
    } finally {
      await locked.close();
      await redirector.close();
    }
  });

  it('stays contained when later routes override or remove the lockdown routes', async () => {
    const locked = await newLockedDownContext(browser, quiet);
    try {
      const page = await locked.context.newPage();
      await page.goto(server.url('/about/'));
      const tryFetch = (url: string) =>
        page.evaluate(
          (u) =>
            fetch(u).then(
              () => 'loaded',
              () => 'failed',
            ),
          url,
        );

      // A later context route takes precedence over ours and lets the request through.
      await locked.context.route('**/*', (r) => r.continue());
      expect(await tryFetch('https://example.com/context-override')).toBe('failed');

      // Same with a page route.
      await page.route('**/*', (r) => r.continue());
      expect(await tryFetch('https://example.org/page-override')).toBe('failed');

      // And with every route removed.
      await page.unrouteAll();
      await locked.context.unrouteAll();
      expect(await tryFetch('https://example.net/unrouted')).toBe('failed');

      const targets = locked.escaped.map((h) => h.target);
      expect(targets).toEqual(
        expect.arrayContaining(['example.com:443', 'example.org:443', 'example.net:443']),
      );
    } finally {
      await locked.close();
    }
  });

  it('closes external WebSockets without connecting', async () => {
    const locked = await newLockedDownContext(browser, quiet);
    const page = await locked.context.newPage();
    await page.goto(server.url('/websocket.html'));
    expect(await page.evaluate('window.wsResult')).toBe('closed:1008');
    await locked.close();
    expect(locked.blocked).toEqual([
      expect.objectContaining({ url: 'wss://example.com/socket', reason: 'websocket' }),
    ]);
    expect(locked.escaped).toEqual([]);
  });

  it('keeps preconnect / dns-prefetch hints (invisible to routes) on loopback', async () => {
    const locked = await newLockedDownContext(browser, quiet);
    const page = await locked.context.newPage();
    await page.goto(server.url('/preconnect.html'));
    await page.waitForTimeout(500);
    await locked.close();
    // Chromium may or may not act on the hints; if it does, they can only reach the sinkhole.
    for (const hit of locked.escaped) {
      expect(hit).toEqual({ method: 'CONNECT', target: expect.stringMatching(/^fonts\./) });
    }
  });

  it('refuses platform-asset symlinks that lead outside the rule folder', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'srs-lockdown-'));
    try {
      const hostDir = path.join(root, 'platform-assets', 'cdn.test');
      await mkdir(hostDir, { recursive: true });
      await writeFile(path.join(hostDir, 'ok.txt'), 'ok');
      await writeFile(path.join(root, 'secret.txt'), 'secret');
      await symlink(path.join(root, 'secret.txt'), path.join(hostDir, 'link.txt'));

      const locked = await newLockedDownContext(browser, {
        root,
        platformAssets: [platformHost('cdn.test')],
        ...quiet,
      });
      const page = await locked.context.newPage();
      const ok = await page.goto('https://cdn.test/ok.txt');
      expect(await ok?.text()).toBe('ok');
      await expect(page.goto('https://cdn.test/link.txt')).rejects.toThrow(/BLOCKED_BY_CLIENT/);
      await locked.close();
      expect(locked.blocked).toEqual([
        expect.objectContaining({ url: 'https://cdn.test/link.txt', reason: 'missing-asset' }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops the owned sinkhole when the context is closed directly', async () => {
    const locked = await newLockedDownContext(browser, quiet);
    const page = await locked.context.newPage();
    await page.goto(server.url('/about/'));
    await locked.context.close();
    await locked.close(); // idempotent
  });

  it('control: traffic that escapes the routes lands on a sinkhole, not the network', async () => {
    const sinkhole: Sinkhole = await startSinkhole();
    // Deliberately no routes at all: only the proxy backstop.
    const context = await browser.newContext({
      serviceWorkers: 'block',
      proxy: { server: sinkhole.origin, bypass: LOOPBACK_PROXY_BYPASS },
    });
    try {
      const page = await context.newPage();
      await page.goto(server.url('/about/'));
      const result = await page.evaluate(() =>
        fetch('https://example.com/escape').then(
          () => 'loaded',
          () => 'failed',
        ),
      );
      expect(result).toBe('failed');
      expect(sinkhole.hits).toContainEqual({ method: 'CONNECT', target: 'example.com:443' });
    } finally {
      await context.close();
      await sinkhole.close();
    }
  });
});
