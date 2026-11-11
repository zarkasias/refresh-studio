/**
 * Report records (M1 plan section 2c, ADR-008). A report is the consultant-approved wording of an
 * AuditRun. It follows ADR-005: approval belongs to a ReportVersion, an approved version is frozen,
 * and a share link shows the newest approved version. Scores are copied from the AuditRun and
 * cannot be typed in (CLAUDE.md rule 2).
 */
import { z } from 'zod';
import { ScoresSchema } from './audit';
import { IdSchema, IsoDateTimeSchema, UrlSchema } from './primitives';

export const MAX_FIX_NOW = 5;

/** Lowercase hex of a SHA-256 digest. */
export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Expected a lowercase SHA-256 hex digest');

/**
 * `sentence` and `whyItMatters` are editable report copy, so a draft may hold an empty string.
 * Approval rejects blank wording with `empty-copy` (see ADR-008).
 */
export const ReportFindingSchema = z.strictObject({
  findingId: IdSchema,
  sentence: z.string(),
  whyItMatters: z.string(),
  pageUrl: UrlSchema,
  /** Assets of kind 'screenshot' (cropped, outlined). Empty when crops are toggled off. */
  annotationAssetIds: z.array(IdSchema),
});
export type ReportFinding = z.infer<typeof ReportFindingSchema>;

/** A finding the consultant judged a false positive. Recorded on the version (D5). */
export const DismissedFindingSchema = z.strictObject({
  findingId: IdSchema,
  reason: z.string().min(1),
  dismissedAt: IsoDateTimeSchema,
});
export type DismissedFinding = z.infer<typeof DismissedFindingSchema>;

export const DraftSourceSchema = z.enum(['auditor-agent', 'template']);
export type DraftSource = z.infer<typeof DraftSourceSchema>;

export const ReportDocSchema = z.strictObject({
  businessName: z.string().min(1),
  siteUrl: UrlSchema,
  auditedAt: IsoDateTimeSchema,
  /** Must equal `recomputeScores(auditRun, dismissed ids)`; checked by `assertReportApprovable`. */
  scores: ScoresSchema,
  /** Editable report copy; may be empty in a draft. */
  summary: z.string(),
  /** One or two lines of editable copy. */
  whatsWorking: z.array(z.string()).min(1).max(2),
  fixNow: z.array(ReportFindingSchema).max(MAX_FIX_NOW),
  canWait: z.array(ReportFindingSchema),
  dismissed: z.array(DismissedFindingSchema),
  draftSource: DraftSourceSchema,
});
export type ReportDoc = z.infer<typeof ReportDocSchema>;

/** The report's relational row: which AuditRun it explains. Its content lives in versions. */
export const AuditReportSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  auditRunId: IdSchema,
  createdAt: IsoDateTimeSchema,
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

export const ReportVersionObjectSchema = z.strictObject({
  id: IdSchema,
  reportId: IdSchema,
  /** 1, 2, 3, ... per report, in creation order; unique within the report (ADR-005). */
  number: z.int().min(1),
  doc: ReportDocSchema,
  createdBy: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  /** Free text; may be empty. */
  note: z.string(),
  /** Set once by the consultant approval step (CLAUDE.md rule 4). Never cleared. */
  approvedAt: IsoDateTimeSchema.optional(),
  approvedBy: z.string().min(1).optional(),
});

/** ReportVersion with its invariants: the approval pair, and `approvedAt >= createdAt`. */
export const ReportVersionSchema = ReportVersionObjectSchema.superRefine((version, ctx) => {
  const hasAt = version.approvedAt !== undefined;
  const hasBy = version.approvedBy !== undefined;
  if (hasAt !== hasBy) {
    ctx.addIssue({
      code: 'custom',
      message: 'approvedAt and approvedBy must be set together',
      path: [hasAt ? 'approvedBy' : 'approvedAt'],
    });
  }
  if (version.approvedAt !== undefined && version.approvedAt < version.createdAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'approvedAt cannot be earlier than createdAt',
      path: ['approvedAt'],
    });
  }
});
export type ReportVersion = z.infer<typeof ReportVersionSchema>;

/** True when the consultant approved this version (both approval fields present). */
export function isApprovedReportVersion(
  version: Pick<ReportVersion, 'approvedAt' | 'approvedBy'>,
): version is ReportVersion & { approvedAt: string; approvedBy: string } {
  return version.approvedAt !== undefined && version.approvedBy !== undefined;
}

export const ShareLinkObjectSchema = z.strictObject({
  id: IdSchema,
  reportId: IdSchema,
  /** SHA-256 of the token. The token itself is never stored. */
  tokenHash: Sha256HexSchema,
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.optional(),
});

/** ShareLink with its invariant: it expires after it was created (also a DB CHECK). */
export const ShareLinkSchema = ShareLinkObjectSchema.superRefine((link, ctx) => {
  if (link.expiresAt <= link.createdAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'expiresAt must be later than createdAt',
      path: ['expiresAt'],
    });
  }
});
export type ShareLink = z.infer<typeof ShareLinkSchema>;

export const ReportExportSchema = z.strictObject({
  id: IdSchema,
  reportVersionId: IdSchema,
  kind: z.literal('pdf'),
  storagePath: z.string().min(1),
  sha256: Sha256HexSchema,
  createdAt: IsoDateTimeSchema,
});
export type ReportExport = z.infer<typeof ReportExportSchema>;

export const DeliveryChannelSchema = z.enum(['email-pdf', 'share-link']);
export type DeliveryChannel = z.infer<typeof DeliveryChannelSchema>;

/** The consultant's "mark as sent". What the M1 gate counts. */
export const ReportDeliverySchema = z.strictObject({
  id: IdSchema,
  reportVersionId: IdSchema,
  channel: DeliveryChannelSchema,
  recipientName: z.string().min(1),
  sentAt: IsoDateTimeSchema,
});
export type ReportDelivery = z.infer<typeof ReportDeliverySchema>;
