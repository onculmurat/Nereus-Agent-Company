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
3. **Implement.** Build the context pack first: `node "<scripts>/pack.js" <id> --role <role>`. It writes `team/work/packs/<id>-<role>.md` (the brief, the spec and contract sections, threat entries and decisions the brief names) and prints the path and size. Then spawn the owner role from the board entry (for example `backend-developer`) as a one-shot subagent on the entry's model. Never pass a name. The prompt holds: one line on where the task fits, the pack path ("read this first; it is your requirements"), interfaces from earlier tasks, the resolved rules block, and the report it must return. Pass the pack path, not a list of files to read. Refs the pack could not find are listed under "Not found" in it: fix the brief or answer them in the prompt.
4. **Test gate.** Run `node "<scripts>/gate.js"`. It runs the project's `testCommand` from `team/config.json` and returns `ok`, the exit code and the tail of the output. A failing gate is one round (step 6): send the output back to the implementer and never spawn a review on failing tests. If no `testCommand` is set, stop and ask the owner for it as an owner question.
5. **Review.** Only after the gate passes: `update <id> --status review`. Save the gate output to a file (`node "<scripts>/gate.js" > team/work/packs/<id>-gate.json`), build the reviewer's pack with the diff: `node "<scripts>/pack.js" <id> --role code-reviewer --base <base-sha> --gate team/work/packs/<id>-gate.json`, and spawn `code-reviewer` as a one-shot subagent with only that pack path. It must give both a spec-compliance and a quality verdict.
6. **Fix rounds.** Each failing gate, `CHANGES_REQUESTED` or failed attempt is one round: run `node "<scripts>/board.js" round <id>` and act on `next.action` (skill `escalation`). Rebuild the pack (`pack.js`, same arguments, so it holds the current diff and gate tail) and re-dispatch the implementer with the pack path and the findings or the gate output; run the gate again, then review again.
7. **Hand-off.** When the reviewer says `APPROVED`, make sure `team/work/handoffs/<id>.md` exists (a read-only role sends it to you to save).
8. **Done.** `update <id> --status done --commit <sha> --handoff team/work/handoffs/<id>.md`. Ask `doc-writer` to update the project documents when the task changed behaviour.

## Role rule

Every role that gets a pack follows this rule, which its agent file repeats: "Start from the pack. Do not explore files the pack does not name; if you need more, read only that and say what and why in your report." Reviewers (`security-reviewer`, `final-reviewer`) get the same pack form with their own `--role`.

## Never

- Never run two implementers on the same files at once.
- Never mark `done` without an approved review and a hand-off note (the `TaskCompleted` hook also checks this in team mode, when Claude Code offers native team task tools).
- Never let a role decide a product or design question; it comes to you as an owner question.
