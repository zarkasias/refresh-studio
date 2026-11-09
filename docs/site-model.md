# Site model

The single internal representation every phase reads or writes. Lives in
`packages/site-model` as Zod schemas; TypeScript types are inferred from them.

```ts
Site {
  id
  projectId
  sourceUrl
  platform: 'wordpress' | 'squarespace' | 'wix' | 'godaddy' | 'webflow' | 'custom' | 'unknown'
  platformDetails?: { theme?: string; pageBuilder?: 'elementor' | 'divi' | 'gutenberg' | string }
  business: {
    name, phone?, email?, address?, hours?, googleBusinessUrl?, socialLinks[]
  }
  brand: { logoAssetId?, extractedColors[], extractedFonts[] }   // what the current site uses
  pages: Page[]
}

Page {
  path, title, metaDescription?, ogImageAssetId?
  sections: Section[]
}

Section {
  id
  type: 'nav' | 'hero' | 'services' | 'about' | 'testimonials' | 'gallery' | 'pricing'
      | 'faq' | 'team' | 'contact' | 'booking' | 'map' | 'cta' | 'footer' | 'richtext'
  content: {
    heading?, subheading?, body?,          // plain text or minimal markdown
    items?: { title?, body?, imageAssetId?, link? }[]
    ctas?: { label, href, kind: 'call' | 'email' | 'book' | 'link' }[]
    imageAssetIds?: string[]
  }
  sourceSelector?: string                  // where it came from in the original DOM
  confidence: number                       // mapper confidence 0–1; < 0.7 flagged for review
}

Variant {
  id, siteId, name: string, style: 'conservative' | 'modern' | 'bold'
  tokens: DesignTokens
  templates: Record<SectionId, TemplateId>  // which template renders each section
  status: 'draft' | 'approved' | 'shared' | 'selected'
}

DesignTokens {
  color: { primary, secondary, accent, background, surface, text, mutedText }
  font: { heading: GoogleFont, body: GoogleFont }
  typeScale: { base: number, ratio: number }
  spacing: { unit: number }
  radius: 'none' | 'sm' | 'md' | 'lg'
}

Version { id, variantId, snapshot, createdBy, note }
Comment { id, versionId, sectionId?, x?, y?, author: 'consultant' | 'client', body, resolved }
```

## Rules

- Content comes from the client's site; agents may tighten wording only when a variant is
  explicitly marked "copy edits allowed".
- A section the mapper is unsure of keeps `confidence < 0.7` and shows in the review queue.
- Tokens must pass AA contrast for `text` on `background` and `surface` before save.
- Exporters only consume `Site` + one `Variant` with `status: 'selected'`.
