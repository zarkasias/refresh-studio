# 004 — Test-site set and consent policy

- **Date:** 2026-11-09
- **Status:** accepted (fixture policy amended by ADR-010)

## Context

M0's gate is that the site model "holds up against" a test set of 10–15 real small-business
sites (PRD, Milestones). CLAUDE.md rule 5 says a crawl refuses to run without recorded consent,
but only our own site has consent today. Evals and fixtures still need realistic cases across
WordPress, Squarespace, Wix, hosted builders and hand-coded sites (M0 plan, section 4, T6–T9).
Decision D9 is recorded here.

## Decision

- **The test set is `evals/sites/manifest.json`**, validated by `ManifestSchema`
  (`evals/src/manifest.ts`). It has 13 sites from plan section 4, plus 2 open slots (WordPress +
  Elementor, WordPress + Divi) to fill from consenting M1 prospects.
- **Fields:** `slug, url, businessType, platform, builder?, pageBuilder?, platformConfidence,
  evidence[], whyUseful, consent, consentRecordedAt?, misfits[]`.
  - `pageBuilder` was **added beyond the plan's T6 list**: WPBakery is a WordPress page builder,
    not a hosted builder. `builder` is only allowed with `platform: other-hosted`, and
    `pageBuilder` only with `platform: wordpress`, matching the site model.
  - Confidence labels map High = 0.9 and Medium-high = 0.75.
- **Consent levels:** `own-site | granted | requested | none`. Only `own-site` and `granted`
  (with a recorded UTC date) are network-eligible. `requested` is treated as `none`. Today only
  `chambers-consulting` is eligible.
- **One gate:** `selectNetworkEligible()` / `isNetworkEligible()` validate their input and are
  the only way an eval or job may pick sites for network use. `loadManifest()` is the only way
  to read the file.
- **Fixture policy (D9):** for sites without consent we keep **hand labels only**, written by a
  person viewing the site in a normal browser (T8), plus synthetic fixtures that copy a *pattern*,
  never content. No crawls, saved HTML, screenshots or Lighthouse runs. **Evals run offline**
  against stored snapshots.

## Alternatives considered

- Saving HTML snapshots of public sites anyway: they're public, but it goes against rule 5 and
  the trust the product sells.
- Only synthetic sites: these miss the messy real-world patterns (conflicting hours, mismatched
  `tel:` links) the schema has to survive.
- Asking every owner before M0: it would block the gate on replies. Outreach (T7) runs in
  parallel instead.

## Consequences

- Gate item 4 depends on consultant hand-labeling (T8, about 3–4 hours).
- M1 platform detection must re-verify every platform label, since roundup labels were already
  stale twice.
- The set leans polished and light on WordPress page builders, dated sites and GoDaddy. The open
  slots and outreach to prospects should fix this.
- The repo must stay private, because the manifest names real businesses.

Amended by ADR-010: label-derived synthetic sites are allowed after anonymization, and fixtures
use fixture-only loopback URL schemas. The consent rules above are unchanged.
