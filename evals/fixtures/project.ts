import { MAX_CRAWL_PAGES, type Project } from '@srs/site-model';
import { FixtureProjectSchema } from '@srs/site-model/fixture-urls';

export interface FixtureProjectOptions {
  /** Restrict the consent scope to a path, e.g. a `*.wixsite.com/<slug>` style fixture. */
  pathPrefix?: string;
  /** Defaults to the crawl cap (25). */
  maxPages?: number;
}

/**
 * A Project whose consent is `own-site`, scoped to `http://127.0.0.1:<port>` only, so
 * `assertCrawlAllowed` runs unchanged in tests and refuses anything off the fixture server.
 * Pure. Validated in full with `FixtureProjectSchema` (ADR-010): the same rules as `ProjectSchema`
 * except that loopback `http:` URLs are accepted. Any schema issue throws.
 */
export function fixtureProject(port: number, options: FixtureProjectOptions = {}): Project {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`fixtureProject: invalid port ${String(port)}`);
  }
  const origin = `http://127.0.0.1:${port}`;
  const siteUrl = new URL(options.pathPrefix ?? '/', `${origin}/`);
  // Not a loopback check (the schema does that). siteUrl must be exactly the prefix on the fixture
  // origin: `//evil.example` would become a public host, `/a?x=1` and `/a#x` would carry a query
  // or hash, and `/a/../b` or `/%2e%2e/evil` would resolve to a different path, so the consent
  // scope and the start URL would disagree and `assertCrawlAllowed` would refuse its own project.
  const wanted = options.pathPrefix ?? '/';
  if (
    siteUrl.origin !== origin ||
    siteUrl.pathname !== wanted ||
    siteUrl.search !== '' ||
    siteUrl.hash !== ''
  ) {
    throw new Error(
      `fixtureProject: pathPrefix ${String(options.pathPrefix)} is not a plain path on ${origin}`,
    );
  }
  const project: Project = {
    id: `fixture_${port}`,
    clientName: 'Fixture site',
    siteUrl: siteUrl.href,
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

  const result = FixtureProjectSchema.safeParse(project);
  if (!result.success) {
    throw new Error(
      `fixtureProject: invalid project: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data;
}
