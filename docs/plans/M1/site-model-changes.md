# M1 section 2. Changes to the site model (these come first: T1–T3)

Part of the [M1 plan](../M1.md).

## 2a. Site document v3 (T1, ADR-007)

| Change | Why |
|---|---|
| `Site.schemaVersion: 3` | Required by any document shape change (ADR-003 consequence). |
| `brand.extractedFonts: ExtractedFont[]` where `ExtractedFont { family: string; raw?: string[] }`. `family` is the normalized name (`Avenir`, `DIN Next`, `system-ui`). `raw` lists the names as found in computed styles (`avenir-lt-w01_35-light1475496`), non-empty, unique, and omitted when it equals `family`. Families are unique per site. | Requirement 1 and M1-notes "Raw Wix font names". The raw name carries weight/style hints (`35-light`) and lets us debug a wrong normalization. The audit's font-count check and the M2 designer read `family`. |
| `KnownPageBuilderSchema` gains `'kadence-blocks'` and `'beaver-builder'` | Both appear in the manifest (jolly-plumbing, iphci) and currently pass through the open `Slug` branch. Making them known lets detection, exporter path selection and evals switch on them exhaustively. They were already valid slugs, so no data changes. |
| Migration step `v2ToV3` in `migrateSiteDoc`: `extractedFonts: string[]` → `[{ family }]`, de-duplicated by family | ADR-006 pattern. Read paths don't change. Approved Version snapshots are migrated on read, never rewritten (ADR-005). |

The 10 labels, the `_template` and `LABELING.md` move to v3 in the same PR, converted mechanically by the migration. Labels gain `raw` only where the labeler recorded it (none today).

**Alternative (D1):** keep `extractedFonts: string[]` (normalized) and put raw names only in capture records (2b). That needs no v3. It is rejected as the default because raw names then live outside the model the exporters read.

**Not changed:** sections, business, tokens, `platformEvidence.where`.

## 2b. Capture records (T2, new schemas in `packages/site-model/src/schemas/capture.ts`, migration 0003)

These are stored next to the Site, not inside it. The Site is what capture *concluded*; these records are what it *saw*, and the audit needs both.

```
CaptureRun {
  id, projectId, siteId?, startUrl: Url
  status: 'queued' | 'running' | 'done' | 'failed' | 'blocked'
  blockedReason?: GuardErrorCode | 'robots-disallowed' | 'bot-challenge'
  userAgent: string
  robots: { fetchedAt: IsoDateTime; status: 'ok' | 'missing' | 'error'; crawlDelaySec?: number }
  planned: Url[]                         // ≤ min(25, consent.scope.maxPages)
  skipped: { url: string; reason: 'robots' | 'cross-origin' | 'outside-path' | 'page-limit'
             | 'non-html' | 'bot-challenge' | 'error' }[]
  startedAt: IsoDateTime; finishedAt?: IsoDateTime
}
CapturedPage {
  id, captureRunId, url: Url, finalUrl: Url, redirectChain: Url[], httpStatus: integer
  fetchedAt: IsoDateTime
  htmlAssetId: Id                         // Asset kind 'document'
  screenshots: { mobile: Id; desktop: Id } // Asset kind 'screenshot', full page
  facts: { mobile: PageFacts; desktop: PageFacts }
  axe?: { mobile: AxeSummary; desktop: AxeSummary }   // T14; keyed per viewport (consultant decision, 2026-11-09)
  pendingContent: { selector: string; placeholderText: string }[]   // still "Loading..." at cap
}
Box = { x, y, w, h: number >= 0 }         // CSS px in that viewport's full-page screenshot
Region = 'header' | 'nav' | 'main' | 'footer'
PageFacts {
  viewport: { width, height }; documentWidth: number; hasViewportMeta: boolean
  protocol: 'http' | 'https'; title: string; metaDescription?: string
  headings: { level: 1–6; text: string; selector: string }[]
  links: { href: string /* as found */; resolved?: Url; text: string; selector; region: Region
           box: Box; isToggle: boolean /* aria-expanded|aria-haspopup|controls a submenu */
           targetExists?: boolean /* for same-page #id links */ }[]
  phoneTexts: { text: string; digits: string; selector; region: Region; insideTelLink: boolean }[]
  emails: { value: string; source: 'mailto' | 'text' | 'cfemail'; selector }[]
  hoursBlocks: { text: string; selector; region: Region; heading?: string }[]
  jsonLd: Record<string, unknown>[]       // parsed, not trusted; checks validate
  iframes: { src: Url; srcOrigin: Origin; title?: string; box: Box; provider?: Slug }[]
  forms: { selector; fields: { label?: string; type: string; required: boolean; hasLabel: boolean }[];
           submitLabel?: string }[]
  images: { src: Url; bytes?: integer; natural: {w,h}; rendered: {w,h}; alt: string | null; selector }[]
  fonts: { raw: string; family: string; share: number 0–1 }[]
  colors: { hex: HexColor; kind: 'text' | 'background'; share: number 0–1 }[]
  interactive: { selector; box: Box; kind: 'link' | 'button' | 'input' }[]   // mobile only
  footerText: string; copyrightYears: integer[]
  platformSignals: { generator?: string; bodyClasses: string[]; assetUrls: string[];
                     headers: Record<string,string>; footerText: string }
}
```

