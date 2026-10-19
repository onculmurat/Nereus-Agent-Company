# Nereus Agent Company (NAC)

[Türkçe](README.tr.md)

A Claude Code plugin that gives one person a whole software team of AI agents. You describe what you want; the team lead in your own Claude Code session splits the work, runs the roles, and asks you whenever a decision is yours.

## What NAC is and why

Building a product alone means playing every role: architect, developer, reviewer, security reviewer, writer. NAC gives each of those roles its own agent with its own instructions and model, and puts a lead between you and them. The principles behind it are in the [manifesto](MANIFESTO.md).

- You talk only to the lead (your Claude Code session). You never assign tasks.
- The team never decides for you. Product, scope and design choices, outward actions (push, deploy, publish) and deviations from an approved plan always come to you as a question.
- Everything the team knows lives in your project under `team/`, so work survives restarts.

NAC has no graphical interface. It runs inside the Claude Code terminal.

**v1.2 scope.** This release ships the core roles (team lead, researcher, finance analyst, architect, planner, backend developer, frontend developer, database engineer, test engineer, code reviewer, final reviewer, security reviewer, doc writer, assistant) and phases 0, 1, 3, 4, 5 and 6. Planned next: v2 adds product manager, UX and UI designers, DevOps engineer and phases 2 and 7; v3 adds marketing and the remaining business roles and phases 8 and 9.

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
- **Parallel tasks** (`worktree.js`): a second task starts in its own git worktree (`<repo>-wt/<id>`, branch `task/<id>`); `integrate` cherry-picks it onto the working branch locally. Push, merge into the main branch and deploy still need your approval.
- **Lead rotation** (`board.js`): after 5 tasks marked done (or a milestone end) the lead writes a hand-off note and asks you to run `/clear`; the next session resumes from it.
- **Skip count** (`gate.js`): the test gate reports how many tests were skipped, ignored or todo; each skip needs a written reason in the hand-off.
- **Turn budget** (`turnBudget`, default 40; the old name `callBudget` still works): every dispatch may use 40 model turns, parallel tool calls sharing one turn (stated in the pack header; `maxTurns` in the agent files is 45, leaving 5 turns to write the report). A role that hits it reports what is done and what is left; the lead re-dispatches the rest with a fresh pack (same round) or splits the task.
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

- Allowed when nothing is in flight: no task `in-progress` or `review`, the git working tree is clean (ignored files do not count), the last `done` task has its commit on HEAD, and no owner question is open or deferred. NAC then writes a short `team/work/handoffs/compact-<stamp>.md` (board state, next task, pointer to `team/decisions.md`), and the next session start (source `compact`) points the lead to it.
- Otherwise the compaction is deferred with a one-line reason. Above the ceiling (`compaction.ceiling`, default 300000 tokens in context) it runs anyway, so a deferral can never overflow the context.
- Manual `/compact` is never blocked. Any error in the hook allows the compaction.

Defaults, in `defaults/config.json` (override in `team/config.json`):

```json
{ "compaction": { "autoCompactWindow": 200000, "ceiling": 300000 } }
```

`/nac:setup` writes `autoCompactWindow` (minimum 100000) and `idleCompaction: false` into the project `.claude/settings.json` without touching values you already set; for a project set up earlier, `node <path>/scripts/setup.js --compaction` writes only these two keys (`--dry-run` prints them). The auto-mode classifier can block the lead from editing settings, so the session-start hint asks you to type it with `!`. The first automatic compaction fires somewhat below the window (about 72% in a spike with 100000), so do not rely on the exact point. If your shell sets `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, its interaction with `autoCompactWindow` is untested; NAC does not depend on it.

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
- A `PreToolUse` guard on Bash and PowerShell holds every role and the lead to one rule: a recursive delete (`rm -r`, `Remove-Item -Recurse`, `rmdir /s`, `rd /s`, `del /s`, `rimraf`, `find -delete`) is allowed only inside the project and the temp folder. A variable assigned a literal value earlier in the same command (`S=/tmp/x; rm -rf "$S"`, `$d = "..."` in PowerShell) is replaced by that value first; any other variable stays unresolved. A drive root, `~`, `/`, the home directory, a path outside the project, or a target it cannot resolve (variable, command substitution, a pattern that can match `..`) is blocked with a message that tells the agent to ask the lead. It also blocks `git clean` with `-x`/`-X` and `-f`/`-d` (dry runs stay allowed), inline code that deletes a blocked path (`node -e`, `python -c`, `perl -e`, `ruby -e`, `pwsh -Command`), and `-EncodedCommand` (decoded and checked, blocked when it cannot be decoded). A script file run by name (`bash x.sh`, `node x.js`, `python x.py`, `pwsh x.ps1`, `./x.sh`) inside the project or temp folder is scanned with the same rules when it is under 64 KiB; plugin scripts, missing files and larger files are not scanned, so a script outside that can still delete what the guard never sees.
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

## License

MIT. Parts are adapted from superpowers by Jesse Vincent; see [NOTICE](NOTICE).
