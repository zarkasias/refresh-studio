/**
 * Pure helpers for a variant's version history (ADR-005, PRD "4. Client review").
 *
 * - Approval belongs to a Version, never to the Variant.
 * - An approved Version is frozen. Any edit after approval becomes a new, unapproved Version
 *   that needs its own approval.
 * - The client share link shows the latest approved Version (`resolveSharedVersion`).
 *
 * "History" is every Version of one variant, in any order. These functions never mutate their
 * inputs; callers persist what they return.
 */
import { GuardError } from '../guards/errors';
import {
  VersionSchema,
  isApprovedVersion,
  type Version,
  type VersionSnapshot,
} from '../schemas/version';

type History = readonly Version[];

/** Throws a programmer error if the history mixes variants or repeats a number or id. */
function checkHistory(history: History): void {
  const variantIds = new Set(history.map((v) => v.variantId));
  if (variantIds.size > 1) {
    throw new Error(`Version history mixes variants: ${[...variantIds].join(', ')}`);
  }
  if (new Set(history.map((v) => v.number)).size !== history.length) {
    throw new Error('Version history repeats a version number');
  }
  if (new Set(history.map((v) => v.id)).size !== history.length) {
    throw new Error('Version history repeats a version id');
  }
}

function newest(history: History): Version | undefined {
  let best: Version | undefined;
  for (const v of history) if (!best || v.number > best.number) best = v;
  return best;
}

/** The newest version (highest `number`), approved or not. */
export function latestVersion(history: History): Version | undefined {
  checkHistory(history);
  return newest(history);
}

/** The newest approved version, or undefined if nothing has been approved yet. */
export function latestApprovedVersion(history: History): Version | undefined {
  checkHistory(history);
  return newest(history.filter(isApprovedVersion));
}

export interface NewVersionInput {
  id: string;
  snapshot: VersionSnapshot;
  createdBy: string;
  createdAt: string;
  note?: string;
}

/** A new, unapproved version numbered after the newest one in `history`. */
export function createVersion(history: History, input: NewVersionInput): Version {
  const latest = latestVersion(history);
  const variantId = input.snapshot.variant.id;
  if (latest && latest.variantId !== variantId) {
    throw new Error(`Snapshot is for variant ${variantId}, history is for ${latest.variantId}`);
  }
  return VersionSchema.parse({
    id: input.id,
    variantId,
    number: (latest?.number ?? 0) + 1,
    snapshot: input.snapshot,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    note: input.note ?? '',
  });
}

export type SaveEditResult =
  { kind: 'updated'; version: Version } | { kind: 'created'; version: Version };

/**
 * Record an edit to a variant. If the newest version is still unapproved, the edit replaces its
 * snapshot (`updated`). If the newest version is approved (or there is none), the edit becomes a
 * new unapproved version (`created`), so an approved version never changes.
 */
export function saveEdit(history: History, input: NewVersionInput): SaveEditResult {
  const latest = latestVersion(history);
  if (latest && !isApprovedVersion(latest)) {
    if (latest.variantId !== input.snapshot.variant.id) {
      throw new Error(
        `Snapshot is for variant ${input.snapshot.variant.id}, history is for ${latest.variantId}`,
      );
    }
    const version = VersionSchema.parse({
      ...latest,
      snapshot: input.snapshot,
      note: input.note ?? latest.note,
    });
    return { kind: 'updated', version };
  }
  return { kind: 'created', version: createVersion(history, input) };
}

/**
 * The consultant approval step (CLAUDE.md rule 4). Only the newest version can be approved, and
 * only once. Returns the approved copy; the caller persists it.
 */
export function approveVersion(
  history: History,
  versionId: string,
  approval: { approvedBy: string; approvedAt: string },
): Version {
  const latest = latestVersion(history);
  const target = history.find((v) => v.id === versionId);
  if (!target) throw new Error(`Version ${versionId} is not in this history`);
  if (isApprovedVersion(target)) {
    throw new GuardError('already-approved', 'This version of the design is already approved.');
  }
  if (target !== latest) {
    throw new GuardError(
      'not-latest',
      'There is a newer version of this design. Review and approve the newest version instead.',
    );
  }
  return VersionSchema.parse({ ...target, ...approval });
}
