/**
 * Site document migrations (ADR-003 consequence, ADR-006). Stored JSONB Sites and Version
 * snapshots are migrated to `SITE_SCHEMA_VERSION` on read, before validation, because strict
 * schemas reject old keys. Approved Version rows are frozen in the database (ADR-005), so their
 * snapshots are never rewritten; they are migrated each time they are read.
 *
 * Pure: input is not mutated.
 */
import { SITE_SCHEMA_VERSION, SiteSchema, type Site } from '../schemas/site';

/** A stored Site document that cannot be brought to the current schema version. */
export class SiteMigrationError extends Error {
  /** Dot path inside the document, e.g. `business.locations.0.address`. */
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'SiteMigrationError';
    this.path = path;
  }
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * v1 -> v2:
 * - `business.phone` -> `business.phones: [{ value }]`, `business.email` -> `business.emails`
 *   (empty strings are dropped; v1 allowed them).
 * - `business.locations[]` now needs `label` and `address`. A v1 location without them cannot
 *   be migrated without inventing data, so it throws `SiteMigrationError`.
 * Everything else in v1 is valid v2.
 */
function v1ToV2(doc: Json): Json {
  const business = isObject(doc.business) ? { ...doc.business } : doc.business;
  if (isObject(business)) {
    const { phone, email } = business;
    delete business.phone;
    delete business.email;
    if (typeof phone === 'string' && phone !== '') business.phones = [{ value: phone }];
    if (typeof email === 'string' && email !== '') business.emails = [{ value: email }];
    if (Array.isArray(business.locations)) {
      business.locations = business.locations.map((location: unknown, i) => {
        if (!isObject(location)) return location;
        for (const key of ['label', 'address'] as const) {
          const value = location[key];
          if (typeof value !== 'string' || value === '') {
            throw new SiteMigrationError(
              `business.locations.${i}.${key}`,
              `v2 locations need a ${key}; add it to the stored site by hand`,
            );
          }
        }
        return location;
      });
    }
  }
  return { ...doc, business, schemaVersion: 2 };
}

const STEPS: Record<number, (doc: Json) => Json> = { 1: v1ToV2 };

/**
 * Bring a stored Site document to the current schema version. Does not validate the result;
 * use `parseStoredSite` for that. Unknown or future versions are returned unchanged so that
 * validation reports them.
 */
export function migrateSiteDoc(doc: unknown): unknown {
  if (!isObject(doc)) return doc;
  let current = doc;
  while (typeof current.schemaVersion === 'number' && current.schemaVersion < SITE_SCHEMA_VERSION) {
    const step = STEPS[current.schemaVersion];
    if (!step) return current;
    current = step(current);
  }
  return current;
}

/** Migrate, then validate with `SiteSchema`. Throws `SiteMigrationError` or a ZodError. */
export function parseStoredSite(doc: unknown): Site {
  return SiteSchema.parse(migrateSiteDoc(doc));
}
