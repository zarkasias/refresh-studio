# How to label a test site (T8)

About 15–20 minutes per site. You need 10 passing labels for the M0 gate.

## Rules first

- **Look at the site in your normal browser** as any visitor would. Don't crawl, script, save
  pages or take screenshots for sites whose `consent` is `none` or `requested` (ADR-004).
- **Store as little of their content as possible.** Copy headings, buttons, phone/email/address
  and hours as displayed. Body copy is only needed when it carries something we test (a
  conflicting claim, leftover Lorem Ipsum); otherwise give a short summary.
- Homepage and contact page are the minimum. Add another page only when it shows something
  worth testing (a menu page, a services page with many items).

## Steps

1. Copy the template into a folder named after the manifest `slug`:

   ```sh
   mkdir evals/sites/<slug>
   cp evals/sites/_template/expected.site.json evals/sites/<slug>/
   ```

2. Fill it in. Replace **every** string containing `TODO`; the check fails while any remain.
   - `id` is `site_<slug>`, `projectId` is `proj_<slug>`.
   - `sourceUrl`: the manifest `url` for this site.
   - `platform`: your best judgment from what you see. If it differs from the manifest, the
     check only warns. Leave `platformEvidence: []` and `platformConfidence: 0` (capture fills
     those in M1).
   - `business`: phone, email, address and hours **exactly as displayed**. Delete fields the
     site doesn't show (don't leave them empty). Multiple locations go in `business.locations`.
     Hours are free text: `{ "label": "Kitchen", "text": "Mon–Fri 7am–3pm" }`.
   - `socialLinks.network` and `cta.provider` are lowercase slugs (`facebook`, `toast`, `meevo`).
   - `brand.extractedColors`: 2–4 main colors as **lowercase** 6-digit hex (`#1a2b3c`). Use
     your browser's color picker. `extractedFonts`: family names if you can tell (DevTools →
     Computed → font-family); otherwise `[]`.
   - `pages`: one entry per page, `path` starting with `/` (the contact page is usually
     `/contact`). One section per visible block, top to bottom. Section `type` is one of
     `nav hero services about testimonials gallery pricing faq team contact booking map cta
footer richtext menu`. Section `id`s must be unique across the whole file (e.g.
     `home-hero`, `contact-main`). Set `confidence` to `1`.
   - CTAs: `href` exactly as the link points (hover to see it), e.g. `tel:3075551234`, even if
     it doesn't match the displayed number. That mismatch is what we want to catch. `kind` is
     `call`, `email`, `book`, `link` or `order`.
   - Delete optional keys you don't use rather than leaving `""` or `[]` placeholders, except
     `socialLinks`, `extractedColors`, `extractedFonts` and `sections`, which are required (use
     `[]`).

3. **Log anything that doesn't fit** in that site's `misfits[]` in `evals/sites/manifest.json`:

   ```json
   {
     "field": "business.hours",
     "note": "Header says closes 3pm, footer says 2pm; one hours list can't say which applies to what"
   }
   ```

   Leave `resolution` off. During T9 review each misfit becomes `"schema-change"` (we changed
   the model; recorded in an ADR) or `"accepted"` (you decided it's fine as is). Don't bend the
   label to fit: an honest misfit is more useful than a forced label.

4. Check it:

   ```sh
   pnpm eval:conformance   # validates every label that exists; prints errors by field path
   pnpm gate:m0            # also fails until 10 labels pass and no misfit is open
   ```

   Errors name the exact field, e.g. `brand.extractedColors.0.hex: Expected a lowercase hex
color like #1a2b3c`.

See `docs/site-model.md` for every field and its rules.
