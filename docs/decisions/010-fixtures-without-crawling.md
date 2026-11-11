# 010 — Fixtures without crawling (amends ADR-004)

- **Date:** 2026-11-09 (factory decision added 2026-11-11)
- **Status:** accepted (consultant decision, 2026-11-09)

## Context

ADR-004 says evals use hand labels plus synthetic fixtures that copy "a pattern, never content",
and that sites without consent are never crawled. The consultant asked for synthetic HTML built
from the labels, so M1 capture, audit and report code can be tested without the internet. M1
(plan sections 4 and 7) also needs every capture test to run on loopback, which the production
`UrlSchema` rightly rejects: a real project must never be able to target localhost from the worker.

## Decision

- **Anonymize first.** Label-derived synthetic sites are allowed only after anonymization
  (T5, `evals/fixtures/anonymize`): structure and patterns are kept; names, phones, emails,
  addresses and people are fictional. `extraIdentityFor` adds per-site identity strings (owner
  names, local place names) to the leak check. Pattern fixtures with no label behind them need no
  anonymization.
- **Fixture-only loopback URLs (T8a).** The production `UrlSchema` and everything built on it stay
  strict. `@srs/site-model/fixture-urls` adds `FixtureUrlSchema` (plain `http:` on `127.0.0.0/8`,
  `localhost` or `[::1]`, optional port, no credentials, plus everything strict accepts) and
  `Fixture*` variants of every URL-bearing record. They may be imported only from `evals/` and
  `*.test.ts`, enforced by ESLint (`no-restricted-imports` for static imports, `no-restricted-syntax`
  for dynamic `import()` and `require()`, including template literals), with negative tests, plus a
  repo-scan test. `rowTo*` mappers, jobs and the app always use the strict schemas. `fixtureProject`
  validates fully with `FixtureProjectSchema`.
- **Factories, not copies (consultant chose this over smaller options on 2026-11-11).** Each
  URL-bearing schema module exports `makeXSchemas(urls)`; the strict export calls it with
  `STRICT_URLS`, the fixture variant with `FIXTURE_URLS`. Bodies and `superRefine` rules are
  written once. Strict names, values and inferred types do not change; a type-level test checks
  that the fixture type of every top-level record equals its strict type (inputs and outputs).
- **Network-off tests.** Every capture test runs against the loopback fixture server with external
  requests aborted (T4). CI never touches the internet.
- **Real captures only through `selectNetworkEligible`.** Real fetches, screenshots and
  Lighthouse runs happen only for sites with recorded consent (own site, later consenting
  prospects).

## Alternatives considered

- A schema-tree rewriter that swaps the URL schema using Zod internals: no restructure, but it breaks
  silently on Zod upgrades.
- Fixture variants for `Project` and capture records only: smaller diff, but T10 to T13 need `Site`
  and `Asset` too, so the work would be done twice.
- Reserved `.test` hostnames mapped to the fixture server with Chromium `--host-resolver-rules`: no
  schema change, but Node-side fetches (robots.txt, Lighthouse) do not follow Chromium's resolver
  rules, so the fixture run would not exercise the same network path.
- Loosening `UrlSchema` globally, or a runtime flag: a real project could then target localhost.
- Tolerating the loopback schema issues in `fixtureProject` (the M1 T4 workaround): it hid the real
  validation result and had to be hand-checked.

## Consequences

- Evals measure how we handle known patterns, not real-world accuracy, until consenting prospects
  add real fixtures.
- The schema modules are wrapped in factories; new URL fields go inside the factory and get the
  fixture variant for free. A new URL-bearing record needs a `make...` factory and a `Fixture*`
  export in `fixture-urls/index.ts`; a coverage test fails if one is missing.
- The loopback host check is copied into site-model (it cannot import from `evals/`); a test pins
  it to `isLoopbackHost` in `evals/fixtures/network-policy.ts`.
- The factories are internal: `make*Schemas`, `memoOnUrls`, `STRICT_URLS`, `UrlSchemas` and `UrlLike`
  are lint-guarded (`no-restricted-imports` with `importNamePattern` on `@srs/site-model`, allowed only
  in `packages/site-model` and `evals/`), because a factory called with a custom URL schema would
  bypass the strict rule. A coverage test fails if a URL-bearing schema lacks its `Fixture*` twin.
- Pure capture and audit functions return typed records and do not parse with site-model schemas
  internally; validation happens at the edge (strict in jobs and mappers, `Fixture*` in tests).
- The strict `UrlSchema` still accepts names that resolve to loopback (`*.localhost`, DNS pointing at
  127.0.0.1) and private addresses. T8's guarded network path must therefore block loopback and
  private addresses after DNS resolution and on the final URL after redirects, not rely on the schema.
- Fixture URLs must be canonical: the host is spelled `127.x.x.x`, `localhost` or `[::1]` and the
  value equals what `new URL` makes of it, so `2130706433`, `0177.0.0.1`, `127.1`, `localhost.` and
  Unicode look-alikes are not treated as loopback.
