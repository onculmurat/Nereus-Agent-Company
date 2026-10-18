# Nereus Agent Company (NAC) — Design

Status: draft, awaiting owner approval. Date: 2026-10-18.

## 1. Intent

NAC is a Claude Code plugin that gives a single person a complete "company" of AI agents able to take a
project from idea to launch and operation: research, product, design, engineering, quality, security,
docs, marketing and business roles.

It generalises a working method proven on a real project (Personal Vault): the owner describes the idea,
a lead turns it into a written brief, specialists do the work task by task, every task is reviewed,
and every decision belongs to the owner.

Why it exists:
- The owner wants the same disciplined team on every project instead of re-explaining rules each time.
- Agents today start cold and re-read everything; the owner wants a shared, persistent memory so an agent
  reads only what it needs, and nothing is lost when a session closes.
- Agents should talk to each other and escalate only when they cannot resolve something.

NAC is built for the owner first and will be published for general use.

## 2. Goals, non-goals, anti-goals

Goals
- Any project can be run end to end by the team: phases 0–9 (section 8).
- The owner is interrupted only for decisions; everything else is resolved inside the team.
- Nothing resets when a session ends: board, decisions, messages and hand-offs persist on disk.
- Each role runs on its own model; models and rules are configurable, not hard-coded.
- A first-time reader understands how the team works from the manual alone.

Non-goals
- Replacing a lawyer, accountant or other licensed professional (legal and finance roles prepare drafts and
  question lists only).
- Running unattended outward actions (publishing, paying, deploying, posting) without owner approval.
- Depending on the superpowers plugin (ideas are adapted, not imported).

Anti-goals (the project fails if these happen, even if it "works")
- An agent makes a product, design or scope decision on its own.
- A decision, open question or message is silently lost (by session end or by cleanup).
- The team burns tokens looping on the same issue without escalating.
- The owner cannot tell why the team did something.

## 3. Constraints

- Delivery: a Claude Code plugin in a git repository at `D:\Projects\Agent Team`, installed via a local
  marketplace; later publishable.
- Name: `nereus-agent-company`, short name NAC.
- License: MIT. Parts adapted from superpowers (MIT, © 2025 Jesse Vincent) keep that copyright notice.
- Language: all repository content (folders, file names, role names, agent instructions, config keys) is
  English. The team always answers in the language the user writes in (the owner writes Turkish).
- Manual: `README.md` (English) and `README.tr.md` (full Turkish translation), updated in the same commit.
- Claude Code "agent teams" is experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); known limits:
  teammates are not restored on `/resume`, team directories are deleted at session end, no nested teams,
  lead plan approval is automatic, task status can lag, token cost scales with teammate count.
- Must work on Windows, macOS and Linux.

## 4. Owner's rules (shipped as configurable defaults)

These are the owner's rules. NAC ships them as defaults in its config so other users can change them.

1. Never decide without asking. Anything that becomes a product/scope/design decision, an outward action, a
   mandatory step, or a deviation from an approved spec or plan is asked as an explicit question. This
   overrides any skill or default behaviour.
2. Question format: every question starts with Source (old open item or newly found; where, who found it),
   Status (is code written; does the answer change existing work), Impact (what it affects), then options
   and one recommendation. One question at a time.
3. Question timing: a blocking question (work cannot continue) is asked immediately; a non-blocking question
   is queued in the decision log and asked when the owner says "any questions?" or in the phase report. The
   team keeps working on anything not blocked.
4. Outward or paid actions (deploy, infrastructure apply, publish, post, merge/push, purchases) always need a
   separate explicit approval.
5. Project documents (section 10).

## 5. Roles and models

Model is the role's default; the escalation ladder (section 7) may raise it temporarily.

