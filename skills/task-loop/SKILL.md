---
name: task-loop
description: Use in the build phase to take each board task from brief to done with a fresh implementer, a review and counted fix rounds.
---

# Task loop

Adapted from superpowers subagent-driven development (see NOTICE).

The board (`team/work/board.md`) is the source of truth. A task whose board status is `done` is never dispatched again, even if you do not remember finishing it.

## For each board entry that is not `done`

1. **Brief.** Make sure the task has a brief (written by the planner). It names files, interfaces, exact values, the failing tests to write first and the commit message.
2. **Start.** `node "<scripts>/board.js" update <id> --status in-progress`. Record the current commit as the task's base.
3. **Implement.** Spawn the owner role from the board entry (for example `backend-developer`) as a one-shot subagent on the entry's model. Never pass a name. The prompt holds: one line on where the task fits, the brief path ("read this first; it is your requirements"), interfaces from earlier tasks, the resolved rules block, and the report it must return.
4. **Review.** `update <id> --status review`. Spawn `code-reviewer` as a one-shot subagent with the brief path and the diff from the base commit. It must give both a spec-compliance and a quality verdict.
5. **Fix rounds.** Each `CHANGES_REQUESTED` or failed attempt is one round: run `node "<scripts>/board.js" round <id>` and act on `next.action` (skill `escalation`). Re-dispatch the implementer with the findings; review again.
6. **Hand-off.** When the reviewer says `APPROVED`, make sure `team/work/handoffs/<id>.md` exists (a read-only role sends it to you to save).
7. **Done.** `update <id> --status done --commit <sha> --handoff team/work/handoffs/<id>.md`. Ask `doc-writer` to update the project documents when the task changed behaviour.

## Never

- Never run two implementers on the same files at once.
- Never mark `done` without an approved review and a hand-off note (the `TaskCompleted` hook also checks this in team mode).
- Never let a role decide a product or design question; it comes to you as an owner question.
