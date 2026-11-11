/**
 * Pure helpers for a variant's version history (ADR-005, PRD "4. Client review").
 *
 * - Approval belongs to a Version, never to the Variant.
 * - An approved Version is frozen. Any edit after approval becomes a new, unapproved Version
 *   that needs its own approval.
 * - The client share link shows the latest approved Version (`resolveSharedVersion`).
 *
 * "History" is every Version of one variant, in any order. These functions never mutate their
 * inputs; callers persist what they get back. The rules live in `core.ts` and are shared with
 * report versions (`report-history.ts`, ADR-008).
 */
import { VersionSchema, type Version, type VersionSnapshot } from '../schemas/version';
import { createHistory, type SaveResult } from './core';

export interface NewVersionInput {
  id: string;
  snapshot: VersionSnapshot;
  createdBy: string;
  createdAt: string;
  note?: string;
}

export type SaveEditResult = SaveResult<Version>;

const variantHistory = createHistory<Version, NewVersionInput>({
  ownerKey: 'variantId',
  ownerNoun: 'variant',
  thingNoun: 'design',
  parse: (value) => VersionSchema.parse(value),
  ownerOf: (input) => input.snapshot.variant.id,
  build: (input, variantId, number) => ({
    id: input.id,
    variantId,
    number,
    snapshot: input.snapshot,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    note: input.note ?? '',
  }),
  patch: (latest, input) => ({
    ...latest,
    snapshot: input.snapshot,
    note: input.note ?? latest.note,
  }),
});

/** The newest version (highest `number`), approved or not. */
export const latestVersion = variantHistory.latestVersion;

/** The newest approved version, or undefined if nothing has been approved yet. */
export const latestApprovedVersion = variantHistory.latestApprovedVersion;

/** A new, unapproved version numbered after the newest one in `history`. */
export const createVersion = variantHistory.createVersion;

/**
 * Record an edit to a variant. If the newest version is still unapproved, the edit replaces its
 * snapshot (`updated`). If the newest version is approved (or there is none), the edit becomes a
 * new unapproved version (`created`), so an approved version never changes.
 */
export const saveEdit = variantHistory.saveEdit;

/**
 * The consultant approval step (CLAUDE.md rule 4). Only the newest version can be approved, and
 * only once. Returns the approved copy; the caller persists it.
 */
export const approveVersion = variantHistory.approveVersion;
