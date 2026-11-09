# Claude Code kit — Site Refresh Studio

Drop these files into the root of a new repo, then open it with `claude`.

## What's here

```
CLAUDE.md                          project memory: rules, stack, layout, commands
.mcp.json                          Playwright MCP server (Claude can drive a real browser)
.claude/settings.json              permissions + a typecheck hook after every edit
.claude/agents/                    subagents
  architect.md                     plans milestones, assigns tasks (no code)
  capture-engineer.md              crawler, screenshots, platform detection
  audit-engineer.md                Lighthouse, axe, small-business checks, scores
  agent-engineer.md                in-product AI agents + evals (Agent SDK)
  design-system-engineer.md        section components, templates, design tokens
  editor-engineer.md               WYSIWYG token editor + client review links
  exporter-engineer.md             WordPress theme, style guide, Astro rebuild, deploy
  qa-reviewer.md                   independent review against PRD + rules
.claude/commands/                  slash commands
  plan-phase.md                    /plan-phase M1
  build-phase.md                   /build-phase M1 [task]
  review.md                        /review
  audit-site.md                    /audit-site <url>
  eval.md                          /eval mapper
.claude/skills/
  small-business-audit/            the checks, scores and report wording
  wordpress-theme-export/          theme.json mapping and child-theme rules
docs/PRD.md                        condensed PRD (the Claude doc is the living version)
docs/site-model.md                 the central data model
docs/decisions/000-template.md     ADR template
```

## First session

1. `git init`, copy the kit in, commit.
2. Run `claude`, then `/mcp` to confirm the Playwright server connects.
3. Run `/agents` to confirm the subagents load.
4. `/plan-phase M0` → read `docs/plans/M0.md` → answer its decisions.
5. `/build-phase M0`. The typecheck hook only bites once `pnpm typecheck` exists; until the
   workspace is scaffolded, remove the hook or expect it to report failures.

## The loop for every milestone

`/plan-phase Mx` → you review → `/build-phase Mx` → `/review` → you test with
`/audit-site https://www.chambers-consulting.dev` (your own site is the safest first target)
→ check the gate in the PRD → next milestone.

## Tips

- Keep `docs/PRD.md` in sync with the Claude doc; the subagents read the repo copy.
- Subagent `model:` values (opus / sonnet) are a starting split: heavier reasoning for
  planning, agent design and review; faster models for package building. Adjust freely.
- Headless runs for batch work, e.g.
  `claude -p "/eval mapper" --output-format json` in CI or a nightly script.
- When a subagent keeps making the same mistake, fix its `.md` file rather than repeating
  yourself in chat.
