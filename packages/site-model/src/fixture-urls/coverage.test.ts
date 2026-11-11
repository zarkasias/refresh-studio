/**
 * Every schema exported from `../schemas` whose tree contains the strict URL or origin schema must
 * have a `Fixture*` twin built from the same factory (ADR-010). A new URL-bearing schema that
 * forgets its twin fails here. Walks Zod internals (`_zod.def`), which is fine in a test.
 */
import { describe, expect, it } from 'vitest';
import * as schemas from '../schemas';
import { OriginSchema, UrlSchema } from '../schemas';
import * as fixtures from './index';

type Node = { _zod: { def: object } };

function isSchema(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && '_zod' in value;
}

/** Every schema reachable from `root`, including `root`. */
function reachable(root: Node): Set<Node> {
  const seen = new Set<Node>();
  const visit = (node: Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const walkValue = (v: unknown): void => {
      if (isSchema(v)) visit(v);
      else if (Array.isArray(v)) v.forEach(walkValue);
      else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walkValue);
    };
    walkValue(Object.values(node._zod.def));
  };
  visit(root);
  return seen;
}

function containsStrictUrl(root: Node): boolean {
  const all = reachable(root);
  return all.has(UrlSchema as unknown as Node) || all.has(OriginSchema as unknown as Node);
}

const exportsOf = (ns: Record<string, unknown>) =>
  Object.entries(ns).filter((entry): entry is [string, Node] => isSchema(entry[1]));

/** Strict exports that hold URLs but are deliberately without a fixture twin. */
const ALLOWLIST: readonly string[] = [];

describe('fixture variants cover every URL-bearing schema', () => {
  it('sanity: the walker finds UrlSchema inside ProjectSchema and OriginSchema inside ConsentScope', () => {
    expect(containsStrictUrl(schemas.ProjectSchema as unknown as Node)).toBe(true);
    expect(
      reachable(schemas.ConsentScopeSchema as unknown as Node).has(OriginSchema as unknown as Node),
    ).toBe(true);
    expect(containsStrictUrl(schemas.IdSchema as unknown as Node)).toBe(false);
  });

  it('sanity: it sees through arrays, unions, optionals and records', () => {
    expect(containsStrictUrl(schemas.CaptureRunSchema as unknown as Node)).toBe(true); // array + optional
    expect(containsStrictUrl(schemas.VersionSchema as unknown as Node)).toBe(true); // via Site
    expect(containsStrictUrl(schemas.AuditRunSchema as unknown as Node)).toBe(true); // via CheckResult
  });

  const urlBearing = exportsOf(schemas).filter(([, schema]) => containsStrictUrl(schema));

  it('finds a healthy number of URL-bearing exports', () => {
    expect(urlBearing.length).toBeGreaterThan(20);
  });

  it.each(urlBearing.map(([name]) => name))('%s has a Fixture twin', (name) => {
    if (ALLOWLIST.includes(name)) return;
    const twin = (fixtures as Record<string, unknown>)[`Fixture${name}`];
    expect(isSchema(twin), `export Fixture${name} from fixture-urls/index.ts`).toBe(true);
  });

  it('no Fixture twin contains the strict URL or origin instance', () => {
    const leaks = exportsOf(fixtures)
      .filter(([name]) => name.startsWith('Fixture'))
      .filter(([, schema]) => containsStrictUrl(schema))
      .map(([name]) => name);
    expect(leaks).toEqual([]);
  });

  it('every Fixture twin names a real strict export', () => {
    const strictNames = new Set(exportsOf(schemas).map(([name]) => name));
    const orphans = exportsOf(fixtures)
      .map(([name]) => name)
      .filter((name) => name.startsWith('Fixture') && !name.startsWith('FixtureUrl'))
      .filter((name) => !name.startsWith('FixtureOrigin'))
      .filter((name) => !strictNames.has(name.slice('Fixture'.length)));
    expect(orphans).toEqual([]);
  });
});
