/** Test-only helpers: tiny loopback HTTP servers and project literals. Not exported from index. */
import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { Project } from '@srs/site-model';
import { vi } from 'vitest';

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface TestSite {
  readonly port: number;
  readonly hits: string[];
  close(): Promise<void>;
}

export async function startSite(
  routes: Record<string, Reply | ((url: string) => Reply)>,
): Promise<TestSite> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    hits.push(url);
    const route = routes[url] ?? routes[url.split('?')[0] ?? ''];
    const reply =
      typeof route === 'function' ? route(url) : (route ?? { status: 404, body: 'nope' });
    res.writeHead(reply.status ?? 200, reply.headers ?? {}).end(reply.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

/** A port nothing listens on. */
export async function closedPort(): Promise<number> {
  const s = await startSite({});
  const { port } = s;
  await s.close();
  return port;
}

export function projectFor(
  siteUrl: string,
  scope: { pathPrefix?: string; maxPages?: number } = {},
): Project {
  const url = new URL(siteUrl);
  return {
    id: 'proj_test',
    clientName: 'Test site',
    siteUrl,
    consent: {
      grantedBy: 'Test owner',
      grantedAt: '2026-11-09T00:00:00.000Z',
      method: 'own-site',
      scope: {
        origin: url.origin,
        ...(scope.pathPrefix !== undefined ? { pathPrefix: scope.pathPrefix } : {}),
        maxPages: scope.maxPages ?? 25,
      },
    },
    createdAt: '2026-11-09T00:00:00.000Z',
  };
}

/** A server that accepts connections and never answers. */
export async function startHangingServer(): Promise<TestSite> {
  const server = http.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    hits: [],
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

/** A loopback server that counts WebSocket upgrade attempts and TCP connections. */
export async function startUpgradeCounter(): Promise<TestSite & { upgrades: number }> {
  const state = { upgrades: 0 };
  const server = http.createServer((_req, res) => res.writeHead(404).end());
  server.on('upgrade', (_req, socket) => {
    state.upgrades += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    hits: [],
    get upgrades() {
      return state.upgrades;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

/** Stand-in for `https.request`: records the options and answers with a tiny image. No socket. */
export function stubHttps(
  respond: (n: number) => { status: number; headers: Record<string, string | undefined> } = () => ({
    status: 200,
    headers: {},
  }),
) {
  const calls: { options: Record<string, unknown> }[] = [];
  const spy = vi.spyOn(https, 'request').mockImplementation(((options: Record<string, unknown>) => {
    calls.push({ options });
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
    req.destroy = () => undefined;
    req.end = () => {
      const res = Readable.from([Buffer.from('PNG')]) as Readable & {
        statusCode: number;
        headers: Record<string, string>;
      };
      const planned = respond(calls.length);
      res.statusCode = planned.status;
      res.headers = {
        'content-type': 'image/png',
        'set-cookie': 'a=b',
        'content-length': '3',
        ...planned.headers,
      };
      req.emit('response', res);
    };
    return req;
  }) as never);
  return { calls, spy };
}

/** A TCP server that counts connections and never answers. `poke()` makes one (positive control). */
export async function startConnectionCounter(): Promise<{
  port: number;
  readonly connections: number;
  poke(): Promise<void>;
  close(): Promise<void>;
}> {
  const state = { connections: 0 };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    state.connections += 1;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    get connections() {
      return state.connections;
    },
    poke: () =>
      new Promise<void>((resolve) => {
        // eslint-disable-next-line no-restricted-syntax -- test helper: a raw TCP connect to loopback
        const c = net.connect(port, '127.0.0.1', () => {
          c.end();
          setTimeout(resolve, 50);
        });
        c.on('error', () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
