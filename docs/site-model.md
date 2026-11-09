# Site model

The single internal representation every phase reads or writes. Lives in
`packages/site-model` as Zod schemas (`src/schemas/*.ts`); TypeScript types are inferred from
them with `z.infer`. Each entity is exported as `XSchema` plus type `X`. Valid test fixtures
live in `@srs/site-model/fixtures`.

Current version: **v3** (`Site.schemaVersion: 3`). Fields marked `// v1` were added by the M0
plan, section 2, or are user-approved additions recorded in ADR-003. Fields marked `// v2` came
from the T9 labeling misfit review (ADR-006). Fields marked `// v3` are from M1 (ADR-007).
All objects are strict:
unknown keys are rejected. See **Constraints** below for the rules that apply across entities.

```ts
// Primitives
Id          = string, non-empty
HexColor    = string matching ^#[0-9a-f]{6}$ (lowercase, 6 digits)          // v1
IsoDateTime = ISO 8601 datetime in UTC, e.g. 2026-11-09T12:00:00.000Z
Confidence  = number, 0–1 inclusive
Url         = absolute http(s) URL
Origin      = bare http(s) origin, exactly new URL(v).origin, e.g. https://a.com  // v1
Slug        = string matching ^[a-z0-9][a-z0-9-]*$, e.g. 'toast', 'oxygen'          // v1

Project {                                                                   // v1
  id, clientName, siteUrl: Url
  consent?: Consent                         // crawl refuses to run without it (CLAUDE rule 5)
  createdAt: IsoDateTime
}

Consent {                                                                   // v1
  grantedBy, grantedAt: IsoDateTime
  method: 'email' | 'signed' | 'own-site'
  scope: {
    origin: Origin                          // bare: no path, query, hash or trailing slash
    pathPrefix?: string                     // starts with '/'; the only path scoping, e.g. *.wixsite.com + '/<name>'
    maxPages: integer 1–25                  // MAX_CRAWL_PAGES = 25
  }
  evidenceAssetId?
}

Site {
  id
  projectId
  schemaVersion: 3                                                          // v3 (ADR-007)
  sourceUrl: Url
  platform: 'wordpress' | 'squarespace' | 'wix' | 'godaddy' | 'webflow'
          | 'custom'                        // hand-coded
          | 'other-hosted'                  // v1: hosted builder not listed (see builder)
          | 'unknown'
  platformDetails?: {
    theme?: string                          // as found, not slugified
    pageBuilder?: 'elementor' | 'divi' | 'gutenberg' | 'wpbakery'          // 'wpbakery' is v1
                | 'kadence-blocks' | 'beaver-builder'                       // v3 (ADR-007)
                | Slug
    builder?: Slug                          // v1: e.g. 'bentobox', 'chiroplanet'
  }
  platformEvidence: { signal: string; where: 'html' | 'header' | 'asset-url' | 'footer-text' }[]  // v1
  platformConfidence: Confidence                                            // v1
  business: {
    name
    phones?: ContactPoint[]                 // v2: first = primary; replaces v1 phone
    emails?: ContactPoint[]                 // v2: first = primary; replaces v1 email
    address?
    hours?: HoursEntry[]                    // v1: raw text, not parsed
    googleBusinessUrl?: Url
    socialLinks: { network: Slug; url: Url }[]                              // v1: typed
    locations?: Location[]                  // top-level fields = primary location
    trust?: Trust                                                           // v2
    serviceArea?: ServiceArea                                               // v2
    people?: Person[]                                                       // v2
  }
  brand: {                                  // what the current site uses
    logoAssetId?
    extractedColors: { hex: HexColor; role?: string; share?: number 0–1 }[]  // v1: typed
    extractedFonts: ExtractedFont[]         // v3 (ADR-007); families unique; was string[] in v1/v2
  }
  pages: Page[]                             // Page.path unique; Section.id unique across all pages
}

HoursEntry { label?: string; text: string }                                 // v1
ExtractedFont { family: string; raw?: string[] }                          // v3 (ADR-007): family is
                                            // normalized ('Avenir', 'system-ui'); raw = names as
                                            // found in computed styles, non-empty, unique, omitted
                                            // when it would equal [family]
ContactPoint { value: string; label?: string }                             // v2: as displayed
Location { label, address, phone?, hours?: HoursEntry[], googleBusinessUrl?: Url }  // v2: label
                                            // and address required; labels unique per site
Trust {                                                                     // v2
  foundedYear?: integer 1600–2100
  licenses: { number; authority? }[]
  ratings: { source; value: number >= 0; count?: integer >= 0 }[]          // e.g. Google 4.9 (514)
  credentials: { kind: 'certification' | 'membership' | 'award' | 'badge'; name; url?: Url }[]
}
ServiceArea { description?; places: string[]; radiusMiles?: number > 0 }   // v2: not all empty
Person { name; role?; locations?: string[] }                               // v2: locations are
                                            // business.locations labels

Page {
  path                                      // starts with '/'; unique within the site
  title, metaDescription?, ogImageAssetId?
  sections: Section[]
}

Section {
  id
  type: 'nav' | 'hero' | 'services' | 'about' | 'testimonials' | 'gallery' | 'pricing'
      | 'faq' | 'team' | 'contact' | 'booking' | 'map' | 'cta' | 'footer' | 'richtext'
      | 'menu'                              // v1: restaurant menus (not pricing)
      | 'features' | 'process'              // v2: benefits list; numbered steps
  content: {
    heading?, subheading?, body?,          // plain text or minimal markdown
    items?: {
      title?, body?, imageAssetId?, link?
      children?: { title?, body?, imageAssetId?, link? }[]   // v2: nav dropdowns, one level,
    }[]                                                      // only in 'nav' sections
    ctas?: {
      label, href                           // href as found: tel:, mailto:, relative all allowed
      kind: 'call' | 'email' | 'book' | 'link' | 'order' | 'pay'   // 'order' v1, 'pay' v2
      provider?: Slug                       // v1: e.g. 'toast', 'meevo', 'phorest'
    }[]
    imageAssetIds?: string[]
    form?: {                                                                // v2
      fields: {                             // at least one; visible fields only (no honeypots)
        label                               // as displayed
        type: 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea'
            | 'select' | 'radio' | 'checkbox' | 'file' | 'other'
        required: boolean
        options?: string[]                  // only on select, radio, checkbox
      }[]
      submitLabel?, confirmation?
    }
  }
  sourceSelector?: string                  // where it came from in the original DOM
  confidence: Confidence                   // mapper confidence; needsReview() when < 0.7
}

Asset {                                                                     // v1
  id, siteId
  kind: 'image' | 'logo' | 'font' | 'screenshot' | 'document'
  sourceUrl: Url
  storagePath?                              // Supabase Storage path
  width?, height?: positive integer
  bytes?: non-negative integer
  alt?: string                              // as found; '' = decorative. Feeds a11y checks
}

Variant {
  id, siteId
  name                                      // display name, e.g. 'Conservative'
  style: 'conservative' | 'modern' | 'bold'
  tokens: DesignTokens
  templates: Record<SectionId, TemplateId>  // which template renders each section
  status: 'draft' | 'approved' | 'shared' | 'selected'
                                            // approval lives on Version (ADR-005); 'approved',
                                            // 'shared', 'selected' need an approved Version
}

DesignTokens {
  color: { primary, secondary, accent, background, surface, text, mutedText }  // all HexColor
  font: { heading: GoogleFont, body: GoogleFont }
  typeScale: { base: number > 0, ratio: number > 0 }
  spacing: { unit: number > 0 }
  radius: 'none' | 'sm' | 'md' | 'lg'
}

GoogleFont { family: string; weights: integer 1–1000, at least one }       // v1

Version {                                   // immutable once approved (ADR-005)
  id, variantId
  number: integer >= 1                      // ADR-005: 1, 2, 3, ... per variant; unique per variant
  snapshot: { site: Site; variant: Variant }                                // v1: typed
  createdBy
  createdAt: IsoDateTime                                                    // v1 (user-approved)
  note                                      // may be ''
  approvedAt?: IsoDateTime                  // ADR-005: consultant approval (CLAUDE rule 4)
  approvedBy?: string                       // ADR-005
}                                           // approval invariant: see Constraints

Comment {
  id, versionId, sectionId?, x?, y?
  author: 'consultant' | 'client'
  body, resolved: boolean
  createdAt: IsoDateTime                                                    // v1 (user-approved)
}
```

