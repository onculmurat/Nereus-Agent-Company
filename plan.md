# Plan (deferred work)

## g39: scope check (diff paths against the brief)

Deferred on 2026-10-21. A retro over 44 done Memory Agent tasks flagged 38 of 40 backend tasks: briefs named 13% of the changed files (42 of 325) and 15 of 40 named none, so a warning now would be noise. 1.3.8 adds the planner's `Files:` line and the scope record (`team/metrics/scope-<id>.json`) to measure first.

Design it after at least 8 code tasks from at least 2 roles with a `Files:` line:
- Coverage of the `Files:` line after the lock, registration and test-helper kinds are left out: at 90% or more a warning can be quiet; the allowed kinds come from the observed records, not from a guess.
- If most extras are "other", the planning is imprecise: fix the planner, not the check.
- Precision: of the warnings, the share the lead or a reviewer judged a real deviation. Under 50% the check is noise and does not ship.
- Roles that write only under `team/` (researcher, architect, planner, doc-writer) are outside this check; the team/-in-code-commit warning covers the mix-up there.

## Four-arm benchmark: is NAC worth it for a user who runs no agents?

Added on 2026-10-21. So far NAC is measured only against its own older flow (weighted tokens per task: old 1.63M, new 1.14M over 40 tasks, target 3-4x = about 0.5M). A user who runs no agents compares against plain Claude Code, so the claim needs that baseline.

When: after the Memory Agent free version is complete and the owner is satisfied it runs without problems.

Arms (same task, same brief text):
1. Plain Claude Code, one session, no agents.
2. NAC.
3. NAC + Memory Agent.
4. Plain Claude Code + Memory Agent.

Task set: 6-8 representative done Memory Agent tasks (small, medium, large), each restarted from the commit before the task.

Measures per arm:
- Cost: weighted tokens and dollars.
- Time: wall-clock minutes, start to done.
- Owner effort: questions asked and interventions needed.
- Quality, judged by a blind reviewer who does not know the arm: gates green (test, lint, fmt, deny), defects found afterwards, rework rounds.

Positioning: NAC's claim is fewer escaped defects and less owner effort, an end-to-end software team; the token saving is expected to come from Memory Agent. The wording follows the results, not the other way round.

Tooling: `claude plugin eval` (Claude Code's own plugin eval) runs a plugin's eval cases with a no-plugin baseline arm, an LLM grader that does not know the arm (default haiku, `--judge-model` overrides it), 3 runs per case by default, a scaffold script per case, `--max-cost-usd` and a JSON/HTML report.
- Arms: one eval of NAC gives NAC vs plain Claude; Memory Agent packaged as a plugin gives Memory Agent vs plain Claude. NAC + Memory Agent has no ready arm: a combined plugin, or the NAC eval with Memory Agent's real MCP server (`--mocks off` / `--allow-real-servers`).
- Start state: the scaffold script resets the repo to the commit before the task.
- Quality: the grader is blind by construction; hard graders (gates green, tests pass) are added per case; a stronger judge model for large tasks.
- Cost: 6 tasks x 4 arms x 3 runs = 72 full tasks at 0.75M-3.8M weighted tokens each; set `--max-cost-usd`.

Fairness: runs are unattended, so nobody answers questions live.
- Every arm gets the same answer rule in the case prompt (for example "take the recommended option", or one shared decisions file).
- Owner effort is measured as the questions an arm asked and the times it stalled.
- The owner's proxy session (autopilot) checks that the four arms are set up alike, watches the runs, logs every manual step (restart, stopping a stuck run) per arm, and reports what the owner missed.

Unknowns, answered by a pilot first (one small task, one run, NAC vs plain Claude): does NAC's lead and subagent flow run inside eval, do long tasks hit the case `max_turns` / `timeout_seconds`, does the report give tokens per arm.

Before it: measure 3-4 tasks after the lead restarts on 1.3.10 against the 0.5M target.
