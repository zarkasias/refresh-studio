---
description: Run an in-product agent's eval suite and compare with the last run
argument-hint: <agent: mapper | auditor | designer | design-qa | feature-planner | verifier>
---

Run `pnpm eval:$ARGUMENTS`.

Compare the score with the previous result in `evals/$ARGUMENTS/history.json`, append this
run, and report: score, change since last run, the 3 worst cases with why they failed, and
one concrete prompt or schema change to try next. Use the **agent-engineer** subagent if I
ask you to try the change.