## Capture records

Stored next to the Site, not inside it (tables `crawls` and `captured_pages`; no Site
`schemaVersion` change). The Site is what capture concluded; these records are what it saw.
Schemas: `packages/site-model/src/schemas/capture.ts`.

```
CaptureRun {                                                    // table crawls
  id, projectId, siteId?, startUrl: Url
  status: 'queued' | 'running' | 'done' | 'failed' | 'blocked'
  blockedReason?: GuardErrorCode | 'robots-disallowed' | 'bot-challenge'
  userAgent
  robots: { fetchedAt, status: 'ok' | 'missing' | 'error', crawlDelaySec? >= 0 }
  planned: Url[]                                                // at most 25
  skipped: { url: string, reason: 'robots' | 'cross-origin' | 'outside-path' | 'page-limit'
             | 'non-html' | 'bot-challenge' | 'error' }[]
  startedAt, finishedAt?
}
CapturedPage {                                                  // table captured_pages
  id, captureRunId, url, finalUrl, redirectChain: Url[], httpStatus: integer 100-599, fetchedAt
  htmlAssetId                                                   // Asset kind 'document'
  screenshots: { mobile: Id; desktop: Id }                      // Asset kind 'screenshot', full page
  facts: { mobile: PageFacts; desktop: PageFacts }
  axe?: { mobile: AxeSummary; desktop: AxeSummary }             // filled in by the axe runner
  pendingContent: { selector, placeholderText }[]               // still "Loading..." at the wait cap
}
AxeSummary { violations: { ruleId, impact?: 'minor'|'moderate'|'serious'|'critical', help,
                           nodes: { selector, box: Box }[] (max 10) }[] }
Box = { x, y, w, h: number >= 0 }          // CSS px in that viewport's full-page screenshot
Region = 'header' | 'nav' | 'main' | 'footer'
PageFacts {
  viewport: { width, height: positive integers }; documentWidth: number >= 0
  hasViewportMeta; protocol: 'http' | 'https'; title; metaDescription?
  headings: { level: 1-6; text; selector }[]
  links: { href (as found); resolved?: Url; text; selector; region; box; isToggle; targetExists? }[]
  phoneTexts: { text; digits; selector; region; insideTelLink }[]
  emails: { value; source: 'mailto' | 'text' | 'cfemail'; selector }[]
  hoursBlocks: { text; selector; region; heading? }[]
  jsonLd: Record<string, unknown>[]                  // parsed, not trusted
  iframes: { src: Url; srcOrigin: Origin; title?; box; provider?: Slug }[]
  forms: { selector; fields: { label?; type; required; hasLabel }[]; submitLabel? }[]
  images: { src: Url; bytes?: integer >= 0; natural: {w,h}; rendered: {w,h}; alt: string | null; selector }[]
  fonts: { raw; family; share: 0-1 }[]
  colors: { hex: HexColor; kind: 'text' | 'background'; share: 0-1 }[]
  interactive: { selector; box; kind: 'link' | 'button' | 'input' }[]   // mobile only
  footerText; copyrightYears: integer[]
  platformSignals: { generator?; bodyClasses: string[]; assetUrls: string[];
                     headers: Record<string,string>; footerText }
}
```

