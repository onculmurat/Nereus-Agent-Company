# Nereus Agent Company (NAC)

[Türkçe](README.tr.md)

A Claude Code plugin that gives one person a whole software team of AI agents. You describe what you want; the team lead in your own Claude Code session splits the work, runs the roles, and asks you whenever a decision is yours.

## What NAC is and why

Building a product alone means playing every role: architect, developer, reviewer, security reviewer, writer. NAC gives each of those roles its own agent with its own instructions and model, and puts a lead between you and them. The principles behind it are in the [manifesto](MANIFESTO.md).

- You talk only to the lead (your Claude Code session). You never assign tasks.
- The team never decides for you. Product, scope and design choices, outward actions (push, deploy, publish) and deviations from an approved plan always come to you as a question.
- Everything the team knows lives in your project under `team/`, so work survives restarts.

NAC has no graphical interface. It runs inside the Claude Code terminal.

**v1.3 scope.** This release ships the core roles (team lead, researcher, finance analyst, architect, planner, backend developer, frontend developer, database engineer, test engineer, code reviewer, final reviewer, security reviewer, doc writer, assistant) and phases 0, 1, 3, 4, 5 and 6. Planned next: v2 adds product manager, UX and UI designers, DevOps engineer and phases 2 and 7; v3 adds marketing and the remaining business roles and phases 8 and 9.

## Install

Requirements: Claude Code and Node.js 20 or newer (see [docs/setup-requirements.md](docs/setup-requirements.md)).

Add the marketplace and install the plugin once:

```
claude plugin marketplace add onculmurat/Nereus-Agent-Company
claude plugin install nac@nereus-agent-company
claude plugin disable nac@nereus-agent-company --scope user
```

To install from a local copy instead (for example before the repository is published), add the folder as the marketplace and run the same install and disable commands:

```
claude plugin marketplace add "<path to the NAC folder>"
```

NAC stays off everywhere until you turn it on for a project, so it costs no context in your other projects.

## Starting a project

In the project folder, enable NAC for this project only, then start Claude Code and run setup:

```
claude plugin enable nac@nereus-agent-company --scope project
claude
```

```
/nac:setup
```

Setup first shows a dry run: every file it would create, the change to `.claude/settings.json` (agent teams on, NAC enabled), and the `.gitignore` line, and a short NAC block in the project `CLAUDE.md` (between `<!-- nac:guard:start -->` and `<!-- nac:guard:end -->`; other content is untouched). That block tells a session that lacks the marker `NAC-LEAD-ACTIVE` that NAC is not loaded, so it must not act as lead, and how to restore the plugin; for a project set up earlier, `setup.js --guard-block` writes only that block (`--guard-block --dry-run` prints it without writing). The auto-mode classifier blocks the lead from writing `CLAUDE.md`, so the session-start hint asks you to type `! node <path>/scripts/setup.js --guard-block` yourself. Nothing is written until you approve. It never overwrites an existing file or setting; a conflicting setting stops it. It then asks, as a separate question, whether to point the model section of your global `~/.claude/CLAUDE.md` at NAC's model table. Finally run `/clear` (or restart Claude Code): the session that ran setup started before NAC was set up, so only the next session loads the lead instructions. The lead then starts phase 0.

Your session is the lead, and the lead runs on your session's model. Use `/model opus` for the lead.

### What setup creates

- `team/`: `config.json`, `brief.md`, `decisions.md`, `glossary.md`, `contracts/`, `research/`, and `team/work/` (board, hand-offs, escalations, mailbox, archive; committed, except `team/work/packs/`, which is git-ignored).
- Project documents, each switchable in config: `memory.md`, `plan.md`, `article_dev.md`, `docs/setup-requirements.md`.

## Phases

| Phase | Roles | Output | Your approval |
|---|---|---|---|
| 0 Kick-off | lead | Project brief: goal, why, competitors, dream, failure criteria | yes |
| 1 Research (optional: the lead asks) | researcher, finance analyst, research reviewer | Sourced report in `team/research/`: competitors, technology, known attacks, licenses, cost estimate and free tier limits; the lead's recommendations (competitor gaps, differentiation, 2-3 product directions) for you to choose from. A script checks the sources, citations, pricing table and recommendations, then a reviewer with a fresh context checks the content, before the report | yes |
| 3 Design | architect, security reviewer | Spec, contracts, threat model | yes |
| 4 Planning | planner | Task briefs, board entries and the project's test command (written to `testCommand` in `team/config.json` once you approve it) | yes |
| 5 Build | developers, database engineer, test engineer, code reviewer, doc writer | Per task: code, tests, review, docs. After each implementation a test gate (`gate.js`) runs the test command; failing tests never go to review, they go back to the implementer as one round | only for decisions |
| 6 Final check | final reviewer, security reviewer | Findings and fixes | yes |

Each phase ends with a short phase report (done, decided, open), and the next phase starts only when you approve. Phases can loop back: a review can send work back to design.

### Efficiency helpers

The same rules apply to every role; no role is skipped and no role's model is lowered.

