# 007 — Site model v3: fonts and page builders

- **Date:** 2026-11-09
- **Status:** accepted (M1 plan, `docs/plans/M1.md` section 2a; the consultant approved D1 and D6)

## Context

M1 capture reads the fonts a page really uses. On Wix, computed styles carry the builder's
internal names (`avenir-lt-w01_35-light1475496`), not the family (`Avenir`). The v2 model
stores `brand.extractedFonts` as plain strings, so it can hold either the normalized name or
the raw one, not both. The raw name matters: it carries weight and style hints (`35-light`),
and it is the only way to debug a wrong normalization (see `docs/plans/M1-notes.md`, "Raw Wix
font names").

Separately, the eval manifest names two page builders that are not in
`KnownPageBuilderSchema`: `kadence-blocks` (jolly-plumbing) and `beaver-builder` (iphci). They
already validate through the open `Slug` branch, so nothing breaks, but platform detection,
exporter path selection and evals cannot switch on them exhaustively.

## Decision

Adopt **site model v3** (`Site.schemaVersion: 3`) in `packages/site-model`:

- `brand.extractedFonts` is `ExtractedFont[]`, where `ExtractedFont { family: string;
  raw?: string[] }`. `family` is the normalized name (`Avenir`, `DIN Next`, `system-ui`).
  `raw` lists the names as found in computed styles. It is non-empty, has no duplicates, and
  is omitted when it would equal `[family]`. Families are unique per site; a duplicate fails
  validation.
- `KnownPageBuilderSchema` gains `kadence-blocks` and `beaver-builder`. They were already
  valid slugs, so no data changes.

**Migration.** `migrateSiteDoc` gets step `v2ToV3` (`STEPS[2]`): each `extractedFonts` string
becomes `{ family }`, de-duplicated by family (first occurrence wins). A v1 doc goes through
both steps. `rowToSite` and `rowToVersion` already migrate on read, so they don't change, and
**approved Version snapshots, frozen in the database (ADR-005), are never rewritten**.

The 10 eval labels, the `_template` and `evals/sites/LABELING.md` move to v3, converted
mechanically by a one-off script that calls `migrateSiteDoc`. Labels gain `raw` only where the
labeler recorded it (none today).

Not changed: sections, business, tokens, `platformEvidence.where`.

## Alternatives considered

- **Keep `extractedFonts: string[]` (normalized) and store raw names only in capture records
  (D1).** This needs no v3 and no migration. Rejected as the default because the raw names
  would then live outside the model that the exporters and the designer read, and the model
  could not say which raw name produced which family.
- **Store raw names only, normalize at read time.** Every reader would have to repeat the
  normalization, and the labels (which record real family names) would not compare directly.
- **Leave the two builders on the `Slug` branch.** It works, but detection, exporters and
  evals could not switch exhaustively on them. (Either way, a misspelled builder such as
  `beaver-buildr` still passes through the open `Slug` branch; nothing flags unknown builders.)

## Consequences

- Eval labels move to v3 with `family` objects. Mapper and auditor evals compare against
  `family`.
- One new migration step; the read paths don't change.
- Exporters and the audit's font-count check read `family`. The M2 designer can use `raw` as a
  weight/style hint.
- Capture (M1) is responsible for normalizing names and deduplicating families before it
  writes the model.
- Any code that built `extractedFonts` as strings must now build objects (nothing did outside
  tests and fixtures in M0).
