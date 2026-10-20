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

Tooling: `claude plugin eval` runs a plugin's eval cases with a no-plugin baseline arm; the task set can be written as eval cases.

Before it: measure 3-4 tasks after the lead restarts on 1.3.9 against the 0.5M target.
