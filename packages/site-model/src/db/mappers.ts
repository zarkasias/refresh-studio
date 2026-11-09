/**
 * Pure row <-> model mappers. Rows hold `Date`s and nulls; the model holds UTC ISO strings and
 * omitted optionals. Everything leaving the database is validated with the Zod schemas.
 */
import { ProjectSchema, type Project } from '../schemas/project';
import { SiteSchema, type Site } from '../schemas/site';
import { migrateSiteDoc, parseStoredSite } from '../migrations/site';
import { VariantSchema, type Variant } from '../schemas/variant';
import { AssetSchema, type Asset } from '../schemas/asset';
import { CommentSchema, type Comment } from '../schemas/comment';
import { VersionSchema, type Version } from '../schemas/version';
import type {
  AssetRow,
  CommentRow,
  ProjectRow,
  SiteRow,
  VariantRow,
  VersionRow,
  assets,
  comments,
  projects,
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
