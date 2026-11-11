# T8a: Fixture-only loopback URL schema

Part of the [M1 plan](../M1.md).

| # | Task | Owner | Package/dir | Depends on | PRD / rule |
|---|---|---|---|---|---|
| T8a | ✅ Fixture-only loopback URL schema | capture-engineer *(flagged; architect reviews)* | `packages/site-model`, `evals/fixtures` | T2, T4 | rules 5–6; ADR-010 |

## Details

**T8a Fixture-only loopback URLs (prerequisite for T8; consultant decision, 2026-11-09).** The production `UrlSchema` stays strict (no loopback hosts), so a real project can never target localhost from the worker. `packages/site-model` adds a separate fixture-only URL schema that also accepts `http://127.0.0.1:<port>`, `localhost` and `[::1]`, and a way to validate capture records, Projects and Sites against it in tests and fixture runs only (for example a schema factory parameterized by the URL schema). Production code paths (`rowTo*` mappers, jobs, the app) always use the strict schema. `evals/fixtures` `fixtureProject` drops its tolerated-issue workaround and validates fully with the fixture schema. Recorded in ADR-010. *Acceptance:* the strict schemas still reject `http://127.0.0.1:3000/`; the fixture variants accept it; `fixtureProject` validates fully; a lint rule or test shows the fixture schema isn't imported outside `evals/` and test files.

## Linked sections

- [Consent, fixtures and network policy](consent-and-network.md).
- [ADR-010](../../decisions/010-fixtures-without-crawling.md).
