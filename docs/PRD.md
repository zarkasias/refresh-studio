# Site Refresh Studio — PRD (repo copy)

The full, living PRD is the Claude doc "Site Refresh Studio — PRD". This file is the
condensed copy Claude Code reads. If they disagree, the doc wins; update this file.

## Summary

Consultant-operated tool: URL → audit → 2–3 redesign options → client review → handoff
that fits the client's platform → before/after verification. Productizes Chambers
Consulting's "improve the site you already have" service for small businesses.

## Users

- **Consultant (David):** runs every engagement, approves every agent output.
- **Business owner:** no login; reviews via private link, leaves comments, picks a favorite.

## Goals

- Under 2 hours of consultant time from URL to client-ready audit + options.
- Measurable before/after on: looks current, works on phones, easy to contact (+ speed, a11y).
- Handoff the client's platform can use.

## Non-goals (v1)

Self-serve signup; retrofitting custom codebases; e-commerce rebuilds.

## Phases and requirements

### 1. Capture
- Crawl ≤ 25 same-domain pages (sitemap + homepage links), respect robots.txt.
- Save DOM, screenshots at 390px and 1440px, images, fonts, colors in use.
- Detect platform + theme/page builder.
- Require recorded client consent.

### 2. Audit
- Lighthouse (mobile + desktop) and axe-core per page.
- Small-business checks: tappable phone (`tel:`), contact/booking above the fold on mobile,
  tap targets ≥ 44px, LocalBusiness schema, name/address/phone consistency, Google Business
  Profile link, image weight.
- Scores 0–100: Looks current, Works on phones, Easy to contact, Speed, Accessibility.
- Plain-English report: top 5 fixes, what can wait, annotated screenshots. Consultant edits.

### 3. Redesign options
- Mapper turns DOM → site model.
- Designer generates 2–3 variants (conservative / modern / bold) as tokens + templates.
- Real content, logo, photos kept.
- Editor: token panel, Google Fonts, section swap, text edits, mobile/desktop toggle.
- Design QA blocks variants failing contrast / tap targets / overflow.

### 4. Client review
- Private share link, pinned comments, version snapshots, pick-a-favorite.
- Consultant merges feedback into a final version.

### 5. New features
- Requests become new sections/pages from the same library; show effort + supported paths.

### 6. Handoff
- WordPress: child theme or `theme.json` + CSS, block patterns; zip.
- Squarespace / Wix / GoDaddy: style guide (hex, fonts, sizes) + click-by-click checklist.
- Rebuild: Astro static site, contact form, deploy to Netlify / Cloudflare Pages or zip.

### 7. Verify
- Re-run audit on the result; before/after report.

## In-product agents

| Agent | Output | Gate |
| --- | --- | --- |
| Auditor | Scored report, top 5 fixes | Consultant edits |
| Content mapper | Site model | Consultant fixes low-confidence sections |
| Designer | 2–3 token sets + templates | Consultant picks |
| Design QA | Issues list | Auto-blocks failures |
| Feature planner | New sections, effort | Consultant approves scope |
| Exporter | Theme zip / style guide / Astro project | — |
| Verifier | Before/after report | Consultant signs off |

## Milestones

| Milestone | Scope | Gate to move on |
| --- | --- | --- |
| M0 Foundation | Repo, site model schema, Claude Code kit, hooks, test set of 10–15 sites | Schema holds up against test set |
| M1 Audit MVP | Capture, platform detection, Lighthouse + axe, auditor, report | Report sent to 3 real prospects |
| M2 Options + editor | Mapper, designer, design QA, editor spike, share link, comments | Mapper reads every test site with only minor fixes |
| M3 Handoff | WordPress + style-guide exporters, verifier | One paid engagement end to end |
| M4 Rebuild + leads | Astro exporter + deploy, contact-form mini-audit | — |

## Risks

Mapper accuracy on messy sites; generic-looking variants; page-builder WordPress sites
(Elementor/Divi → treat as style-guide path until proven); crawl consent; scope creep into a
full site builder.
