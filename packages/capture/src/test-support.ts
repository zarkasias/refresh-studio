/** Test-only helpers: tiny loopback HTTP servers and project literals. Not exported from index. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Project } from '@srs/site-model';

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
