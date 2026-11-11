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
  unique,
} from 'drizzle-orm/pg-core';
import { AssetKindSchema } from '../schemas/asset';
import type { CheckResult, LighthouseSummary, Scores } from '../schemas/audit';
import {
  CaptureStatusSchema,
  type AxeSummary,
  type PageFacts,
  type RobotsInfo,
  type SkippedUrl,
} from '../schemas/capture';
import { CommentAuthorSchema } from '../schemas/comment';
import { ConsentMethodSchema, MAX_CRAWL_PAGES } from '../schemas/project';
import { DeliveryChannelSchema, type ReportDoc } from '../schemas/report';
import { VariantStatusSchema, VariantStyleSchema } from '../schemas/variant';
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
    // Approval lives on versions, not here (ADR-005).
  },
  (t) => [
    index('variants_site_id_idx').on(t.siteId),
    check('variants_style_values', inList('style', VariantStyleSchema.options)),
    check('variants_status_values', inList('status', VariantStatusSchema.options)),
  ],
);

export const versions = pgTable(
  'versions',
  {
    id: text('id').primaryKey(),
    variantId: text('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'restrict' }),
    /** 1, 2, 3, ... per variant (ADR-005). */
    number: integer('number').notNull(),
    snapshot: jsonb('snapshot').$type<VersionSnapshot>().notNull(),
    createdBy: text('created_by').notNull(),
    note: text('note').notNull(),
    createdAt: tstz('created_at').notNull(),
    /** Consultant approval (rule 4). Set once; the trigger in migration 0002 freezes the row. */
    approvedAt: tstz('approved_at'),
    approvedBy: text('approved_by'),
  },
  (t) => [
    index('versions_variant_id_idx').on(t.variantId),
    unique('versions_variant_number_unique').on(t.variantId, t.number),
    check('versions_number_positive', sql`${t.number} >= 1`),
    // Rule 4, defense in depth: mirrors VersionSchema.
    check('versions_approved_by_nonempty', sql`${t.approvedBy} IS NULL OR ${t.approvedBy} <> ''`),
    check('versions_approval_pair', sql`(${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL)`),
    check(
      'versions_approved_after_created',
      sql`${t.approvedAt} IS NULL OR ${t.approvedAt} >= ${t.createdAt}`,
    ),
  ],
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

export const crawls = pgTable(
  'crawls',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Optional: set once capture has produced a Site. */
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    startUrl: text('start_url').notNull(),
    status: text('status').notNull(),
    /** A GuardErrorCode, 'robots-disallowed' or 'bot-challenge'; validated by the mapper. */
    blockedReason: text('blocked_reason'),
    userAgent: text('user_agent').notNull(),
    robots: jsonb('robots').$type<RobotsInfo>().notNull(),
    planned: jsonb('planned').$type<string[]>().notNull(),
    skipped: jsonb('skipped').$type<SkippedUrl[]>().notNull(),
    startedAt: tstz('started_at').notNull(),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    index('crawls_project_id_idx').on(t.projectId),
    check('crawls_status_values', inList('status', CaptureStatusSchema.options)),
    check(
      'crawls_planned_max',
      sql`jsonb_typeof(${t.planned}) = 'array' AND jsonb_array_length(${t.planned}) <= ${sql.raw(String(MAX_CRAWL_PAGES))}`,
    ),
    check(
      'crawls_finished_after_started',
      sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`,
    ),
  ],
);

export const capturedPages = pgTable(
  'captured_pages',
  {
    id: text('id').primaryKey(),
    /** Cascades via the crawl, which cascades from the project. */
    captureRunId: text('capture_run_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    finalUrl: text('final_url').notNull(),
    redirectChain: jsonb('redirect_chain').$type<string[]>().notNull(),
    httpStatus: integer('http_status').notNull(),
    fetchedAt: tstz('fetched_at').notNull(),
    /** Not FKs: assets belong to a site, which may not exist when the page is captured. */
    htmlAssetId: text('html_asset_id').notNull(),
    screenshotMobileAssetId: text('screenshot_mobile_asset_id').notNull(),
    screenshotDesktopAssetId: text('screenshot_desktop_asset_id').notNull(),
    facts: jsonb('facts').$type<{ mobile: PageFacts; desktop: PageFacts }>().notNull(),
    axe: jsonb('axe').$type<{ mobile: AxeSummary; desktop: AxeSummary }>(),
    pendingContent: jsonb('pending_content')
      .$type<{ selector: string; placeholderText: string }[]>()
      .notNull(),
  },
  (t) => [
    index('captured_pages_capture_run_id_idx').on(t.captureRunId),
    unique('captured_pages_run_url_unique').on(t.captureRunId, t.url),
    check('captured_pages_http_status_range', sql`${t.httpStatus} BETWEEN 100 AND 599`),
  ],
);

// Audit and report records (ADR-008)

export const auditRuns = pgTable(
  'audit_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    captureRunId: text('capture_run_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    createdAt: tstz('created_at').notNull(),
    toolVersions: jsonb('tool_versions')
      .$type<{ lighthouse: string; axe: string; audit: string }>()
      .notNull(),
    lighthouse: jsonb('lighthouse').$type<LighthouseSummary[]>().notNull(),
    checks: jsonb('checks').$type<CheckResult[]>().notNull(),
    scores: jsonb('scores').$type<Scores>().notNull(),
    weightsVersion: text('weights_version').notNull(),
  },
  (t) => [
    index('audit_runs_project_id_idx').on(t.projectId),
    index('audit_runs_capture_run_id_idx').on(t.captureRunId),
  ],
);

export const auditReports = pgTable(
  'audit_reports',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    auditRunId: text('audit_run_id')
      .notNull()
      .references(() => auditRuns.id, { onDelete: 'cascade' }),
    createdAt: tstz('created_at').notNull(),
  },
  (t) => [
    index('audit_reports_project_id_idx').on(t.projectId),
    index('audit_reports_audit_run_id_idx').on(t.auditRunId),
  ],
);

export const reportVersions = pgTable(
  'report_versions',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id')
      .notNull()
      .references(() => auditReports.id, { onDelete: 'restrict' }),
    /** 1, 2, 3, ... per report (ADR-005, ADR-008). */
    number: integer('number').notNull(),
    doc: jsonb('doc').$type<ReportDoc>().notNull(),
    createdBy: text('created_by').notNull(),
    note: text('note').notNull(),
    createdAt: tstz('created_at').notNull(),
    /** Consultant approval (rule 4). Set once; the trigger in migration 0005 freezes the row. */
    approvedAt: tstz('approved_at'),
    approvedBy: text('approved_by'),
  },
  (t) => [
    index('report_versions_report_id_idx').on(t.reportId),
    unique('report_versions_report_number_unique').on(t.reportId, t.number),
    check('report_versions_number_positive', sql`${t.number} >= 1`),
    check(
      'report_versions_approved_by_nonempty',
      sql`${t.approvedBy} IS NULL OR ${t.approvedBy} <> ''`,
    ),
    check(
      'report_versions_approval_pair',
      sql`(${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL)`,
    ),
    check(
      'report_versions_approved_after_created',
      sql`${t.approvedAt} IS NULL OR ${t.approvedAt} >= ${t.createdAt}`,
    ),
  ],
);

export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    reportId: text('report_id')
      .notNull()
      .references(() => auditReports.id, { onDelete: 'cascade' }),
    /** SHA-256 hex of the token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    createdAt: tstz('created_at').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    index('share_links_report_id_idx').on(t.reportId),
    unique('share_links_token_hash_unique').on(t.tokenHash),
    check('share_links_token_hash_sha256', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('share_links_expires_after_created', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const reportExports = pgTable(
  'report_exports',
  {
    id: text('id').primaryKey(),
    reportVersionId: text('report_version_id')
      .notNull()
      .references(() => reportVersions.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    storagePath: text('storage_path').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: tstz('created_at').notNull(),
  },
  (t) => [
    index('report_exports_report_version_id_idx').on(t.reportVersionId),
    check('report_exports_kind_values', inList('kind', ['pdf'])),
    check('report_exports_sha256_hex', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const reportDeliveries = pgTable(
  'report_deliveries',
  {
    id: text('id').primaryKey(),
    reportVersionId: text('report_version_id')
      .notNull()
      .references(() => reportVersions.id, { onDelete: 'restrict' }),
    channel: text('channel').notNull(),
    recipientName: text('recipient_name').notNull(),
    sentAt: tstz('sent_at').notNull(),
  },
  (t) => [
    index('report_deliveries_report_version_id_idx').on(t.reportVersionId),
    check('report_deliveries_channel_values', inList('channel', DeliveryChannelSchema.options)),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type SiteRow = typeof sites.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type VariantRow = typeof variants.$inferSelect;
export type VersionRow = typeof versions.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type CrawlRow = typeof crawls.$inferSelect;
export type CapturedPageRow = typeof capturedPages.$inferSelect;
export type AuditRunRow = typeof auditRuns.$inferSelect;
export type AuditReportRow = typeof auditReports.$inferSelect;
export type ReportVersionRow = typeof reportVersions.$inferSelect;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
export type ReportExportRow = typeof reportExports.$inferSelect;
export type ReportDeliveryRow = typeof reportDeliveries.$inferSelect;