- **Context pack** (`pack.js`): before a dispatch the lead builds `team/work/packs/<id>-<role>.md`, the task brief plus the spec, contract, threat and decision text it names. Every role starts from it instead of exploring the repository.
- **Parallel tasks** (`worktree.js`): a second task starts in its own git worktree (`<repo>-wt/<id>`, branch `task/<id>`; `worktreeRoot` in `team/config.json` moves them to another directory, for example a drive with space). `board.js update <id> --status in-progress` is refused while another code task is in progress in the same tree (g24); record the worktree with `--worktree <path>`; `integrate` cherry-picks it onto the working branch locally. Push, merge into the main branch and deploy still need your approval.
- **Hand-off questions** (g14): `decisions.js handoff-questions` prints the queued and parked question lists from the log; hand-offs use it, so a closed question never shows as open. **Buried questions** (g13): the Stop hook also sends the lead back once when a final message mixes a status report section with a question, or names an open Q-id without its own question block. **Drift warning** (g12): a stale `gitCommitSha` record alone is one line ("sha record stale, run /plugin update"); a version or file difference between the cache and the folder is the real drift warning, with both versions.
- **Lead rotation** (`board.js`): after 5 tasks marked done (or a milestone end) the lead writes a hand-off note. With compaction configured (`autoCompactWindow`) it then just carries on and autocompact does the rest; only without compaction does it ask you to run `/clear` (the next session resumes from the hand-off).
- **Skip count** (`gate.js`): the test gate reports how many tests were skipped, ignored or todo; each skip needs a written reason in the hand-off.
- **Turn budget** (`turnBudget`, default 50 since 1.3.34; the old name `callBudget` still works): every dispatch may use 50 model turns, parallel tool calls sharing one turn (stated in the pack header; `maxTurns` in the agent files is 55, leaving 5 turns to write the report). A role that hits it does not commit (a hook refuses `git commit` at the budget, g61) and reports what is done and what is left; the lead re-dispatches the rest with a fresh pack (same round) or splits the task.
- **Review round cap** (`reviewRoundCap`, default 2): a task gets at most 2 fix rounds. `board.js round` then refuses another one; the lead sends the open findings and round history to the architect as one approach question, brings the decision to you as one question, and continues with `board.js round <id> --approach <decision-id>` (the cap applies again after that). Reviewers flag a finding that is the same class as an earlier round's.
- **Delta packs** (`pack.js --round`): a fix round or re-review gets only the findings (or gate output), the diff since the previous attempt and the brief's acceptance criteria, for every role, not the full pack again.
- **Code-only diffs and pack size guard** (`pack.js --paths`, `packMaxChars`): the diff in every pack leaves out `team/`; `--paths <p1,p2>` limits it to the task's code paths. A pack over `packMaxChars` (default 60000 characters) is still written, but `pack.js` warns on stderr and exits 3 so the lead narrows it (`--paths`, a later `--base`) before dispatching; `--allow-large` accepts it deliberately.
- **Cost report** (`cost.js [--since <iso>] [--by role|task]`): sums calls and tokens (input, cache creation, cache read, output) per role or task and model from the Claude Code transcripts of the project, with the 5 most expensive dispatches, ranked by a price-weighted figure (`weighted` = input + 1.25 x cache creation + 0.1 x cache read + 5 x output, relative to the input price; the raw totals stay beside it). The phase report includes the same table.
- **Saved cost metrics** (`cost.js --save [--task <id>]`, `--baseline <name>`, `--session <id>`, `--until <iso>`): `--save` writes `team/metrics/cost-<date>-<HHMM>.md`, appends one JSON line per role/task row (calls, tokens, weighted, dispatches, how many dispatches named a pack or hand-off, how many went over `turnBudget`) to `team/metrics/cost.jsonl`, and one summary line to `~/.claude/nac/metrics.md` (this machine only). `team/metrics/` is committed. `--task <id>` saves only that task (`cost-<id>-<date>-<HHMM>.md`, lead messages included). The lead saves it with each task's `chore(team)` commit; `--baseline` keeps a reference run, and the phase report compares per-role averages per dispatch with the latest baseline.
- **Spec fold-in cap** (`foldInRounds`, default 2; `board.js foldin`): review findings are folded into the spec in at most 2 rounds per review cycle. After that the rest goes to the architect as one batched pass and the open decisions come to you as one list.
- **Batched questions**: non-blocking or low-impact questions that are ready at the same time are asked in one `AskUserQuestion` call of up to 4, each still with source, status, impact, options and one recommendation. Blocking questions are asked at once. You still answer every question.
- **Task batching** (planner): small tasks of the same kind (same files area, same change type, each under about 1 hour) are merged into one task with one brief. The planning report shows the task count and the estimated dispatch count.
- **Tasks without code** (`code: no`; `gate.js --task <id>`): a spike, research or docs-only task has no tests to run. Its gate checks the report file the brief names (`Output: <path>`): it exists, has a verdict line (`Verdict: GO`, `GO-WITH-CHANGES` or `NO-GO`) and an acceptance criteria section. The planner sets the flag.
- **Shared role rules**: every role and the lead try the automated path first and hand you only steps that truly need a human, each as one exact minimal action; fix rounds go back to the role that owns the work (on `to-lead` the lead decides, re-plans or escalates; the fix still goes to the owning role); nobody reads outside the project root without asking you first; the board's `rounds` field is the only round count.
- **Checked commit hashes** (`board.js update --commit <sha>`): the hash must exist and be reachable from HEAD, so a hash written from memory is refused. Decision and escalation dates use your local day, not the UTC day. Every script prints its usage and exits 0 for `--help`.
- **Lessons** (`lessons.js add --trigger <text> --what <text> --rule <text> [--task <id>]`, `lessons.js show [--since <date>]`): the lead records a lesson when an escalation reaches `to-lead` or `to-owner`, when a role repeats the same mistake, or when you correct the lead, and reviews every phase for lessons. Each goes to `team/lessons.md` (this project) and to `~/.claude/nac/lessons.md` (every project on this machine; the file stays on this machine and is never sent anywhere). The phase report lists the new lessons; you decide which become NAC rules, nothing becomes a rule automatically.
- **Hardening loop** (`board.js add --module <m> --hardening yes [--decision D-xxx]`): at most one hardening task per module per phase; a second needs a recorded decision. A hardening task is reviewed on its changed lines and their direct impact sites only: a blocker is fixed in the same task, every other finding is recorded with `findings.js add --origin hardening` and waits for the phase end. The brief names the violated invariant and requires a test for every route to it.
- **Findings threshold** (`findingsBatch`): only open `hardening` and `blocker` findings count; `minor` ones, bulk imports (`findings.js add --migrated`) and findings from a hardening task's review do not. `board.js phase` still lists every deferred finding.
- **Proportional new-task proposals** (`decisions.js ask --finding-class observed|known|theoretical`): a proposal that rests on a theoretical finding only cannot recommend doing the task now.
- **Security tag from the brief**: a brief that cites threat-model IDs tags the task `security: yes` when it is added or started.
- **Pack size tolerance** (`pack.js`): a pack up to 25% over `packMaxChars` is accepted with a note; above that the diff of changed test files is left out and named (`testsLeftOut`); only a pack still over 125% stops.
- **Plain-chat questions** (`Stop` hook): a lead message that ends with a question and has no recommendation is sent back once to go through `decisions.js ask`. The hook does nothing outside the lead session and never blocks on an error.
- **Plugin source drift**: session start warns, in one line, when the plugin cache (`installed_plugins.json` commit) and the marketplace source folder are at different commits.

## Roles and models

| Role | Responsibility | Model |
|---|---|---|
| team lead (your session) | Talks to you, assigns work, keeps the board, asks you | your session model |
| researcher | Competitors, technology options, known attacks, licenses; sourced | opus |
| finance-analyst | Cost estimate, paid services, free tier limits; sourced | opus |
| research-reviewer | Fresh-context review of the phase 1 research: sources support claims, recommendations fit the brief | opus |
| architect | Spec, service split, data model, contracts | opus |
| planner | Spec to small testable tasks and briefs | sonnet |
| backend-developer | Server code and tests | sonnet |
| frontend-developer | UI code and tests | sonnet |
| database-engineer | Schema, migrations, permissions, performance | sonnet |
| test-engineer | End-to-end, integration and load tests, test vectors | sonnet |
| code-reviewer | Per-task review: spec compliance and quality | sonnet |
| final-reviewer | Whole-branch review at the end of a phase | opus |
| security-reviewer | Threat model, attack-based review | opus |
| doc-writer | Writes decisions into docs, keeps project documents | sonnet |
| assistant | Summaries, format checks, cleanup dry runs | haiku |

Reviewers and the assistant get no file-editing tools; they read, run commands and report. At most 5 roles are active at once (configurable).

## Questions and decisions

Every question to you has the same shape: **Source** (where it came from, who found it), **Status** (is code written, does the answer change existing work), **Impact**, the options, and one recommendation. One question at a time. `decisions.js ask` refuses a question with fewer than 2 options or no recommended option.

- A blocking question is asked immediately.
- A non-blocking question is queued in `team/decisions.md` and the team keeps working. Ask for queued questions any time:

```
/nac:questions
```

Every answer is recorded in `team/decisions.md` with its date. To see where the project stands:

```
/nac:status
```

## Escalation

One round is one attempt plus its review. The lead counts rounds on the board entry:

1. After 2 unresolved rounds, the role retries one model tier up (haiku, sonnet, opus).
2. After 2 more, the issue goes to the lead, who gets 1 round.
3. Then it comes to you as a question.

Every escalation is recorded in `team/work/escalations/`. Thresholds are configurable.

## Shared memory and mailbox

- `team/work/board.md` is the task board: owner role, status, rounds, model, commits, hand-off. Only the lead writes it.

`gateCommands` (g18) is an ordered list of `{ "name", "command" }` checks, for example test, `cargo clippy -- -D warnings` and `cargo fmt --check`. The gate runs all of them, reports each and fails when any is red; `testCommand` stays as the alias for a single check. A `pack-guard` hook (g22) refuses a developer, database-engineer, reviewer, security, test-engineer or final-reviewer dispatch that names no context pack; `--no-pack <reason>` in the prompt is the recorded escape hatch. `/nac:setup` fills a default list for a detected Rust or Node project when the config has neither key.