Constraints and policies:

- **CaptureRun** (`CaptureRunSchema`; `CaptureRunObjectSchema` is the same fields without the
  refinement): `planned` has at most 25 entries (Zod and the `crawls_planned_max` CHECK);
  `finishedAt >= startedAt` (Zod and the `crawls_finished_after_started` CHECK); a `blocked` run
  has a `blockedReason` and no other status has one; `done` and `failed` runs have a `finishedAt`
  (these two status rules are Zod only).
- **CapturedPage:** `httpStatus` is 100 to 599 (Zod and CHECK); `(captureRunId, url)` is unique
  (`captured_pages_run_url_unique`). Hidden copies and slider clones are dropped at extraction,
  not by the schema.
- **Numbers:** every `Box` value is >= 0; every `share` is 0 to 1; hex colors are lowercase.
- **Emails:** `emails[].value` rejects the `[email protected]` placeholder, so an obfuscated
  address must be decoded before it is stored.
- **Foreign keys:** `crawls.project_id` cascades from `projects`; `captured_pages.capture_run_id`
  cascades from `crawls` (so deleting a project removes both). `crawls.site_id` is optional and
  `ON DELETE SET NULL`: deleting a site keeps the crawl and clears `siteId`. Asset ids on
  `captured_pages` are not foreign keys.
- **Mappers:** `crawlToRow` / `rowToCrawl` and `capturedPageToRow` / `rowToCapturedPage`.

## Constraints

- **Strings are non-empty** unless noted. Exceptions (text copied from the client site, which
  may legitimately be empty): `Page.title`, `Page.metaDescription`, all `Section.content` text
  (`heading`, `subheading`, `body`, item `title`/`body`/`link`, cta `label`/`href`),
  `Section.sourceSelector`, `business.address`, `Location.phone`, `HoursEntry.label`,
  `FormField.label`, `form.submitLabel`/`confirmation`, `Asset.alt` (`''` = decorative) and
  `Version.note`. In capture records these may be empty: `PageFacts.title`, `metaDescription`,
  heading, link, phone and hours `text`, link `href`, hours `heading`, form field `label` and
  `submitLabel`, `footerText`, `placeholderText`. Derived strings (font `raw`/`family`, phone
  `digits`, form field `type`, axe `help`, `platformSignals.generator`) are non-empty. `ContactPoint.value`/`label`, `Location.label`/`address` and all v2 trust,
  service-area and person strings are non-empty.
