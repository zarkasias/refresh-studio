import { MAX_CRAWL_PAGES, type Project, ProjectSchema } from '@srs/site-model';
import { isLoopbackHost } from './network-policy';

export interface FixtureProjectOptions {
  /** Restrict the consent scope to a path, e.g. a `*.wixsite.com/<slug>` style fixture. */
  pathPrefix?: string;
  /** Defaults to the crawl cap (25). */
  maxPages?: number;
}

/**
 * Site-model `UrlSchema` is `z.httpUrl()`, whose hostname rule needs a dotted domain with a
 * letter TLD, so it rejects `127.0.0.1` (and `localhost`). Until the site model accepts
 * loopback hosts, these two fields are the only ones allowed to fail validation here.
 */
const LOOPBACK_URL_PATHS = new Set(['siteUrl', 'consent.scope.origin']);

/**
 * A Project whose consent is `own-site`, scoped to `http://127.0.0.1:<port>` only, so
 * `assertCrawlAllowed` runs unchanged in tests and refuses anything off the fixture server.
 * Pure. Validated with `ProjectSchema`, except that a rejection of the loopback URLs themselves
 * (see `LOOPBACK_URL_PATHS`) is tolerated; any other schema issue throws.
 */
export function fixtureProject(port: number, options: FixtureProjectOptions = {}): Project {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`fixtureProject: invalid port ${String(port)}`);
  }
  const origin = `http://127.0.0.1:${port}`;
  const project: Project = {
    id: `fixture_${port}`,
    clientName: 'Fixture site',
    siteUrl: new URL(options.pathPrefix ?? '/', `${origin}/`).href,
    consent: {
      grantedBy: 'Chambers Consulting (local fixture)',
      grantedAt: '2026-11-09T00:00:00.000Z',
      method: 'own-site',
      scope: {
        origin,
        ...(options.pathPrefix !== undefined ? { pathPrefix: options.pathPrefix } : {}),
        maxPages: options.maxPages ?? MAX_CRAWL_PAGES,
      },
    },
    createdAt: '2026-11-09T00:00:00.000Z',
  };

  const result = ProjectSchema.safeParse(project);
  if (result.success) return result.data;
  const unexpected = result.error.issues.filter(
    (issue) => !LOOPBACK_URL_PATHS.has(issue.path.join('.')),
  );
  // Only tolerate the URL issues if the values really are what we meant: a bare loopback http
  // origin, and a siteUrl on that same origin.
  const loopbackOk = (() => {
    try {
      const o = new URL(origin);
      const site = new URL(project.siteUrl);
      return (
        o.origin === origin &&
        o.protocol === 'http:' &&
        isLoopbackHost(o.hostname) &&
        site.origin === origin &&
        site.username === '' &&
        site.password === '' &&
        site.search === '' &&
        site.hash === ''
      );
    } catch {
      return false;
    }
  })();
  if (!loopbackOk) {
    throw new Error(`fixtureProject: ${project.siteUrl} is not a plain loopback address`);
  }
  if (unexpected.length > 0) {
    throw new Error(
      `fixtureProject: invalid project: ${unexpected.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return project;
}