Efficiency checks, part F (g19 hard): `board.js update --status done` is refused on an M or L task — and on a task with no size, which counts as M — that has at most one code commit, unless `--single-commit <reason>` is given (the reason goes to `team/decisions.md`). S tasks and `--code no` tasks are not checked. (g26) The Stop hook sends the lead back once when its message names a Q-id or D-id that `team/decisions.md` does not hold; owner and proxy questions are registered with `decisions.js ask` first and D-ids are quoted from `decide` output. (D-227) Team-state commits use a `team/`-only pathspec: `node scripts/team-commit.js --message <text>` runs `git commit -- team/`, so a developer's staged code in the shared index is never swept into a `chore(team)` commit. (g11) `setup --apply` commits exactly the files it created or changed as one `chore(nac)` commit (a pathspec of those files only); outside git, or for a file that already had uncommitted edits, it writes the file and prints a warning. (g23) The brief line is `Go-path test: <command>`: `decisions.js ask --irreversible` runs that command in the project (10-minute timeout) and refuses unless it exits 0 and the gate is green; a bare file name is refused.
- `team/decisions.md` holds open questions and decisions. Only the lead writes it.
- `team/contracts/` holds interface contracts written by their owning role.
- Every message between roles is a file in `team/work/mailbox/<thread>/`. A hook copies each live message there automatically, so nothing depends on an agent remembering. Roles check their inbox at start, after each step and before finishing.
- After a restart, the lead rebuilds from the board, the mailbox and the hand-off notes.

## Cleanup

Closed threads whose outcome is in `team/decisions.md` and that are older than 30 days can be archived (default) or deleted. Nothing is removed without a recorded outcome. Cleanup shows a dry run and asks before applying:

```
/nac:cleanup
```

## Configuration

Settings resolve in three layers, later wins: plugin defaults (`defaults/config.json`), your user config (`~/.claude/nac/config.json`), the project's `team/config.json`. Example project override:

```json
{
  "models": { "backend-developer": "opus" },
  "escalation": { "modelRounds": 3 },
  "maxActiveRoles": 3,
  "documents": { "articleDev": false },
  "cleanup": { "closedThreadMaxAgeDays": 14, "mode": "delete" }
}
```

`testCommand` (for example `"cargo test"`) is the one command that runs the project's whole suite from the project root. The test gate runs it as a shell command on every task. The planner proposes it, you approve it in the phase 4 report, and the lead writes it.

## Conditional compaction

Claude Code compacts the lead's context by itself, which can happen in the middle of a task. NAC lets an automatic compaction run only at a clean point, through a `PreCompact` hook that acts in the lead session only:

- Allowed when the lead's own state is safe (g25): `team/` is committed (only paths under `team/` count; developer files elsewhere in a shared tree do not), the last `done` task has its commit on HEAD, no owner question is waiting for an answer in this turn (parked, deferred and queued ones do not block), and every `in-progress` task has a hand-off file. Tasks in flight no longer block by themselves; the hand-off lists each one with its owner role, agent (`board.js update --agent`), worktree and hand-off file. NAC then writes a short `team/work/handoffs/compact-<stamp>.md` (board state, next task, pointer to `team/decisions.md`), and the next session start (source `compact`) points the lead to it.
- Otherwise the compaction is deferred with a one-line reason. Above the ceiling (`compaction.ceiling`, default 220000 tokens in context) it runs anyway, so a deferral can never overflow the context.
- Manual `/compact` is never blocked. Any error in the hook allows the compaction. The compact hand-off states the real trigger (safe point, ceiling or manual) and lists every condition that was not met; its next task is the one in progress first, then a todo whose brief exists, then any todo.

Defaults, in `defaults/config.json` (override in `team/config.json`):

```json
{ "compaction": { "autoCompactWindow": 200000, "ceiling": 220000 } }
```

`/nac:setup` writes `autoCompactWindow` (minimum 100000) and `idleCompaction: false` into the project `.claude/settings.json` without touching values you already set; for a project set up earlier, `node <path>/scripts/setup.js --compaction` writes only these two keys (`--dry-run` prints them). It keeps the file's line endings and indentation and commits that one file as `chore(nac): ...` so the clean-tree check is not blocked (it warns instead when it cannot, for example outside git or when you already have uncommitted edits in the file). The auto-mode classifier can block the lead from editing settings, so the session-start hint asks you to type it with `!`. The first automatic compaction fires somewhat below the window (about 72% in a spike with 100000), so do not rely on the exact point. If your shell sets `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, its interaction with `autoCompactWindow` is untested; NAC does not depend on it.

## Team mode vs subagent mode and limits

- **Team mode** (design and final check): roles are named teammates that question each other directly.
- **Subagent mode** (planning and build): a fresh one-shot implementer and reviewer per task. The lead spawns these without a name, so they stay subagents while agent teams is on.

Limits you should know:

