# 001 — Monorepo tooling

- **Date:** 2026-11-09
- **Status:** accepted

## Context

M0 needs a workspace where `pnpm typecheck`, `pnpm lint` and `pnpm test` run from the root across
`apps/web`, every package in the CLAUDE.md repo layout and `evals` (M0 plan, gate item 1, T1). The
typecheck hook in `.claude/settings.json` and CI (T2) both depend on those commands. Decisions D1,
D2, D3, D6 and D11 from the M0 plan are recorded here.

## Decision

- **pnpm workspaces** (`apps/*`, `packages/*`, `packages/exporters/*`, `evals`). Packages are
  scoped `@srs/*` (D6) and have unique unscoped names, so `pnpm --filter capture` resolves.
- **Internal TS packages**: each package's `exports` points at TypeScript source. Next.js compiles
  them with `transpilePackages`. There's no build step for packages.
- **TypeScript strict** (`tsconfig.base.json`, plus `noUncheckedIndexedAccess`), pinned to the
  6.0 line because typescript-eslint doesn't support TS 7 yet.
- **ESLint (flat config) + typescript-eslint + Prettier** (D2), not Biome. We need per-directory
  `no-restricted-imports` (ADR-002), `jsx-a11y` and the Next rules. ESLint is held at 9 because
  `eslint-plugin-jsx-a11y` only declares support for ESLint 9.
- **Vitest** with `test.projects` (an explicit list, so a new workspace has to be added by hand).
  **Playwright + axe** for `apps/web` e2e (`pnpm test:e2e`, own server on :3100).
- **Database tests on PGlite** (in-process Postgres). The Supabase project is deferred to M1 (D1).
- **Node 22 LTS + pnpm 9.15.9**, pinned by `.nvmrc`, `engines` and `packageManager`. This
  **deviates from D3** (Node 24 / pnpm 10): they are the toolchain installed on the consultant's
  machine, and Node 24 wasn't. Moving up later is a one-line change.
- Tooling and site-model work is owned by the existing subagents for M0 (D11). Add a
  `platform-engineer` agent if that causes friction.

## Alternatives considered

- Biome: faster, but it can't do the per-directory import boundaries or the a11y/Next rules we
  need.
- Built packages (tsup/tsc emit): extra build step and watch complexity for no gain inside one app.
- Supabase local or cloud for tests: needs Docker or network and a project. PGlite runs in
  `pnpm test` with nothing installed.
- Node 24 / pnpm 10 now: would have meant installing a new toolchain mid-build. Deferred.

## Consequences

- One root command chain gates every PR (CI: `.github/workflows/ci.yml`). The user re-enables the
  typecheck hook once it passes.
- TS 7 and ESLint 10 upgrades wait on typescript-eslint and jsx-a11y.
- `engines.node` is a lower bound (`>=22.12`) and isn't strictly enforced. Revisit with
  `engine-strict` when we move to Node 24.
- Playwright needs `playwright install chromium` on a fresh machine. CI doesn't run e2e yet.
