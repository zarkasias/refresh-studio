import { describe, expect, it } from 'vitest';
import { GuardError, type GuardErrorCode } from './errors';
import { assertCrawlAllowed } from './crawl';
import type { Project } from '../schemas/project';

function project(origin: string, extra: { pathPrefix?: string; maxPages?: number } = {}): Project {
  return {
    id: 'p1',
    clientName: 'Test',
    siteUrl: origin,
    createdAt: '2026-01-01T00:00:00.000Z',
    consent: {
      grantedBy: 'Owner',
      grantedAt: '2026-01-01T00:00:00.000Z',
      method: 'email',
      scope: { origin, maxPages: extra.maxPages ?? 25, pathPrefix: extra.pathPrefix },
    },
  };
}

function codeOf(fn: () => void): GuardErrorCode {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GuardError);
    const err = e as GuardError;
    expect(err.message.trim().length).toBeGreaterThan(10);
    expect(err.message).not.toMatch(
      /undefined|\[object|Zod|NaN|TypeError|origin|pathPrefix|href|URL/,
    );
    return err.code;
  }
  throw new Error('expected the guard to throw');
}

const salon = 'https://bellalagosalon.com';
const first = { pagesCrawledSoFar: 0 };

describe('assertCrawlAllowed', () => {
  it('allows a same-origin page', () => {
    expect(() => assertCrawlAllowed(project(salon), `${salon}/services?x=1`, first)).not.toThrow();
  });

  it('throws when consent is missing', () => {
    const p = { ...project(salon), consent: undefined };
    expect(codeOf(() => assertCrawlAllowed(p, `${salon}/`, first))).toBe('no-consent');
  });

  it('throws for a different website', () => {
    expect(
      codeOf(() => assertCrawlAllowed(project(salon), 'https://bellalagomedspa.com/', first)),
    ).toBe('cross-origin');
  });

  it.each([
    ['subdomain', 'https://www.bellalagosalon.com/'],
    ['scheme', 'http://bellalagosalon.com/'],
    ['port', 'https://bellalagosalon.com:8443/'],
  ])('treats a different %s as a different origin', (_n, url) => {
    expect(codeOf(() => assertCrawlAllowed(project(salon), url, first))).toBe('cross-origin');
  });

  it('throws for non-http(s) and unparseable URLs', () => {
    expect(
      codeOf(() => assertCrawlAllowed(project(salon), 'ftp://bellalagosalon.com/', first)),
    ).toBe('bad-url');
    expect(codeOf(() => assertCrawlAllowed(project(salon), 'javascript:alert(1)', first))).toBe(
      'bad-url',
    );
    expect(codeOf(() => assertCrawlAllowed(project(salon), 'not a url', first))).toBe('bad-url');
  });

  describe('pathPrefix', () => {
    const wix = 'https://jollyplumbingco.wixsite.com';
    const p = project(wix, { pathPrefix: '/jollyplumbing' });

    it('allows the prefix itself and pages beneath it', () => {
      expect(() => assertCrawlAllowed(p, `${wix}/jollyplumbing`, first)).not.toThrow();
      expect(() => assertCrawlAllowed(p, `${wix}/jollyplumbing/`, first)).not.toThrow();
      expect(() => assertCrawlAllowed(p, `${wix}/jollyplumbing/contact`, first)).not.toThrow();
    });

    it('throws for another business on the same wixsite host', () => {
      expect(codeOf(() => assertCrawlAllowed(p, `${wix}/otherbusiness`, first))).toBe(
        'outside-path',
      );
    });

    it('matches on a path-segment boundary', () => {
      expect(codeOf(() => assertCrawlAllowed(p, `${wix}/jollyplumbing2`, first))).toBe(
        'outside-path',
      );
    });

    it('does not let dot segments escape the prefix', () => {
      expect(
        codeOf(() => assertCrawlAllowed(p, `${wix}/jollyplumbing/../otherbusiness`, first)),
      ).toBe('outside-path');
    });
  });

  describe('page limit', () => {
    it('allows the 25th page and throws on the 26th', () => {
      const p = project(salon);
      expect(() => assertCrawlAllowed(p, `${salon}/a`, { pagesCrawledSoFar: 24 })).not.toThrow();
      expect(codeOf(() => assertCrawlAllowed(p, `${salon}/a`, { pagesCrawledSoFar: 25 }))).toBe(
        'page-limit',
      );
    });

    it('respects a lower consent maxPages', () => {
      const p = project(salon, { maxPages: 10 });
      expect(() => assertCrawlAllowed(p, `${salon}/a`, { pagesCrawledSoFar: 9 })).not.toThrow();
      expect(codeOf(() => assertCrawlAllowed(p, `${salon}/a`, { pagesCrawledSoFar: 10 }))).toBe(
        'page-limit',
      );
    });

    it('never allows more than 25 even if unvalidated consent says so', () => {
      const p = project(salon, { maxPages: 100 });
      expect(codeOf(() => assertCrawlAllowed(p, `${salon}/a`, { pagesCrawledSoFar: 25 }))).toBe(
        'page-limit',
      );
    });
  });

  describe('fails closed on bad data', () => {
    const withScope = (scope: unknown) => ({ consent: { scope } }) as unknown as Project;
    const bad = (maxPages: unknown) => withScope({ origin: salon, maxPages });

    it.each([[undefined], [Number.NaN], ['abc'], [0], [-1], [2.5], [Infinity]])(
      'blocks when maxPages is %s',
      (m) => {
        expect(codeOf(() => assertCrawlAllowed(bad(m), `${salon}/a`, first))).toBe('bad-consent');
      },
    );

    it.each([[Number.NaN], [undefined], [-1], [1.5], ['3']])(
      'blocks when pagesCrawledSoFar is %s',
      (n) => {
        const opts = { pagesCrawledSoFar: n } as unknown as { pagesCrawledSoFar: number };
        expect(codeOf(() => assertCrawlAllowed(project(salon), `${salon}/a`, opts))).toBe(
          'page-limit',
        );
      },
    );

    it('blocks when options are missing', () => {
      const missing = undefined as unknown as { pagesCrawledSoFar: number };
      expect(codeOf(() => assertCrawlAllowed(project(salon), `${salon}/a`, missing))).toBe(
        'page-limit',
      );
    });

    it.each([
      ['empty consent', { consent: {} }],
      ['garbage origin', withScope({ origin: 'nope', maxPages: 5 })],
      ['non-string origin', withScope({ origin: 5, maxPages: 5 })],
      ['bad prefix', withScope({ origin: salon, maxPages: 5, pathPrefix: 'x' })],
      ['missing scope', { consent: { grantedBy: 'x' } }],
    ])('throws a GuardError for malformed consent: %s', (_n, p) => {
      expect(codeOf(() => assertCrawlAllowed(p as unknown as Project, `${salon}/a`, first))).toBe(
        'bad-consent',
      );
    });

    it('explains a limit of one page without saying "scanned 0"', () => {
      const p = project(salon, { maxPages: 1 });
      expect(() => assertCrawlAllowed(p, `${salon}/a`, first)).not.toThrow();
      expect(() => assertCrawlAllowed(p, `${salon}/a`, { pagesCrawledSoFar: 1 })).toThrow(
        /1 page,/,
      );
    });

    it('does not contradict itself when the stored origin is not canonical', () => {
      const p = project('https://bellalagosalon.com/');
      try {
        assertCrawlAllowed(p, 'http://bellalagosalon.com/', first);
        throw new Error('expected throw');
      } catch (e) {
        expect((e as GuardError).code).toBe('cross-origin');
        expect((e as GuardError).message).not.toMatch(
          /different website \((.*)\) than the one we have permission to scan \(\1\)/,
        );
      }
    });

    it('blocks a stored origin that carries a path, so it cannot open a shared host', () => {
      const wix = 'https://jollyplumbingco.wixsite.com';
      const p = project(`${wix}/jollyplumbing`);
      expect(codeOf(() => assertCrawlAllowed(p, `${wix}/otherbusiness`, first))).toBe(
        'bad-consent',
      );
    });

    it.each([
      'https://jollyplumbingco.wixsite.com/jollyplumbing?x#y',
      'https://jollyplumbingco.wixsite.com?x',
      'https://jollyplumbingco.wixsite.com#y',
      'https://user:pw@bellalagosalon.com',
    ])('blocks a stored origin that is not bare: %s', (o) => {
      expect(codeOf(() => assertCrawlAllowed(project(o), `${o}/a`, first))).toBe('bad-consent');
    });

    it('allows a single trailing slash on the stored origin', () => {
      expect(() => assertCrawlAllowed(project(`${salon}/`), `${salon}/a`, first)).not.toThrow();
    });

    it('blocks a stored origin with a non-web scheme as bad consent, not cross-origin', () => {
      expect(
        codeOf(() =>
          assertCrawlAllowed(
            project('ftp://bellalagosalon.com'),
            'ftp://bellalagosalon.com/',
            first,
          ),
        ),
      ).toBe('bad-consent');
      expect(
        codeOf(() => assertCrawlAllowed(project('ftp://bellalagosalon.com'), `${salon}/`, first)),
      ).toBe('bad-consent');
    });

    it.each(['//', '/a//b', '/jolly//'])(
      'blocks a path prefix containing a double slash: %s',
      (pre) => {
        const p = project(salon, { pathPrefix: pre });
        expect(codeOf(() => assertCrawlAllowed(p, `${salon}/a`, first))).toBe('bad-consent');
      },
    );

    it('rejects addresses with a login name or password', () => {
      expect(
        codeOf(() =>
          assertCrawlAllowed(project(salon), 'https://user:pw@bellalagosalon.com/', first),
        ),
      ).toBe('bad-url');
    });

    it('rejects encoded slashes under a path prefix', () => {
      const wix = 'https://jollyplumbingco.wixsite.com';
      const p = project(wix, { pathPrefix: '/jollyplumbing' });
      for (const path of [
        '/jollyplumbing/..%2fother',
        '/jollyplumbing/..%5Cother',
        '/jollyplumbing/a%2Fb',
      ]) {
        expect(codeOf(() => assertCrawlAllowed(p, `${wix}${path}`, first))).toBe('outside-path');
      }
    });
  });

  it('uses plain wording for the main failures', () => {
    const msg = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        return (e as GuardError).message;
      }
      return '';
    };
    expect(msg(() => assertCrawlAllowed({}, `${salon}/`, first))).toMatchInlineSnapshot(
      `"We don't have the owner's permission to scan this site yet. Record their consent before running a scan."`,
    );
    expect(
      msg(() => assertCrawlAllowed(project(salon), 'https://bellalagomedspa.com/', first)),
    ).toMatchInlineSnapshot(
      `"This page is on a different website (bellalagomedspa.com) than the one we have permission to scan (bellalagosalon.com)."`,
    );
    expect(
      msg(() => assertCrawlAllowed(project(salon), `${salon}/a`, { pagesCrawledSoFar: 25 })),
    ).toMatchInlineSnapshot(
      `"We've already scanned 25 pages, which is the limit for this site. No more pages can be added to this scan."`,
    );
  });
});