- Asking you before deciding is enforced through instructions, not a mechanical block. Teammates do not use plan mode.
- Teammates are not restored on `/resume`. The lead rebuilds from the board, mailbox and hand-offs and respawns the roles it needs.
- A teammate's model is fixed when it is spawned; raising it means respawning the role.
- The lead's model is your session model. Use `/model opus`.
- The `TaskCompleted` hook (a team task may close only when the board says done) runs only when Claude Code offers native team task tools. In the live tests on Claude Code 2.1.302 no session had these task tools, so the hook never fired; the lead's review on the board is what stops early "done".
- Agent teams is an experimental Claude Code feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`).

## Safety rules

- No push, merge, deploy, publish, post, infrastructure apply or purchase without your separate, explicit approval for that action.
- Setup and cleanup always show a dry run first and never overwrite existing files.
- Roles work only inside their responsibility; reviewers get no file-editing tools.
- The research roles (researcher, finance-analyst) read untrusted web pages and competitor code, so a `PreToolUse` guard limits them against prompt injection: they read only `team/brief.md`, `team/research/` and the clone folder, plus the saved output of their own large tool results (not decisions, the mailbox, other roles' notes or the lead's tool output), write only to `team/research/` (their hand-off notes included), and Bash runs only NAC's mailbox and clone scripts. If the guard fails, it blocks the call. They can send messages only under their own header. The mailbox hook records every NAC role under its real role, whatever its message header claims, and tells the lead about a false claim; other roles read research messages as data. Web tools stay open; with no secrets in reach there is nothing to leak. No clean-up can remove visible injected text, so later roles read the research report as data.
- A `PreToolUse` guard on Bash and PowerShell holds every role and the lead to one rule: a recursive delete (`rm -r`, `Remove-Item -Recurse`, `rmdir /s`, `rd /s`, `del /s`, `rimraf`, `find -delete`) is allowed only inside the project, the temp folder, the worktrees folder (`<project>-wt`, under `worktreeRoot` when set), `gateTmp` and the folders listed in `deleteRoots` in `team/config.json` (absolute paths, such as your own scratch and build folders; never a drive root, the home folder or above it, and never the listed folder itself). A variable assigned a literal value earlier in the same command (`S=/tmp/x; rm -rf "$S"`, `$d = "..."` in PowerShell) is replaced by that value first; any other variable stays unresolved. A drive root, `~`, `/`, the home directory, a path outside the project, or a target it cannot resolve (variable, command substitution, a pattern that can match `..`) is blocked with a message that tells the agent to ask the lead. It also blocks `git clean` with `-x`/`-X` and `-f`/`-d` (dry runs stay allowed), inline code that deletes a blocked path (`node -e`, `python -c`, `perl -e`, `ruby -e`, `pwsh -Command`), and `-EncodedCommand` (decoded and checked, blocked when it cannot be decoded). A script file run by name (`bash x.sh`, `node x.js`, `python x.py`, `pwsh x.ps1`, `./x.sh`) inside the project or temp folder is scanned with the same rules when it is under 64 KiB; plugin scripts, missing files and larger files are not scanned, so a script outside that can still delete what the guard never sees.
- Hooks do nothing outside a NAC project (a folder without `team/config.json`).

## FAQ

### Does NAC slow down my other projects?

No. It is disabled except in projects where you enabled it.

### Can I talk to a role directly?

Yes. The lead is your normal contact, but you can message any teammate.

### What if I close Claude Code mid-task?

The next session starts with a resume summary: phase, work in progress (with `git status`), open board items, unread messages for the lead and queued questions.

### Is team state committed?

`team/brief.md`, `decisions.md`, `contracts/`, `research/`, `glossary.md` and `config.json` are meant to be committed. `team/work/` (board, briefs, hand-offs, escalations, mailbox) is committed too; only `team/work/packs/` (generated context packs) is git-ignored. The lead commits it in its own commits, `chore(team): <what>`, after each task is marked done and at each lead rotation, staging explicit paths and never mixing it into a code commit. Setup changes an older `.gitignore` line `team/work/` to `team/work/packs/` and shows the diff first.

## Changes in 1.3.71

- `gate.js` writes the result of every run that ran checks to `resultFile` (`team/work/packs/gate-result-<id|project>[-<check>].json`, with `at`). A single check longer than the 600 s tool timeout has to run as a background shell; in Memory Agent its captured output came back cut off and the lead wrote the gate record by hand. The lead now reads the file and never writes a gate record by hand (g114).

## Changes in 1.3.70

- The owner-proxy guard also no longer reads a release that a change would delay, hold up, postpone, put at risk or affect ("would delay the free release") as the owner's release step. One hour after 1.3.69 it still refused the proxy answer to Q-245 (g113).

## Changes in 1.3.69

- The owner-proxy guard no longer takes a release named as a smoke check, an assertion or a check ("release smoke"), a release a test would fail or break ("would fail the free release"), "before a paid release" or "the release ships" for the owner's release step. In Memory Agent the guard refused the proxy answer to Q-243 (where a key-list assertion lives) and part of a task waited for the owner (g112).

## Changes in 1.3.68

- `setup.js --proxy <session> --until <date> --full` sets a full owner proxy (`ownerProxy.full`, always time-bound). It also decides merge into the main branch, spending and irreversible go-steps and deleting data, and the lead opens no owner box for them. Push, deploy and publish stay with the owner. In Memory Agent the owner gave the night answers to the proxy and went to sleep; the lead still opened boxes for merge and the live bench (g110).

## Changes in 1.3.67

- Every compact hand-off is also written to `team/work/handoffs/compact.md`, and SessionStart after a compaction points the lead there. The lead reads one fixed path, so a compaction re-attaches one hand-off instead of each timestamped one read before. The timestamped copies stay as history. In Memory Agent the first call after a compaction carried three earlier hand-offs (g109).

## Changes in 1.3.66

- A non-blocking open question no longer holds the lead's auto compaction back up to the ceiling; it defers it by softMargin like the other soft conditions. Only a blocking question is hard. While NAC holds an auto compaction back, `task.js start` refuses new work until a compaction has run. Memory Agent's lead went from 100k to 161k tokens with proxy questions open and kept starting tasks (g108).

## Changes in 1.3.65

- The proxy may decide a question that names release as a module: its hardening task, secret scan, gate or workflow, or something "in the release". Q-234 ("Second release hardening task") was refused as a release, and the lead had to open a box for the owner (g107).

## Changes in 1.3.64

- The gate split (1.3.62) also covers a task gate scoped to the changed packages. A scoped cargo command had no recorded time, so the first scoped gate of a task ran whole and passed the 600 s tool timeout. `gate-times.json` now also keeps each check's last time under `@<name>`, and a command never measured takes that time (g106).

## Changes in 1.3.63

- The owner proxy can decide a question that names a merge only as needing a separate owner OK ("merge to main needs a separate owner OK", "main'e merge ayrı owner onayı") or as staying with the owner. The phase 6 plan question listed the merge to main as an item left with the owner, its proxy decide was refused as a merge, and the lead waited in a box for the owner. A question that asks for the merge itself still goes to the owner (g105).

## Changes in 1.3.62

- A gate whose checks took longer than `gateSplitSeconds` (`team/config.json`, 500 by default, 0 = never) is split: each run records how long each check command took (`team/work/packs/gate-times.json`), and the next `gate.js` without `--check` runs nothing and returns `splitRequired` with one `gate.js --check <name>` command per check; `--no-split` runs them all anyway. The whole gate had passed the 600 s tool timeout and moved to the background (Memory Agent T-117, T-092), where its result can be lost (g104).

## Changes in 1.3.61

- `task.js close` records a main-tree task's code commits since its `chore(team): <id> start` commit by itself (`stepCommits` in the result); `--commit` is optional and adds a commit from before the start. Commits of team bookkeeping, merges and other tasks are left out, and a code task with no commit is still refused. The lead had recorded T-117's three commits one by one (g103).

## Changes in 1.3.60

- The gate result names the skipped tests in `skippedTests` (cargo `... ignored`, node `# SKIP`/`# TODO`, pytest `SKIPPED`), not only their count. The hand-off needs a reason for each skip, and the saved tail named no test, so the lead had to ask a developer to find it (g102).

## Changes in 1.3.59

- The destructive-command guard counts Claude Code's own temp folder (`CLAUDE_CODE_TMPDIR`, where the scratchpad lives) like the temp folder: a recursive delete inside it passes, the folder itself stays protected. A developer's `rm -rf` of a demo folder there was blocked (g101).

## Changes in 1.3.58

- Every role's working rules say: stop only a process you started, by its PID; never stop processes by name (`taskkill /IM`, `pkill`, `Stop-Process -Name`) and never run load generators. Two roles tried it in one night (a CPU burner, `taskkill /F /IM python.exe`); only the auto-mode classifier stopped them (g100).

## Changes in 1.3.57

- A team-state commit (`task.js close`, `team-commit.js` and the other `chore(team)` commits) retries a failed git call three times, waiting a little longer each time, so a developer's commit holding `index.lock` no longer leaves the close uncommitted. When it still fails, the warning names the git error, not the LF/CRLF warning git prints first (g99).

## Changes in 1.3.56

- `task.js close --commit` takes a comma-separated list (`--commit e9ee0ac,fd106d0`). A task that ran in the main tree with step commits records all of them, so its close no longer needs `--single-commit` (g98).

## Changes in 1.3.55

- **Integrate records the task's commits on the board** (g97): `task.js close` takes one `--commit`, so a worktree task with step commits had only its last commit on the board. Each close then needed `--single-commit` with a reason. In Memory Agent this happened for T-108b, T-109b, T-109c, T-110c and T-114, and decisions.md holds 26 such entries. `worktree.js integrate` now adds every cherry-picked commit to the board entry.

## Changes in 1.3.54

- **A task note commits only its own hand-off** (g96): `task.js note --chore` committed all of `team/`. In Memory Agent, T-111's doc writer was editing `team/spec.md` and `team/threat-model.md` in the main tree, and the lead's "T-109c note: Gate skips" commit took both files. T-111 was then closed with that commit as its own. The note commit now holds only the task's hand-off file.

## Changes in 1.3.53

- **An answered question no longer blocks compaction** (g95): in Memory Agent, Q-207 was answered at 20:40 but never recorded, and it stayed open after its task T-110a was done. An open owner question is a hard condition, so it blocked every auto compaction up to the 220K ceiling. With a 100K window, auto compaction never ran. An open question whose `task` is done on the board is now a soft condition: the compaction hand-off lists it, and the deferral limit (`softMargin`) lets compaction run.

## Changes in 1.3.52

- **Test temp leftovers are removed** (g94): every test run leaves its own temp folder, and nothing removed them. In two days Memory Agent had about 14,000 `fakeclaude-*` folders (8 GB) and 48,000 `nim-*` folders (17 GB). Name them in `testTempDirs` (team/config.json) as `"<absolute folder>/<prefix>*"`. The prefix must be 3 or more characters, and the folder must not be a drive root, the home folder or above it. `task.js close` removes the ones older than 6 hours, so a parallel task's fresh run keeps its own, and reports `testTempRemoved`. `worktree.js prune --shared` removes them all when no build runs.

## Changes in 1.3.51

