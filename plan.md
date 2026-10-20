# Plan (deferred work)

## g39: scope check (diff paths against the brief)

Deferred on 2026-10-21. A retro over 44 done Memory Agent tasks flagged 38 of 40 backend tasks: briefs named 13% of the changed files (42 of 325) and 15 of 40 named none, so a warning now would be noise. 1.3.8 adds the planner's `Files:` line and the scope record (`team/metrics/scope-<id>.json`) to measure first.

Design it after at least 8 code tasks from at least 2 roles with a `Files:` line:
- Coverage of the `Files:` line after the lock, registration and test-helper kinds are left out: at 90% or more a warning can be quiet; the allowed kinds come from the observed records, not from a guess.
- If most extras are "other", the planning is imprecise: fix the planner, not the check.
- Precision: of the warnings, the share the lead or a reviewer judged a real deviation. Under 50% the check is noise and does not ship.
- Roles that write only under `team/` (researcher, architect, planner, doc-writer) are outside this check; the team/-in-code-commit warning covers the mix-up there.
