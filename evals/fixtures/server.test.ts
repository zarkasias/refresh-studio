import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FixtureServer, startFixtureServer } from './server';

const ROOT = new URL('./lockdown-test-site', import.meta.url).pathname;

describe('startFixtureServer', () => {
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer({ root: ROOT });
  });
  afterAll(async () => {
    await server.close();
  });

  it('listens on 127.0.0.1 with a random port', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.origin).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.url('/about/')).toBe(`${server.origin}/about/`);
  });

  it('serves index.html for directories with the right content type', async () => {
    const res = await fetch(server.url('/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain('Lockdown test page');
  });

  it('redirects a directory without a trailing slash', async () => {
    const res = await fetch(server.url('/about'), { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/about/');
  });

  it('returns 404 for missing files and refuses to leave the root', async () => {
    expect((await fetch(server.url('/nope.html'))).status).toBe(404);
    expect((await fetch(`${server.origin}/%2e%2e/server.ts`)).status).toBe(404);
    expect((await fetch(`${server.origin}/..%2f..%2fpackage.json`)).status).toBe(404);
  });

  /** Raw request with the path exactly as written (fetch would normalize it first). */
  function rawGet(rawPath: string): Promise<{ status: number; location: string | undefined }> {
    return new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: server.port, path: rawPath }, (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, location: res.headers.location });
        })
        .on('error', reject);
    });
  }

  it.each([
    '/.//platform-assets',
    '/about/..//platform-assets',
    '/%2Fplatform-assets',
    '/%2F/platform-assets',
    '//platform-assets',
    '/%5Cplatform-assets',
  ])('never issues a protocol-relative redirect for %s', async (rawPath) => {
    const res = await rawGet(rawPath);
    expect(res.status).toBe(404);
    expect(res.location).toBeUndefined();
  });

  it('builds directory redirects from the resolved path', async () => {
    expect(await rawGet('/platform-assets')).toEqual({
      status: 301,
      location: '/platform-assets/',
    });
    expect(await rawGet('/about/../platform-assets')).toEqual({
      status: 301,
      location: '/platform-assets/',
    });
    expect(await rawGet('/platform-assets/static.wixstatic.com')).toEqual({
      status: 301,
      location: '/platform-assets/static.wixstatic.com/',
    });
  });

  it('only allows GET and HEAD', async () => {
    expect((await fetch(server.url('/'), { method: 'POST' })).status).toBe(405);
    const head = await fetch(server.url('/'), { method: 'HEAD' });
    expect(head.status).toBe(200);
  });

  it('rejects a root that is not a directory', async () => {
    await expect(
      startFixtureServer({ root: new URL('./server.ts', import.meta.url).pathname }),
    ).rejects.toThrow(/not a directory/);
  });
});
