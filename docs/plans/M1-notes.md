# M1 notes: capture concerns from M0 labeling

Accepted misfits from the T9 review (ADR-006) that the **capture** package (M1) has to handle.
The site model already has a place for this information. The issue is getting it out of the
page. Each item names the test site that showed it. Check each one against the M1 capture tests.

## Email hidden by Cloudflare

- **Seen on:** iphci. The HTML shows `[email protected]`. The real address (`info@iphci.com`)
  only appears after Cloudflare's email-decode script runs.
- **Capture must:** read emails from the rendered DOM after scripts run, or decode the
  `data-cfemail` attribute (XOR with its first byte). Never record `[email protected]` as an
  email.

## Content loaded by JavaScript

- **Seen on:** delaware-valley-hardwoods. "Recent Projects" is an Instagram feed. Until it
  loads, the page shows only "Loading recent projects...".
- **Capture must:** wait for network idle plus a short settle time before it extracts or
  takes screenshots, and treat loading placeholders ("Loading...") as not-yet-rendered
  content. If the content still hasn't loaded, map the section with low confidence instead of
  saving the placeholder text.

## Booking widgets inside iframes

- **Seen on:** booking and scheduling tools that embed their own page in an iframe.
- **Capture must:** record the iframe's `src` origin as the booking `provider` and the CTA
  href. Don't crawl into it: it is another origin (CLAUDE.md rule 6). The section is `booking`
  even though its content isn't in our DOM.

## Duplicated markup (sliders, responsive copies)

- **Seen on:** iphci (the Plumbing/Heating/Cooling blocks appear twice, as slider clones) and
  hair-and-co-brooklyn (the Bay Ridge team block three times, the nav twice).
- **Capture must:** skip hidden copies and slider clones (`aria-hidden`, `.slick-cloned`,
  `.swiper-slide-duplicate`, `display: none`), and the mapper de-duplicates sections that have
  the same heading and items. The labels list each block once.

## Raw Wix font names

- **Seen on:** Wix sites (casper-plumbing, arc-electric). Computed styles give internal names
  such as `avenir-lt-w01_35-light1475496` or `din-next-w01-light` instead of the family.
- **Capture must:** map these to the real family name (`Avenir`, `DIN Next`) before writing
  `brand.extractedFonts`, which is how the labels record them (see `evals/sites/LABELING.md`).
  Keep a small lookup table and fall back to stripping the `-w01…`/numeric suffix.

## Related, not capture

- Content conflicts (hours, names, location counts) are recorded as each page shows them. The
  auditor flags them (NAP consistency).
- Kadence Blocks per-block styles affect the WordPress exporter. See
  `.claude/skills/wordpress-theme-export/SKILL.md`.
