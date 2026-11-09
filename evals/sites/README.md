# Test sites

`manifest.json` lists the eval test set from the M0 plan, section 4. It is validated by
`ManifestSchema` in `evals/src/manifest.ts` (`pnpm test`).

## Consent policy (CLAUDE.md rule 5)

Every entry has a `consent` level: `own-site`, `granted`, `requested` or `none`.

- Only `own-site` and `granted` entries may be crawled, screenshotted, saved as HTML or run
  through Lighthouse. Today that is only `chambers-consulting` (our own site). Every other site
  is `none` until T7 records consent.
- `requested` means we asked and have no answer yet. It is treated exactly like `none`.
- For `none` and `requested` sites: no crawl job, no `/audit-site` run, no live eval, and no
  saved HTML or screenshots in this repo.
- Evals run **offline only**, against stored snapshots. Evals read the manifest with
  `loadManifest()` (`@srs/evals`), which validates it. Any eval or job that needs the network
  must pick sites through `selectNetworkEligible()` / `isNetworkEligible()` in
  `evals/src/manifest.ts`. Both validate their input first, so unparsed or malformed data is
  never eligible. That is the single gate; do not filter by hand.
- Sites without consent get **synthetic fixtures** that copy the pattern (for example "the
  header `tel:` link doesn't match the displayed number"), never the content (no real names,
  numbers, addresses or copy).
- Keep the repo private and store as little client content as possible.

## Fields

- `platformConfidence` maps the plan's labels: **High = 0.9**, **Medium-high = 0.75**.
- `builder` is a hosted builder slug (e.g. `bentobox`, `chiroplanet`) and is only allowed with
  `platform: "other-hosted"`, matching `platformDetails.builder` in the site model.
- `pageBuilder` is a WordPress page builder (e.g. `wpbakery`) and is only allowed with
  `platform: "wordpress"`, matching `platformDetails.pageBuilder`. **This field was added beyond
  the M0 plan's T6 field list** (QA review: WPBakery is a page builder, not a hosted builder).
  Record it in ADR-004.
- `evidence[]` uses the site model's `PlatformEvidence` shape (`signal`, `where`).

## Not in the manifest yet

- **Open slots.** #14 WordPress + Elementor and #15 WordPress + Divi (ideally a dated trades
  site, which also covers the "dated / no mobile layout" case). Fill both from consenting
  prospects on the M1 prospect list.
- **Unverified alternates.** https://salon-volt.com/ (GoDaddy), https://modifyhair.com/
  (GoDaddy), https://www.willschiro.com/ (labeled WordPress, may be Webflow). Not entries until
  someone verifies the platform.

Platform evidence came from one light homepage fetch per site. M1 platform detection must
re-verify every entry.

## Labeling guidance (T8)

- Look at each site in a normal browser, the way any visitor would. Do not crawl, script or
  save pages for `none` sites.
- Hex colors must be lowercase 6-digit, e.g. `#1a2b3c` (the site model rejects `#1A2B3C`
  and `#abc`).
- When something on a site does not fit the site model, add it to that entry's `misfits[]`:
  `{ "field": "<model field, e.g. business.hours>", "note": "<what didn't fit>" }`. Leave
  `resolution` off; T9 sets it to `schema-change` or `accepted` when the misfit is reviewed.
