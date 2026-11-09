# 006 — Site model v2 from labeling

- **Date:** 2026-11-09
- **Status:** accepted (consultant misfit review, 2026-11-09)

## Context

T8 hand-labeled 10 test sites against site model v1 (ADR-003) and logged **44 misfits** in
`evals/sites/manifest.json`: places where real small-business sites carry information the
model had no field for, so the labeler put it in section body text. M0 gate item 5 needs every
misfit resolved.

The same gaps came up again and again:

- **Contact forms** (9 of 10 sites have one): fields, required markers and select options only
  fit in body text, but the audit's form check needs them structured.
- **More than one phone or email** (jolly-plumbing, iphci, hair-and-co-brooklyn): v1 had one
  of each.
- **Trust signals**: licence numbers (jolly-plumbing, arc-electric), founding year,
  aggregate ratings (arc-electric), certifications, memberships, awards and badges
  (delaware-valley-hardwoods, northern-heights-dental, bella-lago-salon, jolly-plumbing).
- **Service areas** as town lists or a radius (arc-electric, iphci, delaware-valley-hardwoods,
  chambers-consulting).
- **People** (owners, practitioners, stylists per location): northern-heights-dental,
  hair-and-co-brooklyn, delaware-valley-hardwoods.
- **Section types** for features/benefits lists and numbered "how it works" steps, labeled
  `richtext`.
- **Nav dropdowns** (northern-heights-dental, bella-lago-salon, hair-and-co-brooklyn).
- **Pay-online CTAs** (northern-heights-dental), labeled `link`.

The rest are content conflicts on the client's own site (hours, names, location counts),
pages the mapper has to infer, or capture problems.

## Decision

Adopt **site model v2** (`Site.schemaVersion: 2`) in `packages/site-model`:

- `business.phones?[]` and `business.emails?[]` of `{ value, label? }`; the first entry is the
  primary (`primaryPhone`, `primaryEmail`). They **replace** v1 `phone` and `email`.
- `business.locations?[]` is now `{ label, address, phone?, hours?, googleBusinessUrl? }`, with
  `label` and `address` required and labels unique. `googleBusinessUrl` is kept from v1 so
  migrated locations lose nothing. Top-level business fields stay the primary location.
- `business.trust?`: `{ foundedYear?, licenses[] { number, authority? }, ratings[] { source,
  value, count? }, credentials[] { kind: certification | membership | award | badge, name,
  url? } }`.
- `business.serviceArea?`: `{ description?, places[], radiusMiles? }`, and it must say
  something (a description, a place, or a radius).
- `business.people?[]`: `{ name, role?, locations? }`. Each `locations` entry must be the
  label of a `business.locations` entry.
- `Section.content.form?`: `{ fields[] { label, type, required, options? }, submitLabel?,
  confirmation? }`. Visible fields only (no honeypots). `options` only on `select`, `radio` or
  `checkbox`.
- `Section.type` gains `features` and `process`.
- Nav items may have `children[]`, one level, only in `nav` sections.
- `cta.kind` gains `pay`.

**Migration.** `migrateSiteDoc` / `parseStoredSite` turn a v1 document into v2: `phone` and
`email` become one-entry `phones` / `emails` (empty strings dropped). A v1 location without a
`label` or `address` throws `SiteMigrationError` instead of inventing one. `rowToSite` and
`rowToVersion` migrate on read, so stored docs and **approved Version snapshots, which are
frozen in the database (ADR-005), never need rewriting**.

**Misfit resolutions** (`resolution` in the manifest): 30 `schema-change` (covered above) and
14 `accepted`:

| Accepted | Why |
| --- | --- |
| Conflicting hours (cafecito-santa-fe), name variants (bella-lago-salon), location count and possibly-closed location (hair-and-co-brooklyn), two booking systems (hair-and-co-brooklyn) | The labels record what each part of the site says. Flagging the conflict is the auditor's job (NAP consistency), not a schema field. |
| Locations with no address: Birkdale (bella-lago-salon), Harlan satellite office (arc-electric) | v2 locations need an address, and we don't invent one. The audit can still report the mention. |
| No contact page (cafecito-santa-fe, bella-lago-salon); hours and directions blocks (cafecito-santa-fe) | The mapper recognizes contact content by what is on the page, not by URL. Hours stay in `business.hours`; directions stay `richtext`. |
| "200+ 5-Star Reviews", "Accepting New Patients" (northern-heights-dental) | There's no source or average, so it isn't a `rating`. Status claims stay as page text. |
| Cloudflare-obfuscated email, slider and duplicated markup (iphci, hair-and-co-brooklyn), JS-loaded feed (delaware-valley-hardwoods) | Capture concerns, collected in `docs/plans/M1-notes.md`. |

## Alternatives considered

- **Keep `phone`/`email` next to `phones`/`emails`.** No migration needed, but there would be
  two sources of truth for the primary number, and readers would have to check both.
- **Free-form `trust` / `extras` bag.** Absorbs anything, but the auditor and the section
  templates can't rely on it, and evals can't compare it.
- **People as `team` section items only.** That's what v1 did. It can't link a person to a
  location and is lost on any page without a team section.
- **Parsed hours.** Out of scope; the hours misfits are content conflicts, not structure.

## Consequences

- Capture, the content mapper and the auditor (M1) write and read the new fields. Mapper evals
  compare against the v2 labels.
- Everything that read `business.phone` / `business.email` uses `primaryPhone` /
  `primaryEmail` (nothing did yet in M0).
- Any stored v1 doc with an incomplete location fails to load with a `SiteMigrationError` that
  names the path. There is no such data in M0.
- A future v3 adds one step to `migrateSiteDoc`; the read paths don't change.
- The labeling guide (`evals/sites/LABELING.md`) and the blank template use v2.
- Field `type` and `required` on the labeled forms were taken from what the labels recorded.
  Where a label didn't say, the type was inferred from the field's name and `required` was set
  to false. The exception is chambers-consulting: one field is marked "(optional)", so the
  others are labeled required. Re-check these when the sites are captured in M1.
