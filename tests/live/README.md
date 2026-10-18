# Live tests: real Claude Code sessions

The unit tests feed the hooks recorded or synthetic payloads. These tests run NAC in real interactive Claude Code sessions and check what actually happened: the hook calls (recorded through `NAC_HOOK_LOG`), the owner's session transcripts, the board, the decisions and the mailbox. `claude -p` cannot run them: headless mode has no team tools and no owner to answer questions.

## Steps

1. Prepare a scenario in a new folder (it refuses an existing one, so no real project is touched):

   ```
   node tests/live/prepare.js <scenario> "<new folder>"
   ```

   It prints exactly what to start, what to type and what to answer. Hook calls go to `<folder>/.live/hook-log.jsonl`.

2. Start Claude Code in that folder with NAC loaded from this repository and follow the printed steps:

   ```
   cd "<new folder>"
   claude --plugin-dir "<this plugin folder>"
   ```

3. Exit Claude Code and check:

   ```
   node tests/live/check.js "<new folder>"
   ```

`MISSING` means the session did not produce the evidence; it is never a pass. The check exits 0 only when every row passes, and prints every payload field it saw per event, so the synthetic fixtures can be compared with real ones.

Never answer yes to the global model pointer question in a live test: it writes your real `~/.claude/CLAUDE.md`.

## Scenarios

| Scenario | What it shows | Checks |
|---|---|---|
| `ekip-uyesi` | A named teammate does not think it is the lead. | L1 owner got the lead instructions; L2 no teammate did; L3 teammate answers `LEAD=no`; L4 its inbox command ran; L5 its `SendMessage` reached the mailbox hook; L6 `TaskCompleted` carried `task_subject`; L7 `TeammateIdle` carried `teammate_name`. |
| `kararlar` | Phase 0 asks one question at a time; a decision comes as a question; nothing is pushed. | A1 the first answer is one question, with no spawn and no file written; A2 no license file, and the reply has at least two of Source/Status/Impact plus a recommendation; A3 no `git push` and the local bare remote is unchanged. |
| `kurulum` | `/nac:setup` shows the dry run, waits, asks the global pointer separately, says `/clear`. | B1 dry run, then an owner answer, then apply; B2 the global pointer is not applied after a no; B3 `team/` exists and agent teams are on; B4 the owner is told to run `/clear`; B5 the session after `/clear` got the lead instructions. |
| `devam` | After a restart the lead finds where work stopped (phase 5, T-002 in progress, blocking Q-001, an unread message from the architect, an uncommitted file). | C1 names T-002; C2 names Q-001; C3 names the unread message; C4 spawns nobody. |
| `planlama` | The planner is spawned without a name, so it stays a subagent. | D1 planner spawned; D2 without `name`; D3 no `TeammateIdle` for it; D4 the plan reached the board; D5 still phase 4 and no developer spawned. |
| `ekip-konusmasi` | Two teammates message each other directly and every message is recorded. | E1 architect to security-reviewer `PING-2`; E2 security-reviewer to architect `PONG-2`; E3 architect to the lead `PONG-2`; E4 both went idle as teammates. |

The prompts to paste are in `scenarios.js` (`steps`) and are printed by `prepare.js`. The text checks (A1, A2, C1 to C3) read the lead's own words, so a failure there is worth reading in the transcript before changing NAC.
