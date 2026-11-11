/**
 * Pure row <-> model mappers. Rows hold `Date`s and nulls; the model holds UTC ISO strings and
 * omitted optionals. Everything leaving the database is validated with the Zod schemas.
 */
import { ProjectSchema, type Project } from '../schemas/project';
import { SiteSchema, type Site } from '../schemas/site';
import { migrateSiteDoc, parseStoredSite } from '../migrations/site';
import { VariantSchema, type Variant } from '../schemas/variant';
import { AssetSchema, type Asset } from '../schemas/asset';
import {
  CaptureRunSchema,
  CapturedPageSchema,
  type CaptureRun,
  type CapturedPage,
} from '../schemas/capture';
import { AuditRunSchema, type AuditRun } from '../schemas/audit';
import { CommentSchema, type Comment } from '../schemas/comment';
import {
  AuditReportSchema,
  ReportDeliverySchema,
  ReportExportSchema,
  ReportVersionSchema,
  ShareLinkSchema,
  type AuditReport,
  type ReportDelivery,
  type ReportExport,
  type ReportVersion,
  type ShareLink,
} from '../schemas/report';
import { VersionSchema, type Version } from '../schemas/version';
import type {
  AssetRow,
  AuditReportRow,
  AuditRunRow,
  CapturedPageRow,
  CommentRow,
  CrawlRow,
  ProjectRow,
  ReportDeliveryRow,
  ReportExportRow,
  ReportVersionRow,
  ShareLinkRow,
  SiteRow,
  VariantRow,
  VersionRow,
  assets,
  auditReports,
  auditRuns,
  capturedPages,
  comments,
  crawls,
  projects,
  reportDeliveries,
  reportExports,
  reportVersions,
  shareLinks,
  sites,
  variants,
  versions,
} from './schema';

type Insert<T extends { $inferInsert: unknown }> = T['$inferInsert'];

const iso = (d: Date): string => d.toISOString();
const isoOrUndef = (d: Date | null): string | undefined => (d ? d.toISOString() : undefined);
const orUndef = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

// Project

export function projectToRow(project: Project): Insert<typeof projects> {
  const p = ProjectSchema.parse(project);
  const c = p.consent;
  return {
    id: p.id,
    clientName: p.clientName,
    siteUrl: p.siteUrl,
    createdAt: new Date(p.createdAt),
    consentGrantedBy: c?.grantedBy ?? null,
    consentGrantedAt: c ? new Date(c.grantedAt) : null,
    consentMethod: c?.method ?? null,
    consentOrigin: c?.scope.origin ?? null,
    consentPathPrefix: orNull(c?.scope.pathPrefix),
    consentMaxPages: c?.scope.maxPages ?? null,
    consentEvidenceAssetId: orNull(c?.evidenceAssetId),
  };
}

export function rowToProject(row: ProjectRow): Project {
  const hasConsent = row.consentGrantedBy !== null;
  return ProjectSchema.parse({
    id: row.id,
    clientName: row.clientName,
    siteUrl: row.siteUrl,
    createdAt: iso(row.createdAt),
    consent: hasConsent
      ? {
          grantedBy: row.consentGrantedBy,
          grantedAt: isoOrUndef(row.consentGrantedAt),
          method: row.consentMethod,
          scope: {
            origin: row.consentOrigin,
            pathPrefix: orUndef(row.consentPathPrefix),
            maxPages: row.consentMaxPages,
          },
          evidenceAssetId: orUndef(row.consentEvidenceAssetId),
        }
      : undefined,
  });
}

// Site

export function siteToRow(
  site: Site,
  timestamps: { createdAt: Date; updatedAt: Date },
): Insert<typeof sites> {
  const s = SiteSchema.parse(site);
  return {
    id: s.id,
    projectId: s.projectId,
    schemaVersion: s.schemaVersion,
    doc: s,
    ...timestamps,
  };
}

/**
 * The `doc` column is the source of truth; id, project_id and schema_version must agree with
 * it. Older docs are migrated on read (ADR-006); the row's schema_version is compared with the
 * version the doc was stored at.
 */
export function rowToSite(row: SiteRow): Site {
  const storedVersion = (row.doc as { schemaVersion?: unknown } | null)?.schemaVersion;
  const site = parseStoredSite(row.doc);
  if (
    site.id !== row.id ||
    site.projectId !== row.projectId ||
    storedVersion !== row.schemaVersion
  ) {
    throw new Error(`Site row ${row.id} disagrees with its doc (id, project_id or schema_version)`);
  }
  return site;
}

// Asset

export function assetToRow(asset: Asset): Insert<typeof assets> {
  const a = AssetSchema.parse(asset);
  return {
    id: a.id,
    siteId: a.siteId,
    kind: a.kind,
    sourceUrl: a.sourceUrl,
    storagePath: orNull(a.storagePath),
    width: orNull(a.width),
    height: orNull(a.height),
    bytes: orNull(a.bytes),
    alt: orNull(a.alt),
  };
}

