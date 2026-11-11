# M1 section 5. Check × test-site matrix (prefills `expected.audit.json`; drives `eval:checks`)

Part of the [M1 plan](../M1.md).

"Confirm" means the consultant verifies it in T7. Contrast ratios are computed from the label hex values and only fire if that color is used on normal-size text.

| Check | Fires on | Must stay silent on (negative cases) | Unknown / confirm |
|---|---|---|---|
| `tel-matches-display` | **casper-plumbing** (header `tel:3074738448` vs "307-441-4444") | hair-and-co-brooklyn (`tel:%28718%29%20789-2390` matches), northern-heights-dental (`tel:928-774-5050` and `tel:9287745050`), cafecito-santa-fe (`tel:+15053100089`), jolly-plumbing (`+1` plus hidden char decodes to a known number), all others | none |
| `tel-hidden-characters` | **jolly-plumbing** (`tel:+1%E2%80%8B719-491-8104`) | hair-and-co-brooklyn (encoded parentheses and space are visible characters), all others | none |
| `tap-to-call` (phone as plain text) | **casper-plumbing** (footer, contact), **jolly-plumbing** (header bar), **cafecito-santa-fe** (footer), **bella-lago-salon** (footer) | arc-electric, delaware-valley-hardwoods, northern-heights-dental, iphci; chambers-consulting (no phone shown, so nothing to link) | hair-and-co-brooklyn footer numbers (confirm) |
| `https` | **bella-lago-salon** (manifest URL `http://`; confirm whether it redirects), mckinley-chiro (detection-only fixture), `pattern-http-only` | all other labeled sites (https source URLs) | bella-lago-salon redirect (confirm) |
| `h1-present` | `pattern-no-h1` | chambers-consulting (verified by T34 real capture) | all 9 other labeled sites; labels don't record heading levels (confirm with DevTools) |
| `hours-consistent` | **cafecito-santa-fe** (Fri/Sat close 4pm homepage, 3pm Find Us, 9pm footer) | jolly-plumbing (same hours in two formats; "24/7" is emergency scope), northern-heights-dental (same hours, two formats), delaware-valley-hardwoods (one entry adds "Sat–Sun Closed"), iphci, arc-electric, casper-plumbing, bella-lago-salon (one source each) | none |
| `dead-links` | **hair-and-co-brooklyn** (Google+ `plus.google.com`) | chambers-consulting (`#contact` target exists) | iphci nav "Services" `href="#"`: silent if it opens a submenu, fires if not (confirm) |
| `text-contrast` | **jolly-plumbing** (`#ffd000` on `#ffffff` ≈ 1.5:1; manifest notes the risk) | chambers-consulting (`#16324b`, `#c5202e` on white ≥ 5.8:1), delaware-valley-hardwoods (`#cc4400` on white ≈ 4.8:1, boundary case), arc-electric | casper-plumbing `#2da0bd`/white ≈ 3.0:1, bella-lago-salon `#7c9194`/`#fbf9f9` ≈ 3.2:1, cafecito-santa-fe `#ff0505`/`#f6f4f4` ≈ 3.6:1 (confirm whether used for body text) |
| `nap-consistent` | **bella-lago-salon** ("Salon & Spa" vs "Salon & MedSpa"), **hair-and-co-brooklyn** (2 locations in nav/footer, 3 on contact) | arc-electric, iphci (two phones for two towns is not a conflict) | none |
| `dated-copyright` | **hair-and-co-brooklyn** (© 2021), mckinley-chiro (Copyright 2028, in the future) | iphci, delaware-valley-hardwoods, chambers-consulting (© 2026); sites with no copyright line are silent | none |
| `google-business-link` | none confirmed | cafecito-santa-fe (`g.page`), delaware-valley-hardwoods ("View on Google") | others (confirm) |
| `font-count` | casper-plumbing (4 families, confirm Georgia isn't only a fallback) | jolly-plumbing, chambers-consulting | none |
| **Phone false positives** | none | jolly and arc licence numbers (anonymized, same shape); ZIP codes; "since 1955"; "514 Google reviews" | none |
| **Capture (M1-notes)** | none | iphci email is never `[email protected]`; iphci blocks and hair-and-co second-location team block and nav appear once; delaware feed is not "Loading..." | none |

**arc-electric is the control:** no high- or medium-severity finding may fire on it (T21 hard rule).
