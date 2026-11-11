# 008 — Audit records and report approval

- **Date:** 2026-11-09
- **Status:** accepted (consultant approved the M1 plan defaults D1–D21, 2026-11-09)

## Context

M1 turns a captured site into an audit report a client can read. Two rules shape it.

- **Rule 2:** scores come from Lighthouse, axe-core and our own checks, never from an LLM.
- **Rule 4:** nothing reaches a client without an explicit consultant approval (`approvedAt`).

The PRD ("2. Audit", "Consultant edits") also lets the consultant reword the report, move
findings between "fix now" and "can wait", and dismiss a finding that is a false positive. That
creates two risks. A report that keeps changing after approval would reach the client without
anyone approving it (the problem ADR-005 solved for variants). And a consultant who can edit a
score can make the numbers say whatever he likes, which breaks rule 2.

## Decision

Add audit and report records to `packages/site-model` (plan section 2c; no Site
`schemaVersion` change; migrations 0004 and 0005: 0004 adds the tables, 0005 adds the freeze trigger).

- **AuditRun** is what the tools measured for one capture: Lighthouse summaries, `CheckResult`s
  (each with a stable `findingId`, severity, evidence and a plain-English sentence) and five
  scores, each with its list of `contributions`. It holds no LLM output and is not edited.
- **A report is the consultant's wording of an AuditRun.** `AuditReport` is the relational row;
  its content lives in `ReportVersion.doc` (`ReportDoc`).
- **ReportVersion follows ADR-005.** Numbered per report, unique `(report_id, number)`.
  An approved version is frozen (the trigger `report_versions_freeze_approved`, the same as
  `versions_freeze_approved`). An edit after approval creates version n+1. Only the newest version
  can be approved, once. The share link and the PDF show an approved version only
  (`assertReportShareable`, and `resolveSharedReportVersion(link, history, now)` for links).
- **Scores are copied from the AuditRun and checked before approval.** `ReportDoc.scores` must
  equal `recomputeScores(auditRun, dismissed)`. That function lives in site-model so the guard can
  use it without importing `packages/audit`. It starts at 100, adds the deltas in each score's
  `contributions`, drops the contributions of checks whose failed findings are all dismissed,
  rounds and clamps to 0-100. `packages/audit` (T20) must write contributions it can reproduce
  (`recomputeScores(run, [])` equals `run.scores`).
- **Dismissals are recorded and deterministic.** Dismissing a finding as a false positive needs a
  reason and a timestamp, is stored on the version, and changes the scores only through
  `recomputeScores`. A finding cannot be both dismissed and listed.
- **`assertReportApprovable`** refuses a report that is not safe to approve. New
  `GuardErrorCode`s: `fix-now-limit` (more than 5), `unknown-finding` (not a failed check in the
  AuditRun; a check that passed cannot be listed or dismissed), `listed-twice` (a finding appears
  twice in fix now, can wait and dismissed), `dismissed-and-listed`, `unlisted-finding` (every
  failed finding must be in fix now, can wait or dismissed: the consultant decides each one),
  `scores-mismatch`, `empty-copy` (blank summary, "what's working" line, or finding sentence or
  "why it matters"; `note` is exempt), plus `delivery-mismatch` and `sent-before-approval`.
- **`approveReport(history, versionId, approval, report, auditRun)`** is the approval step the
  editor (T30) calls. It checks the version and AuditRun belong to the report (`report-mismatch`),
  approves through `approveReportVersion` (newest only, once: `not-latest`), then runs
  `assertReportApprovable`. Calling `approveReportVersion` alone skips the content checks.
- **`resolveSharedReportVersion(link, history, now)`** is what a client link shows: the newest
  approved version of the link's report. It throws `link-mismatch` (link or history is for another
  report), `link-revoked`, `link-expired` (both read "This link has expired") or `not-approved`.
  `ShareLink.expiresAt` must be later than `createdAt` (Zod refinement and CHECK
  `share_links_expires_after_created`). `requireNewestApprovedReportVersion(history)` is the
  link-free building block and is not for client-facing code.
- **Share tokens are stored hashed.** `ShareLink` has `tokenHash` (SHA-256 hex) and no token
  field. `ReportExport` stores the PDF's sha256. `ReportDelivery` records "mark as sent";
  `assertDeliverable` requires an approved version sent after its approval.
- **Generic versioning core.** `versioning/core.ts` holds the history rules parameterized by owner
  key. The variant API (`saveEdit`, `approveVersion`, ...) is unchanged; `reportHistory` binds the
  same rules to `ReportVersion` and `reportId`.
- **Database.** Tables `audit_runs`, `audit_reports`, `report_versions`, `share_links`,
  `report_exports`, `report_deliveries`; the audit tables cascade from `projects`. `report_versions`,
  `report_exports` and `report_deliveries` are `ON DELETE RESTRICT` toward their parent. They
  record what a client saw, like `versions`. `report_versions` has the same CHECKs as `versions`.

## Alternatives considered

- **Let the consultant edit scores.** Rejected: it breaks rule 2. Dismissal with a reason covers
  the real need (a penalty we admit is wrong).
- **Recompute scores in `packages/audit` only.** The guard would need to import `packages/audit`
  or take a callback; site-model would depend on its consumer. Contributions are already in the
  AuditRun, so a small pure function in site-model does the job. The cost is that T20 and this
  function must agree, which the T20 tests assert.
- **Approval on the report, not the version.** The same flaw ADR-005 found for variants: a later
  edit would reach the client unapproved and there would be no record of what they saw.
- **Store the raw share token** so the consultant can re-copy the link. Rejected: a database leak
  would expose every private report. A lost link is revoked and replaced.
- **Duplicate the history code for reports.** Two copies would drift; the approval rules are the
  same, so one core serves both.

## Consequences

- One more freeze trigger. The report guards and the DB cannot enforce cross-record rules such as
  "a delivery points at an approved version"; the guard and `gate:m1` do.
- A contribution names a check, not a finding. If a check failed on several pages, dismissing one
  finding does not change the score; the score changes once all its findings are dismissed. A
  per-finding split would need `findingId` on a contribution, which is a later model change.
- "Looks current" is deterministic in M1 (D2): https, dead links, dated copyright, placeholder
  text, font count and the viewport tag. LLM visual notes may be text, never a score input.
- A project whose reports have versions cannot be deleted (RESTRICT), as with variants.
- Editable report copy (summary, sentences, "why it matters") may be empty in a draft, but
  approval rejects it (`empty-copy`). The editor (T30) should also show this before the click.
- **Known M1 limit, strict partial dismissal.** A score changes only when all of a check's failed
  findings are dismissed. Dismissing some of them leaves the score as it was.
- **Retention (D18).** The 90-day purge of raw captures keeps the crawl row and the crop assets
  that a report version refers to, so an approved report's evidence still resolves.
- Report approval has the same shape as variant approval, so the editor (T30), renderer (T31),
  PDF export (T32) and `gate:m1` (T33) all rest on one tested pattern.