export function rowToAsset(row: AssetRow): Asset {
  return AssetSchema.parse({
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    sourceUrl: row.sourceUrl,
    storagePath: orUndef(row.storagePath),
    width: orUndef(row.width),
    height: orUndef(row.height),
    bytes: orUndef(row.bytes),
    alt: orUndef(row.alt),
  });
}

// Variant

export function variantToRow(variant: Variant): Insert<typeof variants> {
  const v = VariantSchema.parse(variant);
  return {
    id: v.id,
    siteId: v.siteId,
    name: v.name,
    style: v.style,
    status: v.status,
    tokens: v.tokens,
    templates: v.templates,
  };
}

export function rowToVariant(row: VariantRow): Variant {
  return VariantSchema.parse({
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    style: row.style,
    tokens: row.tokens,
    templates: row.templates,
    status: row.status,
  });
}

// Version

export function versionToRow(version: Version): Insert<typeof versions> {
  const v = VersionSchema.parse(version);
  return {
    id: v.id,
    variantId: v.variantId,
    number: v.number,
    snapshot: v.snapshot,
    createdBy: v.createdBy,
    note: v.note,
    createdAt: new Date(v.createdAt),
    approvedAt: v.approvedAt ? new Date(v.approvedAt) : null,
    approvedBy: orNull(v.approvedBy),
  };
}

function migrateSnapshot(snapshot: unknown): unknown {
  if (typeof snapshot !== 'object' || snapshot === null) return snapshot;
  const s = snapshot as { site?: unknown };
  return { ...s, site: migrateSiteDoc(s.site) };
}

export function rowToVersion(row: VersionRow): Version {
  return VersionSchema.parse({
    id: row.id,
    variantId: row.variantId,
    number: row.number,
    // Snapshots of approved versions are frozen in the DB, so they are migrated on read.
    snapshot: migrateSnapshot(row.snapshot),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    note: row.note,
    approvedAt: isoOrUndef(row.approvedAt),
    approvedBy: orUndef(row.approvedBy),
  });
}

// Comment

export function commentToRow(comment: Comment): Insert<typeof comments> {
  const c = CommentSchema.parse(comment);
  return {
    id: c.id,
    versionId: c.versionId,
    sectionId: orNull(c.sectionId),
    x: orNull(c.x),
    y: orNull(c.y),
    author: c.author,
    body: c.body,
    resolved: c.resolved,
    createdAt: new Date(c.createdAt),
  };
}

export function rowToComment(row: CommentRow): Comment {
  return CommentSchema.parse({
    id: row.id,
    versionId: row.versionId,
    sectionId: orUndef(row.sectionId),
    x: orUndef(row.x),
    y: orUndef(row.y),
    author: row.author,
    body: row.body,
    resolved: row.resolved,
    createdAt: iso(row.createdAt),
  });
}

// Capture run (table `crawls`)

export function crawlToRow(run: CaptureRun): Insert<typeof crawls> {
  const r = CaptureRunSchema.parse(run);
  return {
    id: r.id,
    projectId: r.projectId,
    siteId: orNull(r.siteId),
    startUrl: r.startUrl,
    status: r.status,
    blockedReason: orNull(r.blockedReason),
    userAgent: r.userAgent,
    robots: r.robots,
    planned: r.planned,
    skipped: r.skipped,
    startedAt: new Date(r.startedAt),
    finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
  };
}

export function rowToCrawl(row: CrawlRow): CaptureRun {
  return CaptureRunSchema.parse({
    id: row.id,
    projectId: row.projectId,
    siteId: orUndef(row.siteId),
    startUrl: row.startUrl,
    status: row.status,
    blockedReason: orUndef(row.blockedReason),
    userAgent: row.userAgent,
    robots: row.robots,
    planned: row.planned,
    skipped: row.skipped,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrUndef(row.finishedAt),
  });
}

// Captured page

export function capturedPageToRow(page: CapturedPage): Insert<typeof capturedPages> {
  const p = CapturedPageSchema.parse(page);
  return {
    id: p.id,
    captureRunId: p.captureRunId,
    url: p.url,
    finalUrl: p.finalUrl,
    redirectChain: p.redirectChain,
    httpStatus: p.httpStatus,
    fetchedAt: new Date(p.fetchedAt),
    htmlAssetId: p.htmlAssetId,
    screenshotMobileAssetId: p.screenshots.mobile,
    screenshotDesktopAssetId: p.screenshots.desktop,
    facts: p.facts,
    axe: orNull(p.axe),
    pendingContent: p.pendingContent,
  };
}