Tables: `crawls` (CaptureRun columns, `planned`/`skipped`/`robots` as JSONB) and `captured_pages` (`facts`, `axe` as JSONB), both cascading from `projects`. `crawls.site_id` is nullable and `ON DELETE SET NULL`, so rebuilding a Site keeps the crawl evidence (consultant decision, 2026-11-09). Hidden copies and slider clones never appear in `PageFacts`; that is enforced at extraction (T10).

## 2c. Audit and report records (T3, `packages/site-model/src/schemas/{audit,report}.ts`, migration 0004, ADR-008)

```
CheckId  = 'tel-matches-display' | 'tel-hidden-characters' | 'tap-to-call' | 'contact-above-fold-mobile'
         | 'form-works' | 'google-business-link' | 'hours-visible' | 'hours-consistent' | 'nap-consistent'
         | 'local-business-schema' | 'https' | 'h1-present' | 'dead-links' | 'text-contrast'
         | 'tap-targets' | 'no-horizontal-scroll' | 'nav-mobile' | 'image-weight' | 'title-meta'
         | 'dated-copyright' | 'placeholder-text' | 'font-count'
Severity = 'high' | 'medium' | 'low'
Evidence { kind: 'element' | 'metric' | 'text' | 'page'; pageUrl: Url; selector?; box?: Box
           viewport?: 'mobile' | 'desktop'; value?: string | number; note?: string }
CheckResult { id: CheckId; findingId: string /* `${id}:${hash(pageUrl, selector)}`, stable across reruns */
              passed: boolean; severity: Severity; pageUrl?: Url; evidence: Evidence[] (≥1 when failed)
              plainEnglish: string }       // skill shape plus findingId and pageUrl
ScoreKey = 'looksCurrent' | 'worksOnPhones' | 'easyToContact' | 'speed' | 'accessibility'
Score    { value: integer 0–100; contributions: { source: CheckId | `lighthouse:${string}` | `axe:${string}`;
           delta: number }[] }
AuditRun { id, projectId, siteId, captureRunId, createdAt
           toolVersions: { lighthouse: string; axe: string; audit: string /* @srs/audit version */ }
           lighthouse: { pageUrl; preset: 'mobile' | 'desktop'; performance, accessibility, bestPractices,
                         seo: number 0–1; lcpMs, tbtMs: number; cls: number; lhrAssetId: Id }[]
           checks: CheckResult[]; scores: Record<ScoreKey, Score>; weightsVersion: string }

ReportFinding { findingId; sentence: string; whyItMatters: string; pageUrl: Url; annotationAssetIds: Id[] }
ReportDoc { businessName; siteUrl: Url; auditedAt: IsoDateTime
            scores: Record<ScoreKey, Score>            // must equal recompute(auditRun, dismissed)
            summary: string; whatsWorking: string[] (1–2)
            fixNow: ReportFinding[] (0–5); canWait: ReportFinding[]
            dismissed: { findingId; reason: string; dismissedAt: IsoDateTime }[]
            draftSource: 'auditor-agent' | 'template' }
AuditReport   { id, projectId, auditRunId, createdAt }                              // relational
ReportVersion { id, reportId, number: integer >= 1, doc: ReportDoc, createdBy, createdAt, note
                approvedAt?, approvedBy? }      // ADR-005 rules: pair, >= createdAt, frozen, newest-only
ShareLink     { id, reportId, tokenHash /* sha256, token never stored */, createdAt, expiresAt, revokedAt? }
ReportExport  { id, reportVersionId, kind: 'pdf', storagePath, sha256, createdAt }
ReportDelivery{ id, reportVersionId, channel: 'email-pdf' | 'share-link', recipientName, sentAt }
```

Guards (pure, in `guards/report.ts`): `assertReportApprovable(version, auditRun)` (≤ 5 fix-now; every `findingId` exists in the AuditRun; `scores` equal the deterministic recomputation; no finding both dismissed and listed), `assertReportShareable(version)` (`approvedAt` set), `resolveSharedReportVersion(history)` (newest approved), and `assertDeliverable(delivery, version)`. Versioning: extract a generic `versioning/history.ts` core parameterized by owner key, keep the variant API unchanged, and add `reportHistory` wrappers. The DB gets `report_versions_freeze_approved` (same trigger as 0002) and the same CHECKs as `versions`.
