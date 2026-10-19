---
name: task-loop
description: Use in the build phase to take each board task from brief to done with a fresh implementer, a review and counted fix rounds.
---

# Task loop

Adapted from superpowers subagent-driven development (see NOTICE).

The board (`team/work/board.md`) is the source of truth. A task whose board status is `done` is never dispatched again, even if you do not remember finishing it.

## For each board entry that is not `done`

1. **Brief.** Make sure the task has a brief (written by the planner). It names files, interfaces, exact values, the failing tests to write first and the commit message.
2. **Start.** `node "<scripts>/board.js" update <id> --status in-progress`. Record the current commit as the task's base, read from git (`git log -1 --format=%h`), never from memory.
3. **Implement.** Build the context pack first: `node "<scripts>/pack.js" <id> --role <role>`. It writes `team/work/packs/<id>-<role>.md` (the brief, the spec and contract sections, threat entries and decisions the brief names) and prints the path and size. Then spawn the owner role from the board entry (for example `backend-developer`) as a one-shot subagent on the entry's model. Never pass a name. The prompt holds: one line on where the task fits, the pack path ("read this first; it is your requirements"), interfaces from earlier tasks, the resolved rules block, and the report it must return. Pass the pack path, not a list of files to read. Refs the pack could not find are listed under "Not found" in it: fix the brief or answer them in the prompt.
4. **Test gate.** Run `node "<scripts>/gate.js" --task <id>`. It runs the project's `testCommand` from `team/config.json` and returns `ok`, the exit code and the tail of the output. A failing gate is one round (step 6): send the output back to the implementer and never spawn a review on failing tests. A task marked `code: no` (board entry or brief; spikes, research, docs-only) has no tests: the same command then checks the report file named by the brief's `Output: <path>` line instead. It must exist, carry a verdict line (`Verdict: GO`, `Verdict: GO-WITH-CHANGES` or `Verdict: NO-GO`) and have an acceptance criteria section; `problems` lists what is missing and a failing check is a round like any failing gate. The planner sets the flag. If no `testCommand` is set, stop and ask the owner for it as an owner question. The result also has `skipped`: the count of skipped, ignored and todo tests the runner reported over the whole output. Runners hide the stdout of passing tests, so a test that prints "skip" and passes is not counted here: the review rule in `code-reviewer` and `test-engineer` catches that form.
5. **Review.** Only after the gate passes: `update <id> --status review`. Save the gate output to a file (`node "<scripts>/gate.js" > team/work/packs/<id>-gate.json`), build the reviewer's pack with the diff: `node "<scripts>/pack.js" <id> --role code-reviewer --base <base-sha> --gate team/work/packs/<id>-gate.json`, and spawn `code-reviewer` as a one-shot subagent with only that pack path. It must give both a spec-compliance and a quality verdict.
6. **Fix rounds.** At most `reviewRoundCap` rounds (2 by default) per task: `board.js round` refuses the next one (see "Review round cap" below). The lead never fixes a role's output itself: every fix goes back to the owning role. `to-lead` means you decide, re-plan or escalate (architect, owner); it never means you implement. Once the decision exists, the implementation round goes to the task's owning role with a delta pack (`--paths` set to the task's code paths), carrying the decision id and any probe findings as notes. You edit only team files (board, briefs, decisions, hand-offs) and one-line text fixes in docs, never source or test code. The `rounds` field of the board entry is the only round count; notes and packs refer to it and keep no count of their own. Each failing gate, `CHANGES_REQUESTED` or failed attempt is one round: run `node "<scripts>/board.js" round <id>` and act on `next.action` (skill `escalation`). Every fix round and every re-review uses the delta pack, never the full pack, for every role (developers and the test engineer, reviewers such as `code-reviewer`, `security-reviewer` and `final-reviewer`, and an architect folding findings into the spec): save the findings (or the gate output) to a file and run `node "<scripts>/pack.js" <id> --role <role> --round <n> --findings <file> --base <sha-of-previous-attempt>` (`--gate <file>` instead of `--findings` for a failing gate). It holds the findings, the diff since the previous attempt and the brief's acceptance criteria only; the role already has the brief and spec from its first pack. Re-dispatch the implementer with that pack path; run the gate again, then re-review with a delta pack of the same form. A criteria section the pack could not find is listed under "Not found": add it to the prompt. The diff in every pack leaves out `team/` (state, not code). Add `--paths <p1,p2>` with the task's code paths (from the brief) whenever you know them, so a base that spans `chore(team)` or docs commits still gives a code-only diff. A pack over `packMaxChars` (60000 by default) is written but `pack.js` exits 3 and warns on stderr: that is a stop, never dispatch it as is. Narrow it with `--paths` or a later `--base`, build it again, and use `--allow-large` only when the owner accepts the size.
7. **Hand-off.** When the reviewer says `APPROVED`, make sure `team/work/handoffs/<id>.md` exists (a read-only role sends it to you to save). When the gate reported `skipped` greater than 0, write the reason for each skip in that hand-off before `done`; a skip you cannot explain goes back as a fix round.
8. **Done.** `update <id> --status done --commit <sha> --handoff team/work/handoffs/<id>.md`. Read `<sha>` from git first (`git log -1 --format=%h`, or the task's range); `board.js` checks that it exists and is reachable from HEAD and refuses the update otherwise. Roles do the same before they put a commit hash in a report. Ask `doc-writer` to update the project documents when the task changed behaviour.
9. **Commit the team state.** `team/work/` is committed (only `team/work/packs/` is ignored). After each task is marked done, commit what changed there (board, briefs, hand-offs, escalations, mailbox, and `team/decisions.md` if it changed) as its own commit `chore(team): <what>` (for example `chore(team): T-004 done`). Stage explicit paths (`git add team/work/board.md team/work/handoffs/T-004.md ...`), never `git add -A` or `.`, and never mix these files into a code commit: the task's code commit is already made by the role before step 8.
   Measure the task first: `node "<scripts>/cost.js" --save --task <id>` writes `team/metrics/cost-<id>-<date>-<HHMM>.md` (that task only, lead included) and appends the rows to `team/metrics/cost.jsonl` (and one summary line to `~/.claude/nac/metrics.md`, on this machine only). Include those files in the same `chore(team)` commit. `team/metrics/` is committed, not ignored. To keep a reference for later comparison, `cost.js --baseline <name> [--session <id>] [--until <iso>]` writes `team/metrics/baseline-<name>.md`.

## Session rotation

The lead session grows with every task. Rotate it at each milestone end and after every 5 tasks marked done since the last rotation, whichever comes first. `board.js update <id> --status done` prints `rotate: true` when the fifth done is reached; a milestone end is your own call.

1. Write `team/work/handoffs/lead-<YYYY-MM-DD-HHMM>.md`: done, in progress, next task, open questions, risks. Only facts the next session needs.
2. Run `node "<scripts>/board.js" rotated` to reset the counter.
3. Commit the hand-off and the board as `chore(team): lead hand-off <YYYY-MM-DD-HHMM>`, staging explicit paths only.
4. Tell the owner: run `/clear`, then say "devam" (or "continue"). The session-start summary then shows the newest `lead-*.md` as "Lead hand-off"; read it first and carry on from the next task.

## Parallel tasks

When an implementer is already active and another task starts, the new task does not share the working tree. Run `node "<scripts>/worktree.js" add <id>`: it creates a git worktree at `<repo>-wt/<id>` on branch `task/<id>`, outside the repo. Brief, pack, hand-off and board stay in the main project; the pack path is absolute, and the role works inside the worktree path.

After the reviewer says `APPROVED` and the gate is green, integrate locally: `node "<scripts>/worktree.js" integrate <id>` cherry-picks the task's commits onto the working branch (it aborts and leaves the branch unchanged on a conflict; then the task goes back as a fix round), then `worktree.js remove <id>` deletes the worktree and the branch. The owner decided that this local integration is part of the loop, so it needs no separate approval. It is a cherry-pick onto the working branch, not a push and not a merge of a remote or release branch: push, merge into the main branch, deploy and publish still need the owner's separate approval for that one action.

Every role stages only its own paths (`git add <path>`), never `git add -A` or `git add .`: another task's unstaged work must never ride along in a commit.

## Automation first

Before you or a role hands the owner a manual step, try the automated path: scripts, CLI, launching the program, capturing output to files. Hand the owner only what truly needs a human (keystrokes in a GUI or terminal, visual judgement, credentials), each as one exact minimal action (the one command to type, the one thing to look at and what to look for). Every role has this rule in its agent file.

## Role rule

Every role gets a pack and follows this rule, which its agent file repeats: "Start from the pack. Do not explore files the pack does not name; if you need more, read only that and say what and why in your report." Reviewers (`security-reviewer`, `final-reviewer`) get the same pack form with their own `--role`. Roles that work on a phase rather than a task (architect, planner, researchers, assistant) treat their assignment file as the pack; the research roles' file lives under `team/research/` so the research guard stays as it is.

## Call budget

Every dispatch has a budget of `callBudget` tool calls (40 by default, from the resolved rules). The pack header states it; `maxTurns` is the budget plus 5 in the agent files, so a role that reaches the budget still has calls left to write its report before the hard stop. When a role reports that it hit the budget, you decide: re-dispatch with a fresh pack for the remainder (`pack.js` again, so it holds the current diff; this is the same round, not a new round) or split the task into smaller board tasks. You never raise the budget silently: a changed `callBudget` is an owner decision, like any config change.

## Review round cap

A task gets at most `reviewRoundCap` rounds (2 by default, from the resolved rules), counted from its start or from its last approach decision. When a reviewer (`code-reviewer`, `security-reviewer`) or the test gate still returns findings after that, `board.js round <id>` refuses with an error: the task gets no further fix round. Then:

1. Send the open findings and the round history to the `architect` as one approach question: options, root causes, cost of each. The architect answers read-only.
2. Bring the architect's answer to the owner as one question (Source/Status/Impact, options, one recommendation).
3. Record the owner's decision (`decisions.js`) and continue with `node "<scripts>/board.js" round <id> --approach <decision-id>`. The round count continues; the round that carries `--approach` is the first of the next window, so the cap applies again after one more round.

A changed `reviewRoundCap` is an owner decision. Findings that a reviewer marks "same class as round <n>" are the pattern this rule exists for: another way past the same check means the approach, not the text, is wrong.

## Lessons

Record a lesson at the moment it happens, with `node "<scripts>/lessons.js" add --trigger <text> --what <text> --rule <text> [--task <id>]` (one line each: what set it off, what happened, the rule that would have prevented it). It appends to `team/lessons.md` and to `~/.claude/nac/lessons.md` (this machine only, never sent anywhere). Add one when: an escalation reaches `to-lead` or `to-owner` (skill `escalation`); a role repeats the same mistake in a task; the owner corrects the lead. A lesson is a proposal: nothing becomes a NAC rule unless the owner decides so at a phase report. Commit `team/lessons.md` with the next `chore(team)` commit.

## Never

- Never run two implementers on the same files at once.
- Never mark `done` without an approved review and a hand-off note (the `TaskCompleted` hook also checks this in team mode, when Claude Code offers native team task tools).
- Never let a role decide a product or design question; it comes to you as an owner question.
