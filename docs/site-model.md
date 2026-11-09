# Site model

The single internal representation every phase reads or writes. Lives in
`packages/site-model` as Zod schemas (`src/schemas/*.ts`); TypeScript types are inferred from
them with `z.infer`. Each entity is exported as `XSchema` plus type `X`. Valid test fixtures
live in `@srs/site-model/fixtures`.

Current version: **v1** (`Site.schemaVersion: 1`). Fields marked `// v1` were added by the M0
plan, section 2, or are user-approved additions recorded in ADR-003. All objects are strict:
unknown keys are rejected. See **Constraints** below for the rules that apply across entities.

```ts
// Primitives
Id          = string, non-empty
HexColor    = string matching ^#[0-9a-f]{6}$ (lowercase, 6 digits)          // v1
IsoDateTime = ISO 8601 datetime in UTC, e.g. 2026-11-09T12:00:00.000Z
Confidence  = number, 0–1 inclusive
Url         = absolute http(s) URL
Origin      = bare http(s) origin, exactly new URL(v).origin, e.g. https://a.com  // v1
Slug        = string matching ^[a-z0-9][a-z0-9-]*$, e.g. 'toast', 'beaver-builder'  // v1

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
  schemaVersion: 1                                                          // v1
  sourceUrl: Url
  platform: 'wordpress' | 'squarespace' | 'wix' | 'godaddy' | 'webflow'
          | 'custom'                        // hand-coded
          | 'other-hosted'                  // v1: hosted builder not listed (see builder)
          | 'unknown'
  platformDetails?: {
    theme?: string                          // as found, not slugified
    pageBuilder?: 'elementor' | 'divi' | 'gutenberg' | 'wpbakery' | Slug    // 'wpbakery' is v1
    builder?: Slug                          // v1: e.g. 'bentobox', 'chiroplanet'
  }
  platformEvidence: { signal: string; where: 'html' | 'header' | 'asset-url' | 'footer-text' }[]  // v1
  platformConfidence: Confidence                                            // v1
  business: {
    name, phone?, email?, address?
    hours?: HoursEntry[]                    // v1: raw text, not parsed
    googleBusinessUrl?: Url
    socialLinks: { network: Slug; url: Url }[]                              // v1: typed
    locations?: Location[]                  // v1: extra locations; top-level fields = primary
  }
  brand: {                                  // what the current site uses
    logoAssetId?
    extractedColors: { hex: HexColor; role?: string; share?: number 0–1 }[]  // v1: typed
    extractedFonts: string[]                // family names as found
  }
  pages: Page[]                             // Page.path unique; Section.id unique across all pages
}

HoursEntry { label?: string; text: string }                                 // v1
Location { label?, address?, phone?, hours?: HoursEntry[], googleBusinessUrl?: Url }  // v1
                                            // at least one field required ({} is rejected)

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
  content: {
    heading?, subheading?, body?,          // plain text or minimal markdown
    items?: { title?, body?, imageAssetId?, link? }[]
    ctas?: {
      label, href                           // href as found: tel:, mailto:, relative all allowed
      kind: 'call' | 'email' | 'book' | 'link' | 'order'   // 'order' is v1
      provider?: Slug                       // v1: e.g. 'toast', 'meevo', 'phorest'
    }[]
    imageAssetIds?: string[]
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
  approvedAt?: IsoDateTime                  // v1: consultant approval (CLAUDE rule 4)
  approvedBy?: string                       // v1
}                                           // approval invariant: see Constraints

DesignTokens {
  color: { primary, secondary, accent, background, surface, text, mutedText }  // all HexColor
  font: { heading: GoogleFont, body: GoogleFont }
  typeScale: { base: number > 0, ratio: number > 0 }
  spacing: { unit: number > 0 }
  radius: 'none' | 'sm' | 'md' | 'lg'
}

GoogleFont { family: string; weights: integer 1–1000, at least one }       // v1

Version {
  id, variantId
  snapshot: { site: Site; variant: Variant }                                // v1: typed
  createdBy
  createdAt: IsoDateTime                                                    // v1 (user-approved)
  note                                      // may be ''
}

Comment {
  id, versionId, sectionId?, x?, y?
  author: 'consultant' | 'client'
  body, resolved: boolean
  createdAt: IsoDateTime                                                    // v1 (user-approved)
}
```

## Constraints

- **Strings are non-empty** unless noted. Exceptions (text copied from the client site, which
  may legitimately be empty): `Page.title`, `Page.metaDescription`, all `Section.content` text
  (`heading`, `subheading`, `body`, item `title`/`body`/`link`, cta `label`/`href`),
  `Section.sourceSelector`, `business.phone`/`email`/`address`, `Location` text fields,
  `HoursEntry.label`, `Asset.alt` (`''` = decorative) and `Version.note`.
- **Hex colors are lowercase** 6-digit (`#1a2b3c`).
- **Datetimes are UTC with a `Z` suffix** (`toISOString()` output); offsets like `+02:00` are rejected.
- **Origin is bare.** `Consent.scope.origin` must equal `new URL(origin).origin`: no path,
  query, hash, trailing slash, default port or uppercase host. Path scoping is done only by
  `pathPrefix`.
- **Slugs are lowercase** (`^[a-z0-9][a-z0-9-]*$`): `socialLinks.network`, `cta.provider`,
  `platformDetails.builder`, and any `pageBuilder` outside the known list.
  `platformDetails.theme` stays as found.
- **Approval invariant** (CLAUDE rule 4): `approvedAt` and `approvedBy` are both present or both
  absent, and `status` `'approved'`, `'shared'` or `'selected'` requires both. A `'draft'` may
  keep a previous approval.
- **Uniqueness:** `Page.path` is unique within a site; `Section.id` is unique across all pages
  of a site.
- **Other narrowings:** `Page.path` and `pathPrefix` start with `/`; `maxPages` is an integer
  1–25; GoogleFont weights are integers 1–1000; a `Location` has at least one field.

`SiteSchema` and `VariantSchema` carry cross-field refinements, and Zod 4 does not allow
`.pick`/`.omit`/`.extend` on refined objects. Derive from `SiteObjectSchema` /
`VariantObjectSchema` (same fields, no refinement), but always validate with the refined schema.

## Helpers

- `needsReview(section)`: true unless `section.confidence >= REVIEW_CONFIDENCE_THRESHOLD` (0.7),
  so NaN or unvalidated input is flagged.
- `SITE_SCHEMA_VERSION` (1), `MAX_CRAWL_PAGES` (25) and `APPROVAL_REQUIRED_STATUSES` are
  exported constants.
- Guards (`assertCrawlAllowed`, `assertShareable`, `assertExportable`) are not part of the
  schemas; see T4.

## Rules

- Content comes from the client's site; agents may tighten wording only when a variant is
  explicitly marked "copy edits allowed".
- A section the mapper is unsure of keeps `confidence < 0.7` and shows in the review queue.
- Tokens must pass AA contrast for `text` on `background` and `surface` before save.
- Exporters only consume `Site` + one `Variant` with `status: 'selected'`.
- Stored JSONB Sites and Version snapshots must be migrated to the current `schemaVersion`
  before validation, because strict objects reject unknown keys (ADR-003).
