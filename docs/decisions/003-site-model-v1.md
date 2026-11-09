# 003 — Site model v1

- **Date:** 2026-11-09
- **Status:** accepted

## Context

M0 has to prove that the site model "holds up against the test set" (PRD, Milestones; M0 plan,
section 1). The v0 model in `docs/site-model.md` had no Project or Consent type (CLAUDE.md rule 5
needs `project.consent`), no `approvedAt` on Variant (rule 4), no Asset type even though every
entity points at `*AssetId`, and several untyped leaves. Platform detection also had nowhere to
put hosted builders outside the enum, such as BentoBox and ChiroPlanet. The test set (M0 plan,
section 4) brought up multi-location businesses, conflicting hours, restaurant menus and
external ordering tools. Decisions D8 (accept section 2) and D12 (Webflow/other-hosted handoff)
are recorded here.

## Decision

Adopt **site model v1**: the M0 plan section 2 changes, implemented as strict Zod schemas in
`packages/site-model`, with the constraints below. Store the Site as a versioned JSONB
document, and keep projects, variants, versions and comments in relational tables.

### Schema changes (M0 plan, section 2)

- `Project { id, clientName, siteUrl, consent?, createdAt }` and
  `Consent { grantedBy, grantedAt, method: email | signed | own-site, scope: { origin, pathPrefix?, maxPages }, evidenceAssetId? }`.
- `Variant.approvedAt?` and `Variant.approvedBy?` (guard `assertShareable` is T4).
- `Site.schemaVersion: 1`.
- `Site.platform` gains `'other-hosted'`; `custom` now means hand-coded. New
  `platformDetails.builder?`, `platformEvidence[]` and `platformConfidence`.
- `platformDetails.pageBuilder` gains the literal `'wpbakery'` and keeps an open branch.
- `business.locations?[]` (top-level fields stay the primary location) and
  `hours?: { label?, text }[]` as raw text.
- `Section.type` gains `'menu'`; `cta.kind` gains `'order'`; new `cta.provider?`.
- New `Asset { id, siteId, kind, sourceUrl, storagePath?, width?, height?, bytes?, alt? }`.
- Concrete leaf types: `HexColor`, `GoogleFont { family, weights }`, `extractedColors[]`,
  `socialLinks[]`, `Version.snapshot: { site, variant }`.

**User-approved addition beyond section 2:** `createdAt: IsoDateTime` (required, UTC) on
`Version` and `Comment`. Approved by the consultant on 2026-11-09 during the T3 build (asked before the T5
migration so the tables match from day one); it is not in the approved plan text.

### Storage

- The `Site` is stored as a **JSONB document** in `sites`, carrying `schemaVersion`, and is
  validated with Zod at the edges (read from DB, agent output, fixture load).
- `projects` (with consent columns), `assets`, `variants` (`approved_at`), `versions` and
  `comments` are **relational tables** (T5).
- **Text IDs.** The model does not fix an id format, so T5 uses `text` primary keys, not `uuid`.
- **UTC timestamps.** Every datetime in the model is ISO 8601 with a `Z` suffix. T5 uses
  Drizzle `timestamptz` with `mode: 'date'` and converts with `.toISOString()` at the edge.
  Datetimes are UTC with millisecond precision, as produced by `toISOString()`.
- **Delete policy (T5).** Deleting a project cascades to its sites, assets and variants, and a
  site cascades to its assets and variants. `versions.variant_id` and `comments.version_id`
  are `ON DELETE RESTRICT`: versions and comments are the record of what the client saw and
  approved (CLAUDE.md rule 4), so a variant that has versions cannot be deleted (and therefore
  neither can its site or project) until that history is deliberately removed first.

### Constraints

- **Strict objects.** Unknown keys are rejected everywhere.
- **Strings are non-empty** unless they hold text copied from the client site (listed in
  `docs/site-model.md`, Constraints).
- **Hex colors** are lowercase 6-digit.
- **Bare origin plus `pathPrefix`.** `Consent.scope.origin` must equal `new URL(origin).origin`
  (no path, query, hash or trailing slash). Path scoping on shared hosts such as
  `*.wixsite.com/<name>` is done only by `pathPrefix`. T4 matches the prefix on a path-segment
  boundary, so `/jolly` does not admit `/jollyplumbing`.
- **Slug rule.** `socialLinks.network`, `cta.provider`, `platformDetails.builder` and the open
  branch of `pageBuilder` match `^[a-z0-9][a-z0-9-]*$`. `platformDetails.theme` stays as found.
- **Approval invariant** (CLAUDE.md rule 4). *Superseded by ADR-005: approval moved from
  Variant to Version.* `approvedAt` and `approvedBy` are both present or
  both absent, and `status` `approved`, `shared` or `selected` requires both. A `draft` may
  keep an earlier approval. Because Zod 4 does not allow `.pick/.omit/.extend` on refined
  objects, the package also exports `VariantObjectSchema` (and `SiteObjectSchema`) without the
  refinement. Validation always uses the refined schema.
- **Uniqueness.** `Page.path` is unique within a site, and `Section.id` is unique across all
  pages of a site (variant `templates` are keyed by section id).
- **Narrowings.** `Page.path` and `pathPrefix` start with `/`; `maxPages` is an integer from 1
  to 25 (`MAX_CRAWL_PAGES`, rule 6); GoogleFont weights are integers 1–1000; a `Location` must
  have at least one field.

### D12: hosted builders without a native handoff

Webflow and `other-hosted` sites (BentoBox, ChiroPlanet, ...) get the **style-guide** handoff
(`packages/exporters/style-guide`). We do not build an exporter per hosted builder.

## Alternatives considered

- **Fully relational Site (pages and sections as tables)** — many joins for a document that is
  always read and written whole, and every schema change becomes a migration. JSONB plus
  `schemaVersion` keeps the model in one Zod schema.
- **Passthrough (non-strict) objects** — tolerant of old data, but typos and stale fields would
  pass silently and reach exporters.
- **Origin as any URL, with the path doubling as the scope** — two ways to express the same
  scope, and an easy source of cross-site crawl bugs. One field per concern is simpler to guard.
- **Free-string builder and provider names** — `Toast`, `toast` and `toast pos` would count as
  three providers in audits and evals.
- **`approvedAt` alone** — no record of who approved, and nothing would stop a `selected`
  variant from lacking an approval.

## Consequences

- Stored JSONB Sites and Version snapshots **must be migrated to the current `schemaVersion`
  before validation**, because strict schemas reject unknown or renamed keys. Any v2 needs a
  migration function from v1, plus tests on the stored fixtures.
- Crawl scoping (T4) can compare origins with plain string equality and only needs prefix logic
  for `pathPrefix`.
- Capture and the mapper must slugify builder, provider and network names before writing them.
- Code that derives schemas has to start from `*ObjectSchema` and must not skip the refined
  schema when validating.
- Revisit: whether `theme` should also be normalized, whether a `draft` should clear its
  approval, and whether `createdAt` belongs on other entities.
