/**
 * Report guards (ADR-008, CLAUDE.md rules 2 and 4). Pure: no I/O. They take plain objects and
 * check the fields directly, because callers may pass data that was never schema-validated.
 */
import { SCORE_KEYS, type AuditRun, type Scores } from '../schemas/audit';
import { IsoDateTimeSchema } from '../schemas/primitives';
import {
  MAX_FIX_NOW,
  type AuditReport,
  type ReportDelivery,
  type ReportVersion,
  type ShareLink,
} from '../schemas/report';
import { recomputeScores } from '../scoring/recompute';
import { approveReportVersion, latestApprovedReportVersion } from '../versioning/report-history';
import { GuardError } from './errors';

type ApprovalFields = Pick<ReportVersion, 'approvedAt' | 'approvedBy'>;

function isApproved(version: Partial<ApprovalFields> | null | undefined): boolean {
  if (!version) return false;
  const { approvedAt, approvedBy } = version;
  return (
    IsoDateTimeSchema.safeParse(approvedAt).success &&
    typeof approvedBy === 'string' &&
    approvedBy.trim() !== ''
  );
}

const NOT_APPROVED =
  "This report hasn't been approved yet. Review and approve it before sharing it with the client.";

/** Throws unless the consultant approved this report version, so it is safe to show a client. */
export function assertReportShareable(version: Partial<ApprovalFields> | null | undefined): void {
  if (!isApproved(version)) throw new GuardError('not-approved', NOT_APPROVED);
}

/**
 * The newest approved version of a history, even when a newer draft exists (ADR-005, ADR-008).
 * Throws `not-approved` if nothing has been approved yet. Building block for
 * `resolveSharedReportVersion`; it does not check a share link, so callers serving a client use that.
 */
export function requireNewestApprovedReportVersion(
  history: readonly ReportVersion[],
): ReportVersion {
  const version = latestApprovedReportVersion(history);
  if (!version) throw new GuardError('not-approved', NOT_APPROVED);
  assertReportShareable(version);
  return version;
}

function sameScores(a: Scores, b: Scores): boolean {
  return SCORE_KEYS.every((key) => {
    const x: Scores[typeof key] | undefined = a[key];
    const y: Scores[typeof key] | undefined = b[key];
    if (!x || !y || x.value !== y.value || x.contributions.length !== y.contributions.length) {
      return false;
    }
    return x.contributions.every(
      (c, i) => c.source === y.contributions[i]?.source && c.delta === y.contributions[i]?.delta,
    );
  });
}

/**
 * Throws unless this report version may be approved (rule 2 and 4):
 * - at most 5 "fix now" items;
 * - every finding it mentions (fix now, can wait, dismissed) is a failed check in the AuditRun;
 * - no finding is both dismissed and listed;
 * - its scores equal the deterministic recomputation from the AuditRun and the dismissals;
 * - no finding appears twice, only failed checks can be listed or dismissed, and every failed
 *   check is accounted for (fix now, can wait or dismissed);
 * - the summary, "what's working" lines and every listed finding's wording are not blank
 *   (`note` is exempt).
 * It does not check approval state or "newest only"; `approveReportVersion` does. Callers
 * (T30) approve through `approveReport`, which runs both.
 */
