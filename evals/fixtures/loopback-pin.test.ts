import { isLoopbackHost as siteModelIsLoopbackHost } from '@srs/site-model/fixture-urls';
import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './network-policy';

// site-model cannot import from evals, so it carries its own copy of the loopback host check
// (ADR-010). This pins the two to the same behavior.
const HOSTS = [
  'localhost',
  'LOCALHOST',
  'localhost.',
  ' localhost ',
  '127.0.0.1',
  '127.0.0.1.',
  '127.255.255.255',
  '127.0.0.256',
  '127.0.0',
  '127.0.0.1.1',
  '127.a.0.1',
  '126.0.0.1',
  '128.0.0.1',
  '0.0.0.0',
  '10.0.0.1',
  '192.168.0.1',
  '::1',
  '[::1]',
  '[::2]',
  '::',
  '[::ffff:127.0.0.1]',
  '[::ffff:7f00:1]',
  'example.com',
  'localhost.example.com',
  '127.0.0.1.example.com',
  'foo.localhost',
  '',
];

describe('site-model isLoopbackHost matches evals isLoopbackHost', () => {
  it.each(HOSTS)('%j', (host) => {
    expect(siteModelIsLoopbackHost(host)).toBe(isLoopbackHost(host));
  });
});
