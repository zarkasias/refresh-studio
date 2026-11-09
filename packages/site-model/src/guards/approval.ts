import { IsoDateTimeSchema } from '../schemas/primitives';
import { APPROVAL_REQUIRED_STATUSES, type Variant, type VariantStatus } from '../schemas/variant';
import type { Version } from '../schemas/version';
import { latestApprovedVersion } from '../versioning/history';
import { GuardError } from './errors';

type ApprovalFields = Pick<Version, 'approvedAt' | 'approvedBy'>;

/** Checks the fields directly because callers may pass data that was never schema-validated. */
function isApproved(version: Partial<ApprovalFields> | null | undefined): boolean {
  if (!version) return false;
  const { approvedAt, approvedBy } = version;
  return (
    IsoDateTimeSchema.safeParse(approvedAt).success &&
    typeof approvedBy === 'string' &&
    approvedBy.trim() !== ''
  );
}

const NOT_APPROVED_SHARE =
  "This design hasn't been approved yet. Review and approve it before sharing it with the client.";

/** Throws unless the consultant approved this version, so it is safe to show a client (rule 4). */
export function assertShareable(version: Partial<ApprovalFields> | null | undefined): void {
  if (!isApproved(version)) throw new GuardError('not-approved', NOT_APPROVED_SHARE);
}

/**
 * The version a client share link shows: the newest approved version, even when newer
 * unapproved edits exist (ADR-005). Throws if nothing has been approved yet.
 */
export function resolveSharedVersion(history: readonly Version[]): Version {
  const version = latestApprovedVersion(history);
  if (!version) throw new GuardError('not-approved', NOT_APPROVED_SHARE);
  assertShareable(version);
  return version;
}

/** Throws unless an approved version exists for statuses that need one (rule 4). */
export function assertStatusAllowed(status: VariantStatus, history: readonly Version[]): void {
  if (APPROVAL_REQUIRED_STATUSES.includes(status) && !latestApprovedVersion(history)) {
    throw new GuardError(
      'not-approved',
      "This design hasn't been approved yet. Review and approve it before moving it forward.",
    );
  }
}

/**
 * Throws unless the client picked this variant and it has an approved version. Returns the
 * version to export: the newest approved one.
 */
export function assertExportable(
  variant: Pick<Variant, 'status'>,
  history: readonly Version[],
): Version {
  const version = latestApprovedVersion(history);
  if (!version || !isApproved(version)) {
    throw new GuardError(
      'not-approved',
      "This design hasn't been approved yet. Review and approve it before exporting it.",
    );
  }
  if (variant.status !== 'selected') {
    throw new GuardError(
      'not-selected',
      "The client hasn't chosen this design yet. Mark it as their selected design before exporting it.",
    );
  }
  return version;
}

/** Throws if the version is approved: approved versions are frozen, edits make a new version. */
export function assertVersionEditable(version: Partial<ApprovalFields>): void {
  if (version.approvedAt !== undefined || version.approvedBy !== undefined) {
    throw new GuardError(
      'version-locked',
      'This version was already approved, so it cannot be changed. Your edits will be saved as a new version that needs approval.',
    );
  }
}