- **Hex colors are lowercase** 6-digit (`#1a2b3c`).
- **Datetimes are UTC with a `Z` suffix** (`toISOString()` output); offsets like `+02:00` are rejected.
  Datetimes are UTC with millisecond precision, as produced by `toISOString()`.
- **Origin is bare.** `Consent.scope.origin` must equal `new URL(origin).origin`: no path,
  query, hash, trailing slash, default port or uppercase host. Path scoping is done only by
  `pathPrefix`.
- **Slugs are lowercase** (`^[a-z0-9][a-z0-9-]*$`): `socialLinks.network`, `cta.provider`,
  `platformDetails.builder`, and any `pageBuilder` outside the known list.
  `platformDetails.theme` stays as found.
- **Approval is per version** (CLAUDE rule 4, ADR-005): on a Version, `approvedAt` and
  `approvedBy` are both present or both absent, `approvedAt >= createdAt`, and
  `snapshot.variant.id === variantId`. An approved Version is never changed or deleted (a
  database trigger enforces this); any edit after approval is a new, unapproved Version. The
  client share link shows the newest approved Version. A Variant may only have `status`
  `'approved'`, `'shared'` or `'selected'` while it has an approved Version
  (`assertStatusAllowed`; not expressible in the Variant schema alone).
- **Uniqueness:** `Page.path` is unique within a site; `Section.id` is unique across all pages
  of a site; `Location.label` is unique within a site; `ExtractedFont.family` is unique within
  a site (v3). `ExtractedFont.raw`, when present, is non-empty, has no duplicates and is not
  just `[family]`.
- **References:** every `Person.locations` entry is the label of a `business.locations` entry.
- **Nav children** (one level) only appear in `nav` sections.
- **Other narrowings:** `Page.path` and `pathPrefix` start with `/`; `maxPages` is an integer
  1–25; GoogleFont weights are integers 1–1000; a `ServiceArea` has a description, a place
  or a radius; a form has at least one field.

`SiteSchema`, `SectionSchema` and `VersionSchema` carry cross-field refinements, and Zod 4 does
not allow `.pick`/`.omit`/`.extend` on refined objects. Derive from `SiteObjectSchema` /
`SectionObjectSchema` / `VersionObjectSchema` (same fields, no refinement), but always validate
with the refined schema.

## Helpers

- `needsReview(section)`: true unless `section.confidence >= REVIEW_CONFIDENCE_THRESHOLD` (0.7),
  so NaN or unvalidated input is flagged.
- `primaryPhone(business)` / `primaryEmail(business)`: the first entry, or undefined.
- `migrateSiteDoc(doc)` / `parseStoredSite(doc)` (ADR-006, ADR-007): bring a stored v1 or v2
  doc to v3 (then validate). v1 -> v2: `phone`/`email` become one-entry arrays; a v1 location
  without a label or address throws `SiteMigrationError`. v2 -> v3: `extractedFonts` strings
  become `{ family }` objects, de-duplicated by family. The DB mappers migrate Sites and
  Version snapshots on read.
- `SITE_SCHEMA_VERSION` (3), `MAX_CRAWL_PAGES` (25) and `APPROVAL_REQUIRED_STATUSES` are
  exported constants.
- Guards (`assertCrawlAllowed`, `assertShareable`, `resolveSharedVersion`, `assertStatusAllowed`,
  `assertExportable`, `assertVersionEditable`) are not part of the schemas; see T4 and ADR-005.
- Version history (ADR-005): `latestVersion`, `latestApprovedVersion`, `createVersion`,
  `saveEdit` (updates the newest version while it is unapproved, otherwise creates a new one)
  and `approveVersion` (newest version only, once).

## Rules

- Content comes from the client's site; agents may tighten wording only when a variant is
  explicitly marked "copy edits allowed".
- A section the mapper is unsure of keeps `confidence < 0.7` and shows in the review queue.
- Tokens must pass AA contrast for `text` on `background` and `surface` before save.
- Exporters only consume `Site` + one `Variant` with `status: 'selected'`.
- Stored JSONB Sites and Version snapshots must be migrated to the current `schemaVersion`
  before validation, because strict objects reject unknown keys (ADR-003). Use
  `parseStoredSite`; approved Version snapshots are frozen, so they are migrated on every read
  (ADR-006).
