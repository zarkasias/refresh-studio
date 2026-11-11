# M1 section 8. Tests and evals (summary)

Part of the [M1 plan](../M1.md).

| Task | Proof |
|---|---|
| T1–T3 | Vitest schema, migration and guard tests; PGlite migrations 0003–0004 plus the report freeze trigger; `pnpm gate:m0` still passes |
| T4–T6 | No-external-socket test; anonymizer leak test and pattern-preservation snapshots; reproducible fixture builds |
| T8 | Robots, cap, redirect and prefix tests; lint rule negative test |
| T9–T13 | `pnpm eval:capture` (Playwright on fixture server, offline): `expected.capture.json` exact match; M1-notes cases in section 5 |
| T12 | Detection table over 13 manifest entries plus 4 pattern builders |
| T14–T20 | Unit tests per check; scoring snapshots; determinism test; no-LLM-import lint |
| T21 | **`pnpm eval:checks`**: section 5 matrix, arc-electric control rule |
| T22–T24 | Template draft snapshots and jargon lint; agent unit tests with recorded responses; **`pnpm eval:auditor`** (key, local) |
| T25 | **`pnpm eval:mapper`** business-field thresholds |
| T27–T28, T32 | Inngest dev end-to-end on fixtures: consent revocation mid-run, resume, unapproved export refused |
| T29–T31 | **`pnpm test:e2e`**: no scan without consent; edit/approve/version flow; share link shows only approved; axe on report and consent pages |
| T33 | `gate:m1` PGlite tests; then the real run is the gate |

CI runs: `typecheck`, `lint`, `test` (including `eval:checks` and the T25 thresholds), `eval:capture`, `test:e2e`. `eval:auditor` and `gate:m1` run locally (they need the API key or the DB).