| # | Role (agent name) | Responsibility | Default model |
|---|---|---|---|
| 1 | `team-lead` (the owner's session, section 6) | Talks to owner, writes brief, assigns work, keeps board, resolves escalations, asks owner | Opus |
| 2 | `product-manager` | Priorities, roadmap, first-release scope proposals | Sonnet |
| 3 | `researcher` | Competitors, technology options, known attacks; sourced reports | Opus |
| 4 | `architect` | Spec, service split, data model, interface contracts | Opus |
| 5 | `planner` | Spec to small testable tasks and task briefs | Sonnet |
| 6 | `ux-designer` | User flows, screen copy, error messages, usability checks | Sonnet |
| 7 | `ui-designer` | Mockups, design system, accessibility | Sonnet |
| 8 | `backend-developer` | Server code and tests | Sonnet |
| 9 | `frontend-developer` | UI code and tests | Sonnet |
| 10 | `database-engineer` | Schema, migrations, permissions, performance | Sonnet |
| 11 | `test-engineer` | E2E/integration tests, load tests, test vectors | Sonnet |
| 12 | `devops-engineer` | Infra code, CI, deployment; asks before any paid/outward step | Sonnet |
| 13 | `code-reviewer` | Per-task review: spec compliance + code quality | Sonnet |
| 14 | `final-reviewer` | Whole-branch review at the end of a phase | Opus |
| 15 | `security-reviewer` | Threat model, attack-based review, crypto and authz | Opus |
| 16 | `doc-writer` | Writes decisions into docs; keeps project documents | Sonnet |
| 17 | `assistant` | Summaries, format checks, light classification, cleanup | Haiku |
| 18 | `marketing-strategist` | Positioning, audience, message, launch plan | Sonnet |
| 19 | `content-writer` | Website, landing page, blog, store listings | Sonnet |
| 20 | `seo-specialist` | Keywords, site structure, search visibility | Sonnet |
| 21 | `social-media-manager` | Post calendar and drafts; never publishes without approval | Haiku |
| 22 | `brand-designer` | Logo, visual identity, promo visuals | Sonnet |
| 23 | `finance-analyst` | Per-user operating cost, pricing model, profitability | Opus |
| 24 | `legal-compliance` | GDPR/KVKK checks, policy drafts, lawyer question list; not legal advice | Opus |
| 25 | `support-specialist` | Help center, FAQ, reply templates | Sonnet |
| 26 | `data-analyst` | Product metrics, privacy-respecting analytics, reports | Sonnet |

Rules for all roles
- Only the lead talks to the owner (the owner may still message any teammate directly).
- A role works only inside its responsibility; cross-role changes go through a message to the owning role.
- Roles not relevant to a project are never spawned, but stay available.
- At most 3–5 roles are active at once; the lead closes roles whose work is done.
- Every role checks its inbox at start, after each step and before finishing (section 9).
- The NAC model table is the single source of truth. On install, the owner's global `CLAUDE.md` model
  section is replaced by a pointer to it (only with owner approval at install time).

## 6. The lead and execution modes

The lead
- `team-lead` is not a separate agent: Claude Code only lets the session the owner talks to spawn and
  coordinate agents (teammates cannot spawn teammates). The owner's own session *is* the team lead. The owner
  describes what they want; the lead splits and assigns the work. The owner never assigns tasks.
- In a NAC project, a `SessionStart` hook gives every new session the lead instructions, the resolved rules
  and a resume summary, so the owner just starts talking. `agents/team-lead.md` does not exist; the lead's
  instructions live in a skill/hook payload.

Plugin activation (owner decision)
- NAC is installed once but disabled globally. `/nac:setup` enables it for one project only (project
  settings), enables agent teams there and creates `team/`. Other projects load nothing, so the 26 role
  descriptions cost no context outside NAC projects. How `/nac:setup` runs before the plugin is enabled in
  the project (bootstrap) is verified in the spike (section 14).

Mode per phase (owner decision)
- Team mode for discussion phases: research (1), design (3), final check (6), marketing (8). Roles question
  each other and talk directly.
- Subagent mode for build (5) and the remaining phases: a fresh one-shot implementer and reviewer per task.
  The lead spawns these *without a name*, because Claude Code turns every named spawn into a teammate when
  agent teams is on; unnamed spawns stay subagents, so agent teams can stay enabled for the whole project.
- If team mode fails or is turned off, team phases fall back to subagents with messages routed through the
  lead. Role files, memory and mailbox are identical in both modes.

Countermeasures for known team-mode limits (my call)
- Automatic plan approval: teammates do not use plan mode; "ask before any decision" is enforced through the
  lead instructions and the question protocol. The README states honestly that this is instruction-level,
  not a mechanical block.
- Lagging task status / early stop: a `TaskCompleted` hook checks completion criteria on native tasks (review
  passed, hand-off written); `team/work/board.md` remains the source of truth.
- Lost teammates after `/resume`: the lead rebuilds from board, mailbox and hand-offs (section 9).
- Model escalation in team mode means respawning the role on the higher model with a hand-off note, since a
  teammate's model is fixed at spawn.

## 7. Escalation

Two ladders, applied in order. One round = one attempt plus its review. A reviewer finding counts as a round.

1. Model ladder: after 2 unresolved rounds on the same issue, the role retries one tier up
   (Haiku → Sonnet → Opus).
2. Authority ladder: after 2 more unresolved rounds, the issue goes to `team-lead`.
3. The lead gets 1 round; if unresolved, or if the issue needs a decision, it goes to the owner as a
   question (section 4).

Maximum 5 rounds per issue. Thresholds are configurable per project. Every escalation is recorded
(`team/work/escalations/`). The round counter lives on the board entry of the task or thread and only the lead
increments it (my call), so no agent relies on memory.

Questions from other roles: only the lead talks to the owner (subagents cannot ask the user anyway). A role
that needs a decision stops, returns or messages a "question for owner" (the facts for Source/Status/Impact,
options, its recommendation) to the lead, and the lead asks. A blocked one-shot subagent ends; its task is
resumed or re-dispatched with the answer. Escalation can be triggered by the role itself or by a reviewer; a role that does
not notice it is stuck is caught by review.

## 8. Phases

| Phase | Roles | Output | Owner approval |
|---|---|---|---|
| 0 Kick-off | team-lead | Project brief: goal, why, competitors, dream, failure criteria | yes |
| 1 Research | researcher, finance-analyst, legal-compliance | Competitor/technology report, first cost estimate, legal risks | yes |
| 2 Product definition | product-manager, ux-designer | First-release scope, user flows | yes |
| 3 Design | architect, security-reviewer, ui-designer | Spec, threat model, mockups | yes |
| 4 Planning | planner | Sub-plans and task briefs | yes |
| 5 Build | developers, database-engineer, test-engineer, code-reviewer, doc-writer | Per task: code, tests, review, docs | only for decisions |
| 6 Final check | final-reviewer, security-reviewer | Findings and fixes | yes |
| 7 Release | devops-engineer | Live environment; each paid/outward step approved separately | yes |
| 8 Marketing & launch | marketing roles, brand-designer | Site, messages, launch plan; nothing published unapproved | yes |
| 9 Operations | support-specialist, data-analyst, finance-analyst | Help center, metrics, real per-user cost | yes |

Phases are not strictly sequential (marketing may start during build) and may loop back (a review can send
work back to design). Each phase ends with a short phase report from the lead (done, decided, open) and the
next phase starts on owner approval.

Build-phase task loop (adapted from superpowers subagent-driven development): fresh implementer per task
from a task brief → per-task review (spec + quality) → fix rounds under the escalation ladder → ledger entry.
A task is never re-dispatched once the board marks it complete.

## 9. Shared memory and mailbox

All state lives in the project, under `team/`:

```
team/
  config.json            project overrides (models, thresholds, rules)
  brief.md               project brief (phase 0)
  decisions.md           decision log: question, answer, date, link; open questions live here too
  contracts/             interface contracts (API, DB schema, events)
  glossary.md
  work/                  git-ignored
    board.md             task board and ledger (who, what, status, commits)
    handoffs/            one hand-off note per finished task
    escalations/
    mailbox/
      <thread-id>/<timestamp>-<from>-to-<to>.md
    archive/
```

Persistent knowledge (brief, decisions, contracts, glossary, config) is committed. Working state (`work/`) is
git-ignored.

Sources of truth (my call)
- `team/work/board.md` is the authoritative board; native team tasks are a mirror used only in team phases.
- `team/work/mailbox/` is the authoritative message store in both modes; native team delivery is the live
  transport. Each message carries an id, so an agent that sees it twice (live and on disk) handles it once.
- Single writers: only the lead writes `decisions.md` and `board.md`; `contracts/` are written by the
  owning role (architect, database-engineer) and others propose changes by message. Everything else is
  file-per-item, so parallel roles never edit the same file.
- Commits: implementers commit their own task on the working branch (as today); merge and push need owner
  approval.

How an agent works
1. It reads the short brief, its task, the relevant contract and its unread messages; not the history.
2. When done, it updates decisions/contracts, writes a hand-off note and marks the task.
3. To tell another role something it messages that role directly.

Mailbox
- Every message is its own file (no write conflicts), with from, to, thread, date, state
  (unread / read / closed) and body.
- A `PostToolUse` hook on `SendMessage` copies each live message into the mailbox automatically, so nothing
  depends on the agent remembering.
- Agents check their inbox at start, after each step and before finishing, and mark messages read. Agents are
  not background pollers; a message waits until the recipient next runs.
- After a session ends, the lead rebuilds from board + mailbox + hand-offs and respawns roles with their
  hand-off note. Only an agent's in-flight reasoning is lost.

Cleanup
- Messages belong to a thread. When a thread is resolved, its outcome goes into `decisions.md` and the thread
  is marked closed.
- Periodically (weekly, or at phase end) the `assistant` role archives or deletes closed threads older than a
  configurable age.
- Rule: nothing is deleted unless its outcome is in `decisions.md`.

## 10. Project documents (defaults)

- `memory.md`: only the last finished item and the next item; one sentence with date, spec link if any;
  overwritten after each item.
- `plan.md`: deferred / out-of-scope work only; finished items are removed.
- `article_dev.md`: notes for a future article/talk, added in every fix/feature commit without being
  reminded: trigger, root cause, process, lesson, measurements; no source names when comparing with others.
- `docs/setup-requirements.md`: every new dependency (driver, runtime, model file, service setting,
  permission) added in the same commit.
- Open questions and decisions: `team/decisions.md` (no separate questions file).

Each can be switched off in config.

## 11. Plugin layout and setup

```
.claude-plugin/plugin.json
.claude-plugin/marketplace.json     local marketplace for install
agents/<role>.md                    25 role definitions (model, tools, instructions); the lead is the
                                    owner's session (section 6), configured by skill + SessionStart hook
skills/                             lead orchestration, phases, question protocol, escalation,
                                    task loop, mailbox, cleanup, phase report
commands/                           setup, status, questions ("any questions?"), cleanup
hooks/hooks.json                    SendMessage logger, TaskCompleted gate, TeammateIdle inbox check,
                                    SessionStart resume
scripts/                            mailbox and board helpers
defaults/config.json                shipped defaults (owner's rules, model table, thresholds)
templates/                          team/ skeleton, brief, decisions, project documents
README.md, README.tr.md, LICENSE, NOTICE
```

Config resolution: shipped defaults → user-level config → project `team/config.json`. Machine-read keys:
models, escalation thresholds, cleanup age, document toggles, phase list. Prose rules (question protocol,
"never decide") are injected by the `SessionStart` hook into the lead and included in every dispatch
prompt the lead writes, because a definition's `skills:` are not applied to teammates (my call).

Runtime (owner decision): hooks and scripts are Node.js, one codebase for Windows, macOS and Linux. Node is
listed in the README and in `docs/setup-requirements.md`; `/nac:setup` warns if it is missing.

Setup command (run once per project): enables the plugin and agent teams in the project's
`.claude/settings.json` (merging into existing `env`/hooks, never overwriting; shows the diff), creates
`team/` from templates, adds `team/work/` to `.gitignore`, creates the project documents that are enabled,
and starts phase 0. It shows every file it will write and asks before writing. Replacing the model section
of the owner's global `CLAUDE.md` with a pointer to the NAC table is a separate, explicitly approved step.

Resume (my call): on `SessionStart` (startup or resume) the hook injects a summary: current phase, open
board items, in-progress tasks (with `git status` to detect partial work), unread messages, queued owner
questions. The lead continues from there.

## 12. Manual

`README.md` / `README.tr.md` explain, for a first-time reader: what NAC is and why, install, starting a project,
phases, roles and models, how questions and decisions work, escalation, shared memory and mailbox, cleanup,
configuration, team mode vs subagent mode and its limits, safety rules, FAQ.

## 13. Left to the builder

- Exact skill and command split and names (within section 11).
- Message and board file formats (must carry the fields in section 9).
- Hook implementations in Node.js.

## 14. Releases (owner decision)

- Spike first (my call): verify on a throwaway project (1) that a `PostToolUse` hook on `SendMessage` fires
  and what its input contains, for lead and teammate sends; (2) the `/nac:setup` bootstrap for a plugin that
  is disabled globally; (3) `SessionStart` injection of the lead instructions. If (1) fails, messages are
  written to the mailbox by the sending agent through a helper script, and the README says so.
- v1 — core: team-lead, architect, planner, backend-developer, frontend-developer, database-engineer,
  test-engineer, code-reviewer, final-reviewer, security-reviewer, doc-writer, assistant; phases 0, 3, 4, 5,
  6; shared memory, mailbox, escalation, setup, manual (EN + TR).
- v2 — researcher, product-manager, ux-designer, ui-designer, devops-engineer; phases 1, 2, 7.
- v3 — marketing and business roles; phases 8, 9.
- Each release is used on a real project before the next starts.

Definition of done for each release: Node scripts covered by tests using recorded hook payloads; a scripted
dry run of setup → phase report on a sample project; README/README.tr.md in sync.

## 15. Open questions

None at present. Items marked "my call" are for the owner to confirm while reading.
