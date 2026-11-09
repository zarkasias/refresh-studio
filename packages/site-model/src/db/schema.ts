/**
 * Drizzle schema for the site model (ADR-003): the Site document lives in JSONB and the
 * records that need identity, ownership or lifecycle are relational tables.
 *
 * Conventions:
 * - Text primary keys (the model's IDs are any non-empty string).
 * - Enumerated columns are `text` + CHECK, not pg enums. The allowed values come from the Zod
 *   enums, so they cannot drift, and adding a value is a plain constraint swap in a migration
 *   rather than an `ALTER TYPE`.
 * - Timestamps are `timestamptz` read as `Date`; mappers convert with `toISOString()` (UTC).
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { AssetKindSchema } from '../schemas/asset';
import { CommentAuthorSchema } from '../schemas/comment';
import { ConsentMethodSchema, MAX_CRAWL_PAGES } from '../schemas/project';
import {
  VariantStatusSchema,
  VariantStyleSchema,
  APPROVAL_REQUIRED_STATUSES,
} from '../schemas/variant';
import type { DesignTokens } from '../schemas/tokens';
import type { Site } from '../schemas/site';
import type { VersionSnapshot } from '../schemas/version';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** `col IN ('a','b')` from a list of constants (values are our own enum members, not user input). */
const inList = (column: string, values: readonly string[]): SQL => {
  if (values.some((v) => v.includes("'"))) throw new Error('inList: value contains a quote');
  return sql.raw(`"${column}" IN (${values.map((v) => `'${v}'`).join(', ')})`);
};

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    clientName: text('client_name').notNull(),
    siteUrl: text('site_url').notNull(),
    createdAt: tstz('created_at').notNull(),
    // Consent (CLAUDE.md rules 5 and 6). All null = no consent recorded.
    consentGrantedBy: text('consent_granted_by'),
    consentGrantedAt: tstz('consent_granted_at'),
    consentMethod: text('consent_method'),
    consentOrigin: text('consent_origin'),
    consentPathPrefix: text('consent_path_prefix'),
    consentMaxPages: integer('consent_max_pages'),
    /** Not a FK: assets belong to a site, which belongs to this project (would be circular). */
    consentEvidenceAssetId: text('consent_evidence_asset_id'),
  },
  (t) => [
    check(
      'projects_consent_max_pages_range',
      sql`${t.consentMaxPages} IS NULL OR ${t.consentMaxPages} BETWEEN 1 AND ${sql.raw(String(MAX_CRAWL_PAGES))}`,
    ),
    check(
      'projects_consent_all_or_none',
      sql`(${t.consentGrantedBy} IS NULL AND ${t.consentGrantedAt} IS NULL AND ${t.consentMethod} IS NULL AND ${t.consentOrigin} IS NULL AND ${t.consentMaxPages} IS NULL AND ${t.consentPathPrefix} IS NULL AND ${t.consentEvidenceAssetId} IS NULL)
        OR (${t.consentGrantedBy} IS NOT NULL AND ${t.consentGrantedAt} IS NOT NULL AND ${t.consentMethod} IS NOT NULL AND ${t.consentOrigin} IS NOT NULL AND ${t.consentMaxPages} IS NOT NULL)`,
    ),
    check(
      'projects_consent_method_values',
      sql`${t.consentMethod} IS NULL OR ${inList('consent_method', ConsentMethodSchema.options)}`,
    ),
  ],
);

export const sites = pgTable(
  'sites',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    schemaVersion: integer('schema_version').notNull(),
    /** The full `Site` document. */
    doc: jsonb('doc').$type<Site>().notNull(),
    createdAt: tstz('created_at').notNull(),
    updatedAt: tstz('updated_at').notNull(),
  },
  (t) => [index('sites_project_id_idx').on(t.projectId)],
);

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    sourceUrl: text('source_url').notNull(),
    storagePath: text('storage_path'),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    alt: text('alt'),
  },
  (t) => [
    index('assets_site_id_idx').on(t.siteId),
    check('assets_kind_values', inList('kind', AssetKindSchema.options)),
    check('assets_width_positive', sql`${t.width} IS NULL OR ${t.width} > 0`),
    check('assets_height_positive', sql`${t.height} IS NULL OR ${t.height} > 0`),
    check('assets_bytes_nonnegative', sql`${t.bytes} IS NULL OR ${t.bytes} >= 0`),
  ],
);

export const variants = pgTable(
  'variants',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    style: text('style').notNull(),
    status: text('status').notNull(),
    tokens: jsonb('tokens').$type<DesignTokens>().notNull(),
    /** Section id -> template id. */
    templates: jsonb('templates').$type<Record<string, string>>().notNull(),
    approvedAt: tstz('approved_at'),
    approvedBy: text('approved_by'),
  },
  (t) => [
    index('variants_site_id_idx').on(t.siteId),
    check('variants_style_values', inList('style', VariantStyleSchema.options)),
    check('variants_status_values', inList('status', VariantStatusSchema.options)),
    // Rule 4, defense in depth: mirrors VariantSchema.
    check('variants_approved_by_nonempty', sql`${t.approvedBy} IS NULL OR ${t.approvedBy} <> ''`),
    check('variants_approval_pair', sql`(${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL)`),
    check(
      'variants_approval_required',
      sql`${t.status} NOT IN (${sql.raw(APPROVAL_REQUIRED_STATUSES.map((s) => `'${s}'`).join(', '))}) OR (${t.approvedAt} IS NOT NULL AND ${t.approvedBy} IS NOT NULL)`,
    ),
  ],
);

export const versions = pgTable(
  'versions',
  {
    id: text('id').primaryKey(),
    variantId: text('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'restrict' }),
    snapshot: jsonb('snapshot').$type<VersionSnapshot>().notNull(),
    createdBy: text('created_by').notNull(),
    note: text('note').notNull(),
    createdAt: tstz('created_at').notNull(),
  },
  (t) => [index('versions_variant_id_idx').on(t.variantId)],
);

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id')
      .notNull()
      .references(() => versions.id, { onDelete: 'restrict' }),
    /** A section id inside the site doc; not a FK because sections are JSONB. */
    sectionId: text('section_id'),
    x: doublePrecision('x'),
    y: doublePrecision('y'),
    author: text('author').notNull(),
    body: text('body').notNull(),
    resolved: boolean('resolved').notNull(),
    createdAt: tstz('created_at').notNull(),
  },
  (t) => [
    index('comments_version_id_idx').on(t.versionId),
    check('comments_author_values', inList('author', CommentAuthorSchema.options)),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type SiteRow = typeof sites.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type VariantRow = typeof variants.$inferSelect;
export type VersionRow = typeof versions.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
