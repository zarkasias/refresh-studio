# Site Refresh Studio

Consultant-operated tool for Chambers Consulting. Turns a small business's URL into
an audit, 2–3 redesign options, and a handoff that fits the client's platform.
Positioning: "a better website for your small business, without starting over."

Read `docs/PRD.md` before planning any phase. Read `docs/site-model.md` before touching
anything that reads or writes site data.

## Non-negotiable rules

1. **The site model is the center.** Every phase reads or writes the site model
   (`packages/site-model`). Agents never edit raw client HTML. Exporters render from the model.
2. **Tools measure, agents judge, the consultant approves.** Scores come from Lighthouse,
   axe-core and our own checks, never from an LLM. LLM output is interpretation and generation.
3. **Every in-product agent returns JSON validated by a Zod schema.** No free-text parsing.
4. **Nothing reaches a client without a consultant approval step** (an explicit `approvedAt`
   on the record).
5. **Consent first.** A crawl job refuses to run without `project.consent` recorded.
6. **Same domain only, max 25 pages per crawl.** Respect robots.txt.
7. **Accessibility is a gate, not a nice-to-have.** Generated variants must pass WCAG AA
   contrast and 44px tap targets before they can be shown.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js (App Router) + TypeScript, pnpm workspaces |
| Data | Postgres via Supabase, Drizzle ORM |
| Storage | Supabase Storage (screenshots, assets, export zips) |
| Jobs | Inngest (crawl, audit, generate, export) |
| Capture | Playwright (Chromium) |
| Audit | Lighthouse (node API), @axe-core/playwright, custom checks |
| AI | Claude Agent SDK / Claude API, structured output + Zod |
| Editor | Puck (decide vs GrapesJS in M2 spike) |
| UI | Tailwind + our section library in `packages/sections` |
| Exporters | `packages/exporters/{wordpress-theme,style-guide,astro-site}` |

## Repo layout

```
apps/web                 Next.js app (consultant dashboard + client review links)
packages/site-model      Types, Zod schemas, migrations for the site model
packages/capture         Playwright crawler, platform detection
packages/audit           Lighthouse/axe runners, small-business checks, scoring
packages/agents          In-product agents (auditor, mapper, designer, design-qa, feature-planner, verifier)
packages/sections        Section components + templates, driven by design tokens
packages/exporters       wordpress-theme, style-guide, astro-site
evals/                   Test-site set + eval scripts for each agent
docs/                    PRD, site model, decisions (docs/decisions/NNN-*.md)
```

## Commands

```
pnpm dev                 run the web app
pnpm typecheck           tsc across workspaces
pnpm lint
pnpm test                vitest
pnpm test:e2e            playwright tests
pnpm eval:mapper         run content-mapper evals against evals/sites
pnpm eval:auditor
```

## How we work with Claude Code

- One phase (milestone) at a time: `/plan-phase M1` → review → `/build-phase M1` → `/review`.
- The **architect** subagent plans and splits work; specialists build in their own package.
- Record any architecture decision in `docs/decisions/` (short ADR: context, decision, consequences).
- Prefer small PR-sized changes. Run `pnpm typecheck && pnpm test` before declaring done.
- When a behavior is defined in the PRD, cite the PRD section in the PR description.

## Style

- TypeScript strict. No `any` in package public APIs.
- Pure functions in `packages/*`; side effects (DB, storage, network) at the edges.
- Copy written for clients is plain English, no jargon ("your phone number isn't tappable on
  phones", not "missing tel: href").
