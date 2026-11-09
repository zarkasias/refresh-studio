/**
 * Loopback "sinkhole" proxy (M1 T4): a backstop for traffic that Playwright routes can't see,
 * such as `<link rel="preconnect">`. A locked-down context points its proxy here, so anything
 * that escapes the route handler lands on loopback, is recorded, and is refused. It never
 * forwards anything.
 */
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface SinkholeHit {
  /** `CONNECT` for https tunnels, otherwise the HTTP method of a plain proxied request. */
  readonly method: string;
  /** `host:port` for CONNECT, otherwise the absolute URL the browser asked for. */
  readonly target: string;
}

export interface Sinkhole {
  /** e.g. `http://127.0.0.1:53125`; use as a Playwright `proxy.server`. */
  readonly origin: string;
  readonly hits: readonly SinkholeHit[];
  close(): Promise<void>;
}

/** Start a refusing proxy on `127.0.0.1:<random port>`. */
export async function startSinkhole(): Promise<Sinkhole> {
  const hits: SinkholeHit[] = [];
  const sockets = new Set<Socket>();

  const server = http.createServer((req, res) => {
    hits.push({ method: req.method ?? 'GET', target: req.url ?? '' });
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Blocked by fixture lockdown');
  });
  server.on('connect', (req: http.IncomingMessage, socket: Socket) => {
    hits.push({ method: 'CONNECT', target: req.url ?? '' });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const s of sockets) s.destroy();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
