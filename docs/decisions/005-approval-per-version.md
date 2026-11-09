# 005 — Approval is per version

- **Date:** 2026-11-09
- **Status:** accepted (consultant decision, 2026-11-09)

## Context

CLAUDE.md rule 4 says nothing reaches a client without an explicit consultant approval
(`approvedAt` on the record). ADR-003 put `approvedAt`/`approvedBy` on **Variant**. But a
variant keeps changing after approval (client feedback, consultant edits; PRD "4. Client
review": version snapshots, "consultant merges feedback into a final version"). With approval on
the variant, an edit made after approval would reach the client's share link without anyone
approving it.

## Decision

- **Approval belongs to a Version**, not a Variant. `Version` gains `number` (1, 2, 3, ... per
  variant), `approvedAt?` and `approvedBy?`. `Variant` loses both approval fields.
- **An approved Version is frozen.** Any edit after approval creates a new, unapproved Version
  that needs its own approval. Before approval, edits update the newest (draft) Version in
  place (`saveEdit`). Only the newest Version can be approved, and only once (`approveVersion`).
- **The client share link shows only the newest approved Version** (`resolveSharedVersion`).
  A newer unapproved edit never replaces it.
- Variant `status` `approved`, `shared` and `selected` need an approved Version
  (`assertStatusAllowed`). Export uses the newest approved Version of a `selected` variant
  (`assertExportable`).
- **Database:** `versions` has a unique `(variant_id, number)`, approval pair / non-empty /
  `approved_at >= created_at` checks, and a trigger (`versions_freeze_approved`, migration
  0002) that refuses any UPDATE or DELETE of an approved row. The `variants` approval columns and
  checks are dropped (migration 0001).

## Alternatives considered

- **Keep approval on Variant and clear it on every edit** — the share link would go blank (or
  show unapproved work) between an edit and re-approval, and there would be no record of what
  the client actually saw.
- **Approval on both Variant and Version** — two sources of truth for rule 4.
- **Order versions by `createdAt`** — two saves in the same millisecond tie; an explicit
  `number` is unambiguous and is enforced unique.
- **Allow approving an older version** (to roll back) — adds a second path that moves the share
  link backwards. Rolling back is done by saving the old snapshot as a new version and approving
  that.

## Consequences

- Rule 4 now holds across edits: what the client sees is always a frozen, approved snapshot,
  and the history shows exactly which version they saw when they commented.
- The Variant schema can no longer enforce "shared needs approval" alone; callers must use
  `assertStatusAllowed` with the version history. The database does not enforce this cross-table
  rule either.
- Migration 0001 adds `versions.number NOT NULL` with no default, so it only applies to an
  empty `versions` table. That is true today (no database has been deployed; D1 defers
  Supabase to M1).
- Supersedes the approval part of ADR-003.
