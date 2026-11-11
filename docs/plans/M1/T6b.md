# T6b: Remaining recipes + pattern fixtures

Part of the [M1 plan](../M1.md).

| # | Task | Owner | Package/dir | Depends on | PRD / rule |
|---|---|---|---|---|---|
| T6b | Remaining recipes + pattern fixtures | agent-engineer | `evals/fixtures` | T6a | M1-notes; manifest |

## Details

**T6b Remaining recipes and pattern fixtures.** Recipes for the other 7 labeled sites plus detection-only signal fixtures for williamsburg-chiro-ny (Webflow `website-files.com`, `data-wf-site`), mckinley-chiro ("Powered by ChiroPlanet.com", `http:` only) and ramseys-diners ("powered by BentoBox"). Notable recipe content: hair-and-co-brooklyn (second-location team block ×3 with two hidden, nav ×2, Google+ link, © 2021, WPBakery `js_composer`/`vc_row`), jolly-plumbing (Kadence `wp-theme-kadence` and `wp-block-kadence-*`, `#ffd000` text on white, zero-width tel), cafecito-santa-fe (three hours blocks, Toast links), arc-electric (Wix, Avenir/DIN Next internal names, clean control). Pattern fixtures copy no label at all: `pattern-elementor`, `pattern-divi`, `pattern-beaver-builder`, `pattern-gutenberg`, `pattern-no-h1`, `pattern-http-only`, `pattern-iframe-booking` (iframe to a `.test` provider origin), `pattern-bot-challenge` ("Just a moment..." page with `cf-mitigated: challenge`). *Acceptance:* all fixtures build; each recipe lists which manifest evidence and which M1-notes item it exercises.

## Linked sections

- [M1 notes](../M1-notes.md): only the items this task names.
- [Consent, fixtures and network policy](consent-and-network.md).
- [ADR-010](../../decisions/010-fixtures-without-crawling.md): synthetic sites only from anonymized labels.
