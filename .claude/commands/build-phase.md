---
description: Build an approved milestone plan task by task with the specialist subagents
argument-hint: <milestone, e.g. M1> [task number]
---

Build from the approved plan in `docs/plans/$ARGUMENTS.md` (if a task number is given
after the milestone, do only that task).

For each task, in dependency order:
1. Delegate it to the owning subagent named in the plan (`capture-engineer`,
   `audit-engineer`, `agent-engineer`, `design-system-engineer`, `editor-engineer`,
   `exporter-engineer`). If the plan has a task folder (`docs/plans/<milestone>/<task>.md`),
   give it that file's path as its brief; otherwise give it the acceptance criteria verbatim.
2. When it finishes, run `pnpm typecheck && pnpm test`.
3. Have the **qa-reviewer** subagent review the change against the task and the PRD.
4. If the verdict is "fix first", send the blocking issues back to the owning subagent
   and repeat. Stop after two rounds and tell me what is still failing.
5. Tick the task in the plan's task table, and in its task file if there is one, and commit with a message that names the task.

Stop and ask me before: changing the site model schema beyond what the plan says, adding a
paid service or new dependency not in `CLAUDE.md`, or anything that sends data to a client.