export function assertReportApprovable(version: ReportVersion, auditRun: AuditRun): void {
  const { fixNow, canWait, dismissed, scores } = version.doc;

  if (fixNow.length > MAX_FIX_NOW) {
    throw new GuardError(
      'fix-now-limit',
      `A report can list at most ${MAX_FIX_NOW} things to fix now. Move the rest to "can wait".`,
    );
  }

  const known = new Set(auditRun.checks.filter((c) => !c.passed).map((c) => c.findingId));
  const mentioned = [...fixNow, ...canWait, ...dismissed].map((f) => f.findingId);
  const unknown = mentioned.find((id) => !known.has(id));
  if (unknown !== undefined) {
    throw new GuardError(
      'unknown-finding',
      `This report mentions a finding (${unknown}) that isn't one of the problems the audit found.`,
    );
  }

  const dismissedIds = new Set(dismissed.map((d) => d.findingId));
  const listedAndDismissed = [...fixNow, ...canWait].find((f) => dismissedIds.has(f.findingId));
  if (listedAndDismissed) {
    throw new GuardError(
      'dismissed-and-listed',
      `A finding (${listedAndDismissed.findingId}) is both dismissed and listed. Remove it from one of them.`,
    );
  }

  const seen = new Set<string>();
  for (const id of mentioned) {
    if (seen.has(id)) {
      throw new GuardError(
        'listed-twice',
        `A finding (${id}) appears more than once in this report.`,
      );
    }
    seen.add(id);
  }

  const unlisted = [...known].find((id) => !seen.has(id));
  if (unlisted !== undefined) {
    throw new GuardError(
      'unlisted-finding',
      `A problem the audit found (${unlisted}) isn't in the report. Put it under Fix now or Can wait, or dismiss it with a reason.`,
    );
  }

  if (!sameScores(scores, recomputeScores(auditRun, [...dismissedIds]))) {
    throw new GuardError(
      'scores-mismatch',
      "The scores in this report don't match the audit. Scores can't be edited by hand; dismiss a finding to change them.",
    );
  }

  const blank = (text: unknown) => typeof text !== 'string' || text.trim() === '';
  const emptyCopy =
    blank(version.doc.summary) ||
    version.doc.whatsWorking.some(blank) ||
    [...fixNow, ...canWait].some((f) => blank(f.sentence) || blank(f.whyItMatters));
  if (emptyCopy) {
    throw new GuardError(
      'empty-copy',
      'Some wording in this report is empty. Fill in the summary, the "what\'s working" lines and every finding before approving.',
    );
  }
}

/**
 * Throws unless the delivery points at this version, the version is approved, and it was not
 * sent before it was approved. "Mark as sent" is only for approved versions (rule 4).
 */
export function assertDeliverable(
  delivery: Pick<ReportDelivery, 'reportVersionId' | 'sentAt'>,
  version: Pick<ReportVersion, 'id'> & Partial<ApprovalFields>,
): void {
  if (delivery.reportVersionId !== version.id) {
    throw new GuardError(
      'delivery-mismatch',
      'This delivery is recorded against a different version of the report.',
    );
  }
  if (!isApproved(version)) {
    throw new GuardError(
      'not-approved',
      "This report hasn't been approved yet. Approve it before marking it as sent.",
    );
  }
  if (version.approvedAt !== undefined && delivery.sentAt < version.approvedAt) {
    throw new GuardError(
      'sent-before-approval',
      'This report cannot have been sent before it was approved.',
    );
  }
}

/**
 * The consultant approval step for a report (rule 4). Checks that `report` is the report this
 * history belongs to and was built from `auditRun`, approves the version through
 * `approveReportVersion` (newest only, once), then runs `assertReportApprovable` on it. Returns the
 * approved copy; the caller persists it. T30 must approve through this, not the lower-level
 * `approveReportVersion` alone.
 */
export function approveReport(
  history: readonly ReportVersion[],
  versionId: string,
  approval: { approvedBy: string; approvedAt: string },
  report: Pick<AuditReport, 'id' | 'auditRunId'>,
  auditRun: AuditRun,
): ReportVersion {
  const target = history.find((v) => v.id === versionId);
  if (target && target.reportId !== report.id) {
    throw new GuardError('report-mismatch', 'This version belongs to a different report.');
  }
  if (report.auditRunId !== auditRun.id) {
    throw new GuardError(
      'report-mismatch',
      'This report was written from a different audit than the one provided.',
    );
  }
  const approved = approveReportVersion(history, versionId, approval);
  assertReportApprovable(approved, auditRun);
  return approved;
}

/**
 * The version a client opens through a share link at time `now` (ISO datetime): the newest
 * approved version of the link's report. Throws `link-mismatch` if the link or history is for
 * another report, `link-revoked` or `link-expired` (T31 shows "This link has expired" for both),
 * and `not-approved` if nothing is approved yet.
 */
export function resolveSharedReportVersion(
  link: Pick<ShareLink, 'reportId' | 'expiresAt' | 'revokedAt'>,
  history: readonly ReportVersion[],
  now: string,
): ReportVersion {
  if (history.some((v) => v.reportId !== link.reportId)) {
    throw new GuardError('link-mismatch', "This link doesn't belong to this report.");
  }
  if (link.revokedAt !== undefined && link.revokedAt <= now) {
    throw new GuardError('link-revoked', 'This link has expired.');
  }
  if (link.expiresAt <= now) throw new GuardError('link-expired', 'This link has expired.');
  return requireNewestApprovedReportVersion(history);
}