- **A close names the task's open agents** (g93): in Memory Agent, T-108a's round 1 developer stayed open for two hours after the task closed. NAC does not see the lead's agents, so `task.js close` now returns `agentsNote`. It tells the lead to stop every agent of the task still open, using TaskStop with the agent id and never the process name. The task-loop reference states the same.

## Changes in 1.3.50

- **Maintenance routine for the shared build dirs** (g91): the done-task prune (g90) never touches the shared target dirs every gate builds into (Memory Agent: `build/debug` ~90 GB and the main tree's `target` ~53 GB), and they filled D: again. List them in `sharedBuildDirs` (team/config.json; each must lie inside the project or a `deleteRoots` folder). When the drive has less than `maintenanceFreeGB` free (default 20, 0 = off), `task.js start` refuses, and `task.js close` and the gate report `maintenance`. The lead starts nothing new and lets the running work finish. Then `worktree.js prune --shared` removes those dirs and the done tasks' build output; while cargo or rustc runs it reports `busy` and removes nothing. The gate's own floor `gateMinFreeGB` drops to 10 by default, so the running tasks' gates still run while the queue drains.

## Changes in 1.3.49

- **Task id match in build folder names is strict** (g90): the first `worktree.js prune` in Memory Agent read a uuid part such as `d018-` as T-018. It removed only temp folders, but a build folder could be hit the same way. The id now matches only bare or with a `t`/`t-` prefix (`review-t047`, `047`, `t-047`).

## Changes in 1.3.48

- **Done tasks' build output goes on its own; a full drive is not a round** (g90): in Memory Agent, reviews and base checks built into the project's build folder under names that only carried the task id (`review-t047`, `review-t047-base`, `t105a`, `review-061b`, about 33 GB). Nothing removed them, and with five tasks building at once D: filled up; the gate reported the "no space left" errors as 9 failing tests. Now `task.js close` removes the closed task's build dirs: `target-<id>`/`tmp-<id>` beside the worktree, and the folders in `deleteRoots` whose name holds the task id as its own part. Folders that also name an open task, and shared ones such as `debug`, stay. `worktree.js prune [<id>]` does the same for every done task. Before its checks the gate measures the free space on the task's drive: below `gateMinFreeGB` (default 20, 0 = no check) it first prunes. If the space is still below the limit, it does not run and returns `disk` + `diskNote` (not a round). A red whose output says the drive is full carries `diskFull`.

## Changes in 1.3.47

- **No kill by process name** (g88): a developer in Memory Agent ran `pkill -f cargo` while four more tasks built and gated in their own worktrees; only Claude Code's auto mode classifier stopped it. The destructive-command guard now blocks `pkill`, `killall`, `taskkill /IM` or `/FI`, `Stop-Process -Name` and `Get-Process x | Stop-Process`. A kill by PID (`kill <pid>`, `Stop-Process -Id`, `taskkill /PID`) stays allowed.
- **A task's worktree is not outside the project** (g89): the same developer's `rm -rf target` in its own worktree (under `worktreeRoot`) was blocked as outside the project. The worktrees folder (`<project>-wt`, under `worktreeRoot` when set) now counts like `deleteRoots`; the folder itself and anything beside it are still blocked.

## Changes in 1.3.46

- **Due hardening is named after every close** (g87): `hardeningDue` showed once, on the finding that crossed `findingsBatch`, and was easy to lose. Memory Agent's lead told the owner every development task was done while memory had 14 counted hardening findings and no hardening task in the phase (core 24, mcp 19 and cli 10 were also over the batch). `task.js close` now warns with every module whose counted findings reach the batch and that has no open hardening task, and the compact hand-off's next-task line puts them before the rest of the board.

## Changes in 1.3.45

- **The context pack brings the task's own decisions** (g86): the pack held only the decisions the brief cited. The owner had decided T-087c S6 days earlier (D-263, with "(T-087c S6)" in its heading), the brief did not cite it, the developer built the other option and the task went to a fix round. A decision whose heading names the task id as a whole word now comes with the pack, once, even when the brief does not cite it; a parent id (T-087) does not take a child's (T-087c) decisions.

## Changes in 1.3.44

- **A PowerShell here-string no longer blocks a delete as an unbalanced quote** (g85): the destructive guard left the opening `@'` of a here-string on its line as a lone quote, so any PowerShell command with a here-string and a delete verb was blocked (Memory Agent T-078 close: findings JSON in `$j = @'...'@`, then `Remove-Item` of the temp file). The opener now counts as an empty string, and a command after the closing `'@` on the same line is still checked.

## Changes in 1.3.43

- **The destructive guard allows deletes inside gateTmp** (g84): a role removing the tests' leftovers in the gate's temp folder (Memory Agent T-106: `rm -rf D:/nac-tmp/t032b-fi-docs-*`) was blocked as outside the project and the temp folder. `gateTmp` from `team/config.json` now counts like a `deleteRoots` folder: deletes inside it are allowed, the folder itself and anything beside it are not. A `gateTmp` that is a drive root or the home folder adds nothing.

## Changes in 1.3.42

- **Releasing a handle is not a release** (g83): a question about freeing index.db and its lock ("the production path runs the same release code the tests prove") was refused as the owner's release, so the lead opened a box for the owner. Releasing handles, locks, files, memory or connections, and "release code/path/logic", no longer count as the owner-only release; "release v1.0" and "release the code to users" still do.

## Changes in 1.3.41

- **NAC's own tests clean up their temporary folders** (g82): the suite made a temp folder per test and never removed it (~34,000 folders, 26 GB under the session temp folder). `npm test` now preloads `tests/tmp-root.cjs`: every folder a test process makes with `mkdtemp` is recorded, and when the whole run ends the test runner removes them, with the `<folder>-wt*` worktrees beside them. `TMP` stays where it was: moving it to a subfolder, or removing folders while other test files still ran, made git fail more often with "Permission denied". Run the suite with `npm test`; a bare `node --test` skips the preload.

## Changes in 1.3.40

- **The gate cleans up the tests' temporary folders** (g81): the project's tests left their `nim-*` folders behind on every run (Memory Agent: ~10 GB in gateTmp, 38k folders on C:). With `gateTmp` set, each gate run gets its own `gate-<pid>-<time>` folder in it and removes it when the run ends, green or red; parallel runs never delete each other's files. Removing a worktree also removes the task's `tmp-<id>` folders beside it.

## Changes in 1.3.39

- **The pack names what the project's rules refuse** (g79): Memory Agent T-101 and T-102 briefs told the role to pull a module in with `#[path]`, which the project's unsafe_policy R1 refuses; T-101 lost round 1 to it. `briefForbid` in `team/config.json` (a list of `{ text, rule }`) is checked against the brief when the first pack is built; a match comes back as `briefForbidden` with a note to fix the brief before the dispatch.
- **A `/clear` rotation is no longer left to memory** (g80): with `rotateBy: "clear"` the lead went on to the next task twice without asking the owner for `/clear`. The close now leaves a marker in `.git`; the next `task.js start` refuses once with the line to send the owner. A `/clear` or a new session removes it; `--same-session` goes on when "devam" came without `/clear`.

## Changes in 1.3.38

- **The Cargo flag `publish = false` is not a publish** (g78): Memory Agent Q-194 proposed "a publish=false path crate"; the owner-only check matched "publish" and refused the proxy answer, so T-102 waited for the owner. `publish = false` (and `publish = []`) keeps a crate from ever being published and no longer counts as the owner's action.

## Changes in 1.3.37

- **`gateTmp` keeps the gate's temporary files off the system drive** (g77): in Memory Agent T-101 the lead ran the gate from the PowerShell tool, whose TMP is the Windows user value (C:Users...Temp), and the tests wrote their temporary files to a full C: drive. `gateTmp` in `team/config.json` (a folder, created when missing) sets TMP, TEMP and TMPDIR for every gate check.

## Changes in 1.3.36

- **`rotateBy` picks the lead rotation way** (g76): in Memory Agent the lead went on at ~62k per call after each compaction (the summary and the reloaded files, against ~37k for a fresh session) and compacted 8 times in a day, some 3-4 minutes apart. `rotateBy` in `team/config.json` (`clear` or `compaction`) now wins over the way read from `.claude/settings.json` and makes the rotation come after every task (`rotateEvery` still overrides). With `clear` the lead asks the owner (and the owner proxy) for `/clear` and "devam"; if "devam" comes without `/clear`, it carries on in the same session.

## Changes in 1.3.35

- **An L task goes out one step per dispatch** (g75): in Memory Agent T-099, T-100 and T-074 the whole task went out in one dispatch; the developer reached the turn budget in the middle of a step, the half-done work stayed uncommitted and the next dispatch spent turns finding where it stood. The task-loop skill now says to plan one step (one commit) per dispatch for an L task from the start, each ending on a green commit, the next pack carrying its diff. An M task stays one dispatch unless its brief has more than 3 steps.

## Changes in 1.3.34

- **Turn budget 50** (g74): in three medium tasks in a row (Memory Agent T-099, T-100, T-074) the developer used all 40 turns and stopped with one of three commits done; each re-dispatch built a fresh pack and the context again. The owner raised `turnBudget` to 50 as a first step; `maxTurns` in the agent files is now 55, so the 5 turns for the report stay. A project can still set its own `turnBudget` in `team/config.json`.

## Changes in 1.3.33

- **The destructive-command guard reads `node -e '...'` edits correctly** (g72): a developer edited a Rust test with `node -e '...'`; the guard read the JS template literals inside the single quotes as `` `...` `` substitutions and `rest.find(` as the `find` command, and blocked the edit as an unbalanced quote. The developer retried it once unchanged and then redid it with four Edit calls. In Bash, single-quoted text now has no substitutions, and a method call (`.find(`, `.remove`) is not a delete command. Real deletes in `` `...` ``, `$( )` and after a quoted word are still checked.

## Changes in 1.3.32

- **The lead runs the gate in the foreground** (g71): the lead ran `gate.js` as a background shell; Claude Code stopped it under memory pressure while the session waited, the gate result was lost and the lead had to ask before it ran it again. The task-loop skill now says to run the gate in the foreground with the tool timeout at its maximum (600000 ms); the roles already had this rule (g31).

## Changes in 1.3.31

- **The task-loop skill fits the reload after a compaction** (g67): after each compaction Claude Code puts the skill back cut at 20000 characters; the skill had 27085, so Automation first, Role rule, Turn budget, Review round cap, Lessons and Never were gone for the rest of the session. `SKILL.md` now holds every rule in short (about 13700 characters, with Never, the round cap and the turn budget first), and `skills/task-loop/reference.md` keeps the full text, the reasons and the rare paths. No rule was dropped.
- **`task.js note` and `decisions.js decide` take `--chore`** (g67): most of them were followed by a separate git commit, one more lead turn that re-reads the whole context each time. With `--chore` the same call commits `team/` as `chore(team)`.
- **A push named as a condition no longer sends a question to the owner** (g70): the proxy check refused an answer on "(CI runs only after an owner push)" and on "drop the 3 file-symlink tests". A push after a preposition ("after an owner push", "before any v* tag push") or as a CI trigger ("push guard", "on push events"), and `file-` that describes the next noun, are no longer the owner's action; "push the branch", "merge after the owner push" and "drop the 3 files" still are.

## Changes in 1.3.30

- **The rerun of a red test check runs only the failed tests, one at a time** (g69): a red check ran again in full under the same parallel load (g64), so a timing test went red twice: a budget test failed in the first run, another one in the rerun, and the task spent a developer dispatch on a red that passed alone. A red `cargo test` check that names its failed tests now reruns only them with `--exact --test-threads=1`; green is `flaky` (the entry says which tests ran alone) and not a round. The rerun counts as green only when every one of those tests ran and passed (`notRun` names a test the filter missed). Other commands, a build error or a hang rerun as before.

## Changes in 1.3.29

- **An owner-only word used as a noun no longer sends a question to the owner** (g68): the proxy check matched "release" in "release work goes on" in a question about adding a hardening task, refused the proxy answer, and the owner had to answer a planning question while the lead waited. Release, publish and deploy that name work, a phase or a time ("release tasks", "a release blocker", "before release", "the pre-release checklist", "yayın görevleri", "yayından önce") are no longer the owner's action; "merge PR #12 into main", "publish v1.0", "push the branch" and deleting the owner's data still are.

## Changes in 1.3.28

- **A scoped gate also runs the checks that read every package, and a red from before the task is not a round** (g66): a task added a Windows-only call to a cli test without `cfg(windows)`. Its gate was scoped to cli and the packages that depend on it (g55), so the test that builds every package for Linux (in core, which does not depend on cli) never ran, and the red reached the base. The next task's gate found it, counted a round, and that round raised the developer to Opus for a one-line fix. `gateAlwaysRun` in `team/config.json` (`{ name, command }` list) holds checks a scoped gate runs beside its own; `scope.alwaysRun` names them, and a full gate leaves them out because it already covers them. `board.js round <id> --reason base --finding <F-id>` records a red that is red on the task's base too: the task fixes it in its own commit on the same model, the round count and the model stay as they are, and the entry lists it under `basefixes`.

## Changes in 1.3.27

- **A red gate names its failed tests** (g65): with `--no-fail-fast` (1.3.26) the test output is long and its tail named only the red test binaries ("2 targets failed: hygiene, unsafe_policy"), so the lead could not see which tests failed and the round's developer first had to find them. A red test check now lists its failed tests in `checks[].failed` with the first lines of each one's panic in `checks[].failures`, and the result has `failed` as `check: test` for every red check.

## Changes in 1.3.26

- **Known environmental reds and a red from load no longer cost a round** (g64): `cargo test` stopped at the first failing test binary, and one project had a test red on that machine for an environmental reason (a broad ACL on the temp folder, a recorded finding), so the tests after it never ran in the gate and the lead passed the red by hand every time. Another task lost a round to a red that came from a parallel build holding cargo's package lock; the developer found nothing to fix and the gate run alone was green. The gate now runs `cargo test` with `--no-fail-fast`. `gateKnownRed` in `team/config.json` lists tests known to fail on this machine, each with `test`, `finding` and `reason`; a test check whose only failures are on the list counts as green and names them in `knownRed`, a build error is never a known red, and a listed test that passes is named in `knownRedPassed` so its entry and finding can go. A red check runs again (`gateRetry`, default 1, 0 to 3); red then green is reported in `flaky` and is not a round.

## Changes in 1.3.25

- **A role the usage limit cut off is continued, not started again** (g63): when the usage limit stopped a role mid-run, the lead re-dispatched it with a fresh pack, so a role that had done real work read everything again and redid it. Claude Code keeps a stopped subagent's transcript, and SendMessage to its agent id continues it with its context. The new `agent-state.js <agentId>` reads the role's transcript and says how many turns it used, whether the limit stopped it, and what to do: `resume` (SendMessage after the reset) when it had at least 10 turns of work and is not near its turn budget, `fresh` (a new pack) otherwise. The task loop says to run it before re-dispatching, and that a limit stop is never a round.

## Changes in 1.3.24

- **No commit at the turn budget** (g61): at its second budget stop a developer committed work with 7 of 12 existing tests red, without noticing, and the next dispatch first had to find out whether the red was its own. A role at the budget has no turns left to run the full tests, so a new `PreToolUse` hook (`budget-commit-guard.js`) refuses `git commit` from a NAC role once it has used `turnBudget` turns; the lead and non-NAC agents are not checked. The budget notice now says to leave the changes uncommitted, and every pack lists the uncommitted changed and new files of the task tree under "Uncommitted work in the tree", so the next dispatch starts from them with or without `--base`.
- **Your own scratch and build folders for recursive deletes** (g62): the destructive guard allowed recursive deletes only in the project and the OS temp folder, so a role that kept its scratch files where the owner wants them (`D:/Claude Sessions/<project>/tmp`) was blocked and had to ask. `deleteRoots` in `team/config.json` lists more folders (absolute paths) that count like the temp folder: deletes inside them are allowed, the folder itself is not. A drive root, the home folder or a folder above it is refused by the config check, and the guard ignores a list that holds one.

## Changes in 1.3.23

- **A turn-budget stop cannot be counted as a stuck round** (g60): `board.js round --reason budget` was refused (g46), so the lead wrote `--reason stuck` instead; in one project three budget stops (a developer at 40 turns, code not yet building) were counted as rounds, which spends the round cap and can escalate a task early. The `turn-budget` hook now records the stop per role (`team/work/budget-stops.json`, in the main tree when the role works in a worktree). While it stands, `board.js round <id> --reason stuck` for a task owned by that role is refused and names the fresh-pack re-dispatch; `pack.js` for that role clears it. `--reason gate` and `--reason review` are unchanged.

## Changes in 1.3.22

- **A code task closes only with its code review recorded** (g59): `task.js close` checked the security-reviewer pass of a `security: contract` task and nothing else, and the task loop never said to record the code-reviewer verdict. In one project 71 of 84 code tasks closed with no code-reviewer verdict on the board, so a review that asked for changes could have closed in silence. A task owned by a code role (backend-developer, frontend-developer, database-engineer, test-engineer) now closes only after `board.js review <id> --role code-reviewer --verdict pass`; the refusal names that command and the latest verdict. `code: no` tasks and tasks of other roles are unchanged, and so is `board.js update --status done`.

## Changes in 1.3.21

- **The pack reads the spec references briefs actually write** (g57): `pack.js` took a spec section only in bold (`**6.1**`) and a contract only as `name 4`. Briefs that wrote `Spec: 6.1, 6.6; storage-schema.md 4` (68 of 73 in one project) went out without their spec sections and without a word in "Not found", so the role looked the spec up itself. Plain numbers after `Spec:` and contracts named as files (`storage-schema.md 4`, `contracts/mcp-tools.md 3.5`) now count, and a Spec line that yields no reference is listed under "Not found".
- **A product question about deleting is no longer owner-only** (g58): the owner-only check matched any word starting with "sil" or the bare word "delete". A question on whether deleted notes count toward a limit was refused as "deleting the owner's data", and the lead waited in a box for the owner at night. Deleting is owner-only now when it names what is deleted (data, files, a branch, a repo, a database, backups, history; in Turkish the noun before "sil"), and the refusal says which words matched.

## Changes in 1.3.20

- **A refused task id cannot start the wrong task** (g56): the lead gave a new hardening task an id that was already taken; `board.js add` refused it with only "already exists", and the next `task.js start` started the old task with that id and committed its start. The refusal now names the task that holds the id, its title and status, says not to start that id for the new task, and gives the next free id (`--id` can be left out). `task.js start` returns the task's `title`, so a mismatch shows at once.

## Changes in 1.3.19

- **The task gate tests what the task changed** (g55): `gate.js --task <id>` ran the whole Rust workspace for every task and every round, also when the task touched one leaf crate. It now finds the files changed since the task's `chore(team): <id> start` commit, maps them to workspace packages with `cargo metadata`, adds every package that depends on them, and runs `cargo test` and `cargo clippy` with `-p` for those only. A lock file, root manifest or anything else outside a package, or no start commit, runs the whole workspace; documents and `.claude/`, `.github/` settings do not widen it. `scope` in the result says which. `--full` or `gateScope: "full"` in `team/config.json` turns it off; the milestone and phase end run the gate without `--task`.

## Changes in 1.3.18

- **A hung check no longer holds the gate** (g54): a core test hung with no CPU and held a task's gate for 35 minutes; the lead waited on a result that never came, and once the run was stopped its output was lost, so nobody could tell which test it was. Each gate check now has a deadline, `gateCheckSeconds` in `team/config.json` (1200 by default, 0 for none; `NAC_GATE_CHECK_SECONDS` for one run). Past it the check is stopped with its whole process tree (the test binary under cargo or npm included) and comes back red with `timedOut`, its last lines and `hung` + `hangNote`, which says it is a hang and how to find the test.

## Changes in 1.3.17

- **Version bump only**: the plugin cache had taken 1.3.16 before g52 was added to it, and `/plugin update` does not refresh a cache whose version is unchanged. 1.3.17 carries the same code as the merged 1.3.16, so the update brings in the g52 hook.

## Changes in 1.3.16

- **The lead's start context stays under the hook limit** (g51): Claude Code saves hook context over 10,000 characters to a file and shows the session only a short preview. With the owner proxy section the lead's start context grew to about 10.3 KB, so since 2026-10-20 nearly every lead start and compaction got only the first ~2 KB: the lead prompt, the rules, the proxy and the resume never reached the lead, and a new lead said "NAC is not loaded" because the marker `NAC-LEAD-ACTIVE` sat past the preview. The marker now comes first, then the owner proxy, the resume and the resolved rules. When everything would pass 9,000 characters, the lead prompt is replaced by a line telling the lead to read `prompts/lead.md` in full first, and a resume still too long is cut with a note.
- **A reply to another session is recorded under its real recipient** (g52): when the lead answered the owner proxy it copied the incoming session address (`uds:\.pipe...`) into `to`, and the mailbox record said `to: unknown`. On the `owner-proxy` thread such an address is now recorded as the proxy from `team/config.json`, elsewhere as `peer-session`; a `name [ref]` recipient keeps its name.

## Changes in 1.3.15

- **Task build dirs are removed with the worktree** (g50): when a drive filled up, the lead moved builds to another drive with `CARGO_TARGET_DIR` (`target-T-059`, agent scratchpads). The worktrees were removed when tasks closed, but those build dirs stayed, about 60 GB, until the other drive filled up too and the team stopped for over two hours. `worktree.js add` now prints a `target` path beside the worktree (`<base>/target-<id>`), and `worktree.js remove` deletes every `target-<id>[-suffix]` directory there along with the worktree. The task-loop skill says to keep a build dir inside the worktree or at that path, never in a scratchpad, and to move `worktreeRoot` when a drive is full.

## Changes in 1.3.14

- **Proxy decisions are recorded as proxy decisions** (g49): the lead recorded an owner-proxy answer as the owner's own approval, the auto-mode classifier refused it, and from then on the lead recorded no proxy answer at all. `decisions.js decide --by proxy` now records "by: owner proxy <session>" and refuses owner-only questions (push, merge, deploy, publish, delete, irreversible or spending go-steps). `setup.js --proxy` also writes the delegation as an owner-proxy block in the project CLAUDE.md, in the owner's words, and commits it with the config.

## Changes in 1.3.13

- **Lead read guard** (g48): the lead read source files and long outputs itself, its context filled fast and auto-compaction thrashed. A `PreToolUse` hook now refuses a lead `Read` of a source file or a file over 40 KB unless it is a slice of at most 120 lines; roles are not touched. The lead prompt says to send long command output to a file and read its tail.

## Changes in 1.3.12

- **Owner proxy guard** (g47): after a compaction the lead asked the owner proxy's question in an `AskUserQuestion` box; the box waited for a key press and the proxy's answer waited behind it. A `PreToolUse` hook now refuses the box while `ownerProxy` is active and tells the lead to send the question by `SendMessage`. Push, merge, deploy, publish and delete questions still use the box, and "Owner direct: <reason>" lets the lead ask the owner when the proxy is not reachable.

## Changes in 1.3.11

- **A turn-budget stop is not a round** (g46): in T-082b the developer stopped at its turn budget twice while the work moved on part by part; both stops were counted as failed rounds and the third went to Opus. `board.js round` now needs `--reason gate|review|stuck` and refuses `--reason budget`, so a raised model follows a real failure only. The planner splits a brief with more than 3 separately testable parts.

## Changes in 1.3.10

- **Format-only red gate is not a round** (g44): in T-081 and T-084 the gate was red on `cargo fmt --check` alone and the developer was dispatched again for whitespace. The gate now says `fixable: true` when only checks with a fix command are red (a check's `fix` field, or the write form of `cargo fmt`, `ruff format`, `black` and `prettier --check`); `gate.js --task <id> --fix` runs the fixes, commits them as `style(<id>)` and runs the gate again. The developer rules also say to run the formatter before each commit.

## Changes in 1.3.9

- **Files: line notes** (g43): a note in parentheses after a path (`store.rs (read only, unless ...)`) split the path at its comma, so the code map called existing files new. Commas inside parentheses no longer split, notes and a leading "new" are dropped, and the planner writes notes on their own line.

## Changes in 1.3.8

- **Turn budget is enforced** (g36): a role cannot count its own turns, so the pack's budget line alone let a developer run into the `maxTurns` hard stop with no report and no commit. A new PostToolUse hook (`turn-budget.js`) counts the role's turns from its transcript, tells it in its last 5 turns to finish the step it is on, and at `turnBudget` to stop, commit only green work and report. Keep `turnBudget` below `maxTurns`.
- **Code map in the pack** (g37): the pack lists the declarations (with line numbers) of the files the brief names, so a role does not spend turns finding its way around them. The planner now writes one `Files:` line per code brief; an older brief without it gives its backticked paths that exist.
- **Obstacle rule** (g38): every role spends at most 3 turns on a blocker the brief did not foresee, then reports it; a test is never weakened to get past it.
- **Scope record and team/ files**: `task.js close` writes `team/metrics/scope-<id>.json` (how many changed files the `Files:` line names, the others by kind), a record for a later scope check, and warns when a code commit holds `team/` files. The developer rules now say the hand-off stays outside the code commit.
- **Findings amend and pack --ids** (g40): `findings.js amend <F-id> --file --line --symbol` corrects an open finding's address with the same checks as add; `findings.js pack --ids` packs part of a module's findings.
- **Board retitle** (g42): `board.js update <id> --title <text>`.

## Changes in 1.3.7

- **Findings need a file address** (g35): a finding recorded at a directory (`crates/bench/src:1`) made `findings.js pack` fail with EISDIR, so the hardening pack could not be built. `findings.js add` and `task.js close --findings` now refuse a directory address (close before anything is recorded), and `pack` notes an old directory address in the pack instead of failing.

## Changes in 1.3.6

- **Permissions commit names both scripts**: `setup.js --permissions` committed as `allow team-commit.js for the lead (g27)` although it also adds the `task.js` rule (g33); the message is now `chore(nac): allow team-commit.js and task.js for the lead (g27, g33)`.

## Changes in 1.3.5

- **Fewer lead calls for bookkeeping** (g33): about a third of the lead's calls went to the board, team commits, the hand-off and findings. `task.js start <id>` now does in-progress, the hand-off skeleton with the base commit, the worktree and the role's pack, then one commit; `task.js note <id>` appends to the hand-off; `task.js close <id> --commit <sha> [--findings <file>] --lead-note <text>` records the findings, done (same refusals as before), the cost file and, when due, the lead hand-off, then one commit. Setup's allow rule covers `task.js` too; for a project set up earlier run `! node <path>/scripts/setup.js --permissions` once.
- **A fresh lead after every task** (g34): with compaction the lead rotates after every task (5 with `/clear`; `rotateEvery` in `team/config.json` overrides; `rotateBy` picks `clear` or `compaction`, g76), and `task.js close` writes the lead hand-off itself. `! node <path>/scripts/setup.js --compaction --window 100000` sets a smaller `autoCompactWindow` (at least 100000) so compaction comes at about each task end.
- **Compaction no longer stuck** (g32): soft conditions (a task without a hand-off, uncommitted `team/` files, a done commit that is missing) defer autocompact by `compaction.softMargin` tokens at most (20000 by default) and then let it run with a hand-off that names them; only an open owner question still blocks up to the ceiling.
- **Gate waits for a running check** (g31): `gate.js` waits up to `gateWaitSeconds` (300 by default) while the same check program is already running, and says `busy` with a note when it still is; roles are told to run tests in the foreground and never leave one running.

## Changes in 1.3.4

- **Worktree remove follows the board** (g30): `worktree.js remove` looked only under `<worktreeRoot>/<repo>-wt/<id>`, so a worktree the board recorded elsewhere was not found and had to be removed with git by hand. It now removes the worktree the board records and falls back to the computed path.

## Changes in 1.3.3

- **Owner proxy in config** (g29): a proxy session agreed in chat only was unknown to the next lead session, which opened a question box the proxy cannot answer, and the classifier refused the lead recording a standing delegation itself. You now set it once with `! node <path>/scripts/setup.js --proxy <session> [--until YYYY-MM-DD]` (`--proxy off` removes it); it lands in `team/config.json` as `ownerProxy`, and every lead session sends owner questions to that session by SendMessage. Push, merge into the main branch, deploy, publish and deleting your data still come to you.

## Changes in 1.3.2

- **Pack and gate follow the task worktree** (g28): `pack.js --base` took the diff and `gate.js --task` ran the checks in the main tree while the task worked in its own worktree, so the pack came out empty and the gate checked the wrong code. Both now use the worktree the board records; a recorded worktree that is missing is an error.

## Changes in 1.3.1

- **Team commits allowed for the lead** (g27): the auto-mode classifier refused the lead's `team-commit.js` run, so team commits fell to you. Setup now writes a project allow rule for exactly that script (plugin root and a directory marketplace source); for a project set up earlier run `! node <path>/scripts/setup.js --permissions` once. The lead runs `team-commit.js` on its own, never chained.

## Changes in 1.3.0

Each item names the gap it closes; details are in the sections above.

- **Gate runs every check** (g18): `gateCommands` runs test, lint and format checks; setup fills defaults per stack.
- **Context pack required** (g22): code-role, test-engineer, final-reviewer and database-engineer dispatches without a pack are refused; `cost.js` warns below 100% packed.
- **Go-path test before an irreversible step** (g23): an `--irreversible` go question needs a named go-path test command that is run and exits 0, and a green gate.
- **Parked questions** (g16): owner-deferred questions no longer block compaction.
- **Commit each green step** (g19): size tag on tasks; `board.js` refuses done on an M/L task (no size counts as M) with at most one code commit unless `--single-commit <reason>`; `--code no` tasks are exempt.
- **No behaviour beyond the brief** (g21): developers propose extra branches as questions; reviewers flag out-of-brief code.
- **Setup commits its own changes** (g11): `--compaction` keeps line endings and indentation; `--apply` commits exactly the files it created or changed.
- **True hand-off trigger** (g17): the hand-off states safe point or ceiling, the failed conditions and the real next task.
- **Cost file on done** (g20): `board.js done` writes the task cost file when it is missing.
- **Hand-off questions from the log** (g14), **buried questions** (g13), **rotation by hand-off when compaction is on** (g15), **drift warning only on a real difference** (g12).
- **One code task per working tree** (g24): a second in-progress code task in the same tree is refused; `worktreeRoot` sets where worktrees go.
- **Compaction when the lead is safe** (g25): allowed with tasks in flight when `team/` is committed, no question is pending and every in-progress task has a hand-off; ceiling 220000.
- **Unknown Q/D-ids** (g26): the Stop hook flags a Q-id or D-id in the lead's message that `decisions.md` does not hold.
- **Team-only commits** (D-227): team-state commits use a `team/`-only pathspec through `team-commit.js`.
- Tests: git timing in tests is deterministic (pinned dates and identity, explicit-clock cache test).

## License

MIT. Parts are adapted from superpowers by Jesse Vincent; see [NOTICE](NOTICE).
