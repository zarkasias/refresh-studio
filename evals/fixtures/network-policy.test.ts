import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type PlatformAssetRule,
  contentTypeFor,
  isLoopbackHost,
  isLoopbackUrl,
  matchPlatformAsset,
  platformHost,
} from './network-policy';

const ROOT = path.resolve('/fixtures/site');

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', 'localhost.', '::1', '[::1]'])(
    'treats %s as loopback',
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );

  it.each([
    'example.com',
    '127.0.0.1.example.com',
    'localhost.example.com',
    '128.0.0.1',
    '127.0.0.256',
    '127.0.0',
    '0.0.0.0',
    '[::ffff:7f00:1]',
    '10.0.0.1',
    '',
  ])('treats %s as external', (host) => expect(isLoopbackHost(host)).toBe(false));

  it('checks URL hosts, failing closed on garbage', () => {
    expect(isLoopbackUrl('http://127.0.0.1:4000/a')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:4000/')).toBe(true);
    expect(isLoopbackUrl('https://static.wixstatic.com/x.png')).toBe(false);
    expect(isLoopbackUrl('http://user@127.0.0.1.evil.test/')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});

describe('matchPlatformAsset', () => {
  const rules = [platformHost('static.wixstatic.com')];

  it('maps a platform URL to a file under platform-assets/<host>/, ignoring the query', () => {
    expect(
      matchPlatformAsset('https://static.wixstatic.com/media/logo.png?w=200#x', rules, ROOT),
    ).toMatchObject({
      kind: 'file',
      file: path.join(ROOT, 'platform-assets', 'static.wixstatic.com', 'media', 'logo.png'),
    });
  });

  it('decodes percent-escapes in the path', () => {
    expect(matchPlatformAsset('https://static.wixstatic.com/a%20b.png', rules, ROOT)).toMatchObject(
      {
        kind: 'file',
        file: path.join(ROOT, 'platform-assets', 'static.wixstatic.com', 'a b.png'),
      },
    );
  });

  it('does not match other hosts or lookalikes', () => {
    for (const url of [
      'https://example.com/media/logo.png',
      'https://static.wixstatic.com.evil.test/x.png',
      'https://xstatic.wixstatic.com/x.png',
      'ftp://static.wixstatic.com/x.png',
    ]) {
      expect(matchPlatformAsset(url, rules, ROOT)).toEqual({ kind: 'unmatched' });
    }
  });

  it('refuses paths that would leave the fixture root', () => {
    for (const url of [
      'https://static.wixstatic.com/..%2f..%2f..%2fsecret',
      'https://static.wixstatic.com/%E0%A4%A',
      'https://static.wixstatic.com/a%00.png',
    ]) {
      expect(matchPlatformAsset(url, rules, ROOT)).toEqual({ kind: 'invalid' });
    }
  });

  it('refuses a rule whose target points outside the root', () => {
    const bad: PlatformAssetRule = { pattern: /^https:\/\/cdn\.test\/(.*)$/, target: '../$1' };
    expect(matchPlatformAsset('https://cdn.test/a.js', [bad], ROOT)).toEqual({ kind: 'invalid' });
    const abs: PlatformAssetRule = { pattern: /^https:\/\/cdn\.test\/(.*)$/, target: '/etc/$1' };
    expect(matchPlatformAsset('https://cdn.test/a.js', [abs], ROOT)).toEqual({ kind: 'invalid' });
  });

  it("keeps the file inside the rule's own folder, not just the fixture root", () => {
    // Decoded, this is platform-assets/static.wixstatic.com/../other-host/x.js: still in ROOT,
    // but outside the Wix folder, so it must be refused.
    expect(
      matchPlatformAsset('https://static.wixstatic.com/..%2fother-host%2fx.js', rules, ROOT),
    ).toEqual({ kind: 'invalid' });
    expect(matchPlatformAsset('https://static.wixstatic.com/media/a.js', rules, ROOT)).toEqual({
      kind: 'file',
      file: path.join(ROOT, 'platform-assets', 'static.wixstatic.com', 'media', 'a.js'),
      base: path.join(ROOT, 'platform-assets', 'static.wixstatic.com'),
    });
  });

  it('keeps dot-segments that the URL parser resolves inside the host folder', () => {
    expect(
      matchPlatformAsset('https://static.wixstatic.com/%2e%2e/%2e%2e/etc/passwd', rules, ROOT),
    ).toMatchObject({
      kind: 'file',
      file: path.join(ROOT, 'platform-assets', 'static.wixstatic.com', 'etc', 'passwd'),
    });
  });

  it('supports custom rules with capture groups, e.g. wp-content on any host', () => {
    const wp: PlatformAssetRule = {
      pattern: /^https?:\/\/[^/]+\/(wp-content\/.*)$/,
      target: 'platform-assets/wordpress/$1',
    };
    expect(
      matchPlatformAsset('https://shop.example/wp-content/themes/a/style.css', [wp], ROOT),
    ).toMatchObject({
      kind: 'file',
      file: path.join(
        ROOT,
        'platform-assets',
        'wordpress',
        'wp-content',
        'themes',
        'a',
        'style.css',
      ),
    });
  });

  it('requires a whole-string match and ignores g/y flag state', () => {
    const partial: PlatformAssetRule = { pattern: /squarespace-cdn\.com/g, target: 'x' };
    expect(matchPlatformAsset('https://images.squarespace-cdn.com/a.png', [partial], ROOT)).toEqual(
      { kind: 'unmatched' },
    );
    const sticky: PlatformAssetRule = { pattern: /^https:\/\/cdn\.test\/(.*)$/g, target: 'c/$1' };
    const a = matchPlatformAsset('https://cdn.test/a.js', [sticky], ROOT);
    const b = matchPlatformAsset('https://cdn.test/a.js', [sticky], ROOT);
    expect(a).toEqual(b);
    expect(a.kind).toBe('file');
  });

  it('uses the first matching rule', () => {
    const first: PlatformAssetRule = { pattern: /^https:\/\/cdn\.test\/(.*)$/, target: 'one/$1' };
    const second: PlatformAssetRule = { pattern: /^https:\/\/cdn\.test\/(.*)$/, target: 'two/$1' };
    expect(matchPlatformAsset('https://cdn.test/a.js', [first, second], ROOT)).toMatchObject({
      kind: 'file',
      file: path.join(ROOT, 'one', 'a.js'),
    });
  });
});

describe('contentTypeFor', () => {
  it('maps common extensions and falls back to octet-stream', () => {
    expect(contentTypeFor('a/index.HTML')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('logo.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('font.woff2')).toBe('font/woff2');
    expect(contentTypeFor('blob.bin')).toBe('application/octet-stream');
  });
});
