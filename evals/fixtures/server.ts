/**
 * Static fixture server on loopback (M1 T4). Side-effecting edge: binds a socket on
 * 127.0.0.1 with a random free port and serves files from one directory, read-only.
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { contentTypeFor } from './network-policy';

export interface FixtureServer {
  /** e.g. `http://127.0.0.1:53124` (bare origin, no trailing slash). */
  readonly origin: string;
  readonly port: number;
  /** Absolute, symlink-resolved directory being served. */
  readonly root: string;
  /** Absolute URL for a path on this server, e.g. `url('/about/')`. */
  url(pathname?: string): string;
  close(): Promise<void>;
}

export interface FixtureServerOptions {
  /** Directory to serve. */
  root: string;
}

type Resolved =
  { kind: 'file'; file: string } | { kind: 'redirect'; location: string } | { kind: 'missing' };

/** Same-origin path for a directory, built from the resolved real path (never the raw URL). */
function redirectFor(root: string, realDir: string): string {
  const rel = path.relative(root, realDir);
  const segments = rel === '' ? [] : rel.split(path.sep).map(encodeURIComponent);
  return `/${segments.map((s) => `${s}/`).join('')}`;
}

async function resolveRequest(root: string, rawUrl: string): Promise<Resolved> {
  let pathname: string;
  try {
    // Prefix rather than resolve against a base, so `//host/x` stays a path and isn't read as a host.
    pathname = decodeURIComponent(new URL(`http://127.0.0.1${rawUrl}`).pathname);
  } catch {
    return { kind: 'missing' };
  }
  // `//` (from `/.//x`, `/a/..//x`, `/%2Fx`) or a backslash could become a protocol-relative
  // redirect or an odd path; no fixture needs them, so refuse.
  if (pathname.includes('\0') || pathname.includes('//') || pathname.includes('\\')) {
    return { kind: 'missing' };
  }

  const candidate = path.resolve(root, `.${pathname}`);
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return { kind: 'missing' };
  }
  // Containment is checked on the real path so symlinks can't escape the fixture root.
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) return { kind: 'missing' };

  const info = await stat(real);
  if (info.isDirectory()) {
    if (!pathname.endsWith('/')) return { kind: 'redirect', location: redirectFor(root, real) };
    const index = path.join(real, 'index.html');
    try {
      if ((await stat(index)).isFile()) return { kind: 'file', file: index };
    } catch {
      // fall through
    }
    return { kind: 'missing' };
  }
  return info.isFile() ? { kind: 'file', file: real } : { kind: 'missing' };
}

/** Start serving `root` on `127.0.0.1:<random port>`. Call `close()` when done. */
export async function startFixtureServer(options: FixtureServerOptions): Promise<FixtureServer> {
  const root = await realpath(path.resolve(options.root));
  if (!(await stat(root)).isDirectory()) {
    throw new Error(`Fixture root is not a directory: ${root}`);
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    resolveRequest(root, req.url ?? '/')
      .then((resolved) => {
        if (resolved.kind === 'redirect') {
          res.writeHead(301, { Location: resolved.location }).end();
        } else if (resolved.kind === 'missing') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        } else {
          res.writeHead(200, {
            'Content-Type': contentTypeFor(resolved.file),
            'Cache-Control': 'no-store',
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          const stream = createReadStream(resolved.file);
          stream.on('error', () => res.destroy());
          stream.pipe(res);
        }
      })
      .catch(() => {
        if (res.headersSent) res.destroy();
        else res.writeHead(500).end();
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    port,
    root,
    url: (pathname = '/') => new URL(pathname, `${origin}/`).href,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