export function rowToCapturedPage(row: CapturedPageRow): CapturedPage {
  return CapturedPageSchema.parse({
    id: row.id,
    captureRunId: row.captureRunId,
    url: row.url,
    finalUrl: row.finalUrl,
    redirectChain: row.redirectChain,
    httpStatus: row.httpStatus,
    fetchedAt: iso(row.fetchedAt),
    htmlAssetId: row.htmlAssetId,
    screenshots: {
      mobile: row.screenshotMobileAssetId,
      desktop: row.screenshotDesktopAssetId,
    },
    facts: row.facts,
    axe: orUndef(row.axe),
    pendingContent: row.pendingContent,
  });
}

// Audit run

export function auditRunToRow(run: AuditRun): Insert<typeof auditRuns> {
  const r = AuditRunSchema.parse(run);
  return {
    id: r.id,
    projectId: r.projectId,
    siteId: r.siteId,
    captureRunId: r.captureRunId,
    createdAt: new Date(r.createdAt),
    toolVersions: r.toolVersions,
    lighthouse: r.lighthouse,
    checks: r.checks,
    scores: r.scores,
    weightsVersion: r.weightsVersion,
  };
}

export function rowToAuditRun(row: AuditRunRow): AuditRun {
  return AuditRunSchema.parse({
    id: row.id,
    projectId: row.projectId,
    siteId: row.siteId,
    captureRunId: row.captureRunId,
    createdAt: iso(row.createdAt),
    toolVersions: row.toolVersions,
    lighthouse: row.lighthouse,
    checks: row.checks,
    scores: row.scores,
    weightsVersion: row.weightsVersion,
  });
}

// Audit report (table `audit_reports`)

export function auditReportToRow(report: AuditReport): Insert<typeof auditReports> {
  const r = AuditReportSchema.parse(report);
  return {
    id: r.id,
    projectId: r.projectId,
    auditRunId: r.auditRunId,
    createdAt: new Date(r.createdAt),
  };
}

export function rowToAuditReport(row: AuditReportRow): AuditReport {
  return AuditReportSchema.parse({
    id: row.id,
    projectId: row.projectId,
    auditRunId: row.auditRunId,
    createdAt: iso(row.createdAt),
  });
}

// Report version

export function reportVersionToRow(version: ReportVersion): Insert<typeof reportVersions> {
  const v = ReportVersionSchema.parse(version);
  return {
    id: v.id,
    reportId: v.reportId,
    number: v.number,
    doc: v.doc,
    createdBy: v.createdBy,
    note: v.note,
    createdAt: new Date(v.createdAt),
    approvedAt: v.approvedAt ? new Date(v.approvedAt) : null,
    approvedBy: orNull(v.approvedBy),
  };
}

export function rowToReportVersion(row: ReportVersionRow): ReportVersion {
  return ReportVersionSchema.parse({
    id: row.id,
    reportId: row.reportId,
    number: row.number,
    doc: row.doc,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    note: row.note,
    approvedAt: isoOrUndef(row.approvedAt),
    approvedBy: orUndef(row.approvedBy),
  });
}

// Share link

export function shareLinkToRow(link: ShareLink): Insert<typeof shareLinks> {
  const l = ShareLinkSchema.parse(link);
  return {
    id: l.id,
    reportId: l.reportId,
    tokenHash: l.tokenHash,
    createdAt: new Date(l.createdAt),
    expiresAt: new Date(l.expiresAt),
    revokedAt: l.revokedAt ? new Date(l.revokedAt) : null,
  };
}

export function rowToShareLink(row: ShareLinkRow): ShareLink {
  return ShareLinkSchema.parse({
    id: row.id,
    reportId: row.reportId,
    tokenHash: row.tokenHash,
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
    revokedAt: isoOrUndef(row.revokedAt),
  });
}

// Report export

export function reportExportToRow(exp: ReportExport): Insert<typeof reportExports> {
  const e = ReportExportSchema.parse(exp);
  return {
    id: e.id,
    reportVersionId: e.reportVersionId,
    kind: e.kind,
    storagePath: e.storagePath,
    sha256: e.sha256,
    createdAt: new Date(e.createdAt),
  };
}

export function rowToReportExport(row: ReportExportRow): ReportExport {
  return ReportExportSchema.parse({
    id: row.id,
    reportVersionId: row.reportVersionId,
    kind: row.kind,
    storagePath: row.storagePath,
    sha256: row.sha256,
    createdAt: iso(row.createdAt),
  });
}

// Report delivery

export function reportDeliveryToRow(delivery: ReportDelivery): Insert<typeof reportDeliveries> {
  const d = ReportDeliverySchema.parse(delivery);
  return {
    id: d.id,
    reportVersionId: d.reportVersionId,
    channel: d.channel,
    recipientName: d.recipientName,
    sentAt: new Date(d.sentAt),
  };
}

export function rowToReportDelivery(row: ReportDeliveryRow): ReportDelivery {
  return ReportDeliverySchema.parse({
    id: row.id,
    reportVersionId: row.reportVersionId,
    channel: row.channel,
    recipientName: row.recipientName,
    sentAt: iso(row.sentAt),
  });
}
