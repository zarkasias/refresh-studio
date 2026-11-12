# T6a: Synthetic site generator + 3 recipes

Part of the [M1 plan](../M1.md).

| # | Task | Owner | Package/dir | Depends on | PRD / rule |
|---|---|---|---|---|---|
| T6a | ✅ Synthetic site generator + 3 recipes | agent-engineer | `evals/fixtures` | T4, T5 | M1-notes |

## Details

**T6a Synthetic site generator.** `buildSyntheticSite(anonLabel, recipe)` writes static HTML/CSS/JS pages to `evals/fixtures/sites/<slug>/`. Each section is rendered from the label. The **recipe** (`evals/fixtures/recipes/<slug>.ts`) adds the patterns: platform markers from manifest `evidence`, fonts as computed names, colors on real text, plain-text phones where the label says "(not linked)", hidden copies, and so on. Expected outputs are the anonymized label plus `expected.capture.json` (what extraction must find). First three recipes: **casper-plumbing** (Wix markers, Wix internal font names, href/display mismatch, plain-text phones), **iphci** (WordPress markers, `.slick-cloned` duplicates of the Plumbing/Heating/Cooling blocks, `data-cfemail` email, `href="#"` Services toggle with submenu), **delaware-valley-hardwoods** (custom, Instagram-style feed showing "Loading recent projects..." that a script replaces after 1.2 s). *Acceptance:* the three sites build reproducibly (same bytes for the same seed); `pnpm eval:capture` can serve them.

## Linked sections

- [M1 notes](../M1-notes.md): only the items this task names.
- [Consent, fixtures and network policy](consent-and-network.md).
- [ADR-010](../../decisions/010-fixtures-without-crawling.md): synthetic sites only from anonymized labels.
