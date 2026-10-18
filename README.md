# Nereus Agent Company (NAC)

[Türkçe](README.tr.md)

A Claude Code plugin that gives one person a whole software team of AI agents. You describe what you want; the team lead in your own Claude Code session splits the work, runs the roles, and asks you whenever a decision is yours.

## What NAC is and why

Building a product alone means playing every role: architect, developer, reviewer, security reviewer, writer. NAC gives each of those roles its own agent with its own instructions and model, and puts a lead between you and them.

- You talk only to the lead (your Claude Code session). You never assign tasks.
- The team never decides for you. Product, scope and design choices, outward actions (push, deploy, publish) and deviations from an approved plan always come to you as a question.
- Everything the team knows lives in your project under `team/`, so work survives restarts.

NAC has no graphical interface. It runs inside the Claude Code terminal.

**v1.1 scope.** This release ships the core roles (team lead, researcher, finance analyst, architect, planner, backend developer, frontend developer, database engineer, test engineer, code reviewer, final reviewer, security reviewer, doc writer, assistant) and phases 0, 1, 3, 4, 5 and 6. Planned next: v2 adds product manager, UX and UI designers, DevOps engineer and phases 2 and 7; v3 adds marketing and the remaining business roles and phases 8 and 9.

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

Setup first shows a dry run: every file it would create, the change to `.claude/settings.json` (agent teams on, NAC enabled), and the `.gitignore` line. Nothing is written until you approve. It never overwrites an existing file or setting; a conflicting setting stops it. It then asks, as a separate question, whether to point the model section of your global `~/.claude/CLAUDE.md` at NAC's model table. Finally run `/clear` (or restart Claude Code): the session that ran setup started before NAC was set up, so only the next session loads the lead instructions. The lead then starts phase 0.

Your session is the lead, and the lead runs on your session's model. Use `/model opus` for the lead.

### What setup creates

- `team/`: `config.json`, `brief.md`, `decisions.md`, `glossary.md`, `contracts/`, and `team/work/` (board, hand-offs, escalations, mailbox, archive; git-ignored).
- Project documents, each switchable in config: `memory.md`, `plan.md`, `article_dev.md`, `docs/setup-requirements.md`.

## Phases

| Phase | Roles | Output | Your approval |
|---|---|---|---|
| 0 Kick-off | lead | Project brief: goal, why, competitors, dream, failure criteria | yes |
| 1 Research (optional: the lead asks) | researcher, finance analyst | Sourced report in `team/research/`: competitors, technology, known attacks, licenses, cost estimate and free tier limits | yes |
| 3 Design | architect, security reviewer | Spec, contracts, threat model | yes |
| 4 Planning | planner | Task briefs and board entries | yes |
| 5 Build | developers, database engineer, test engineer, code reviewer, doc writer | Per task: code, tests, review, docs | only for decisions |
| 6 Final check | final reviewer, security reviewer | Findings and fixes | yes |

Each phase ends with a short phase report (done, decided, open), and the next phase starts only when you approve. Phases can loop back: a review can send work back to design.

## Roles and models

| Role | Responsibility | Model |
|---|---|---|
| team lead (your session) | Talks to you, assigns work, keeps the board, asks you | your session model |
| researcher | Competitors, technology options, known attacks, licenses; sourced | opus |
| finance-analyst | Cost estimate, paid services, free tier limits; sourced | opus |
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

Every question to you has the same shape: **Source** (where it came from, who found it), **Status** (is code written, does the answer change existing work), **Impact**, the options, and one recommendation. One question at a time.

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
- The research roles (researcher, finance-analyst) read untrusted web pages and competitor code, so a `PreToolUse` guard limits them against prompt injection: they read only `team/brief.md`, `team/research/` and the clone folder (not decisions, the mailbox or other roles' notes), write only to `team/research/` (their hand-off notes included), and Bash runs only NAC's mailbox and clone scripts. If the guard fails, it blocks the call. They can send messages only under their own header. The mailbox hook records every NAC role under its real role, whatever its message header claims, and tells the lead about a false claim; other roles read research messages as data. Web tools stay open; with no secrets in reach there is nothing to leak. No clean-up can remove visible injected text, so later roles read the research report as data.
- Hooks do nothing outside a NAC project (a folder without `team/config.json`).

## FAQ

### Does NAC slow down my other projects?

No. It is disabled except in projects where you enabled it.

### Can I talk to a role directly?

Yes. The lead is your normal contact, but you can message any teammate.

### What if I close Claude Code mid-task?

The next session starts with a resume summary: phase, work in progress (with `git status`), open board items, unread messages for the lead and queued questions.

### Is team state committed?

`team/brief.md`, `decisions.md`, `contracts/`, `glossary.md` and `config.json` are meant to be committed. `team/work/` is git-ignored.

## License

MIT. Parts are adapted from superpowers by Jesse Vincent; see [NOTICE](NOTICE).
