import { IsoDateTimeSchema } from '../schemas/primitives';
import type { Variant } from '../schemas/variant';
import { GuardError } from './errors';

/** Checks the fields directly because callers may pass data that was never schema-validated. */
type ApprovalFields = Pick<Variant, 'approvedAt' | 'approvedBy'>;

function isApproved(variant: Partial<ApprovalFields> | null | undefined): boolean {
  if (!variant) return false;
  const { approvedAt, approvedBy } = variant;
  return (
    IsoDateTimeSchema.safeParse(approvedAt).success &&
    typeof approvedBy === 'string' &&
    approvedBy.trim() !== ''
  );
}

/** Throws unless the consultant has approved the variant, so it is safe to show a client (rule 4). */
export function assertShareable(variant: Partial<ApprovalFields>): void {
  if (!isApproved(variant)) {
    throw new GuardError(
      'not-approved',
      "This design hasn't been approved yet. Review and approve it before sharing it with the client.",
    );
  }
}

/** Throws unless the client picked this variant and the consultant approved it. */
export function assertExportable(variant: Partial<ApprovalFields> & Pick<Variant, 'status'>): void {
  if (!isApproved(variant)) {
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
}
