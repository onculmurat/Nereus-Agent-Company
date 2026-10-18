# Live test: a real agent-teams session

The unit tests feed the hooks recorded or synthetic payloads. This test runs NAC in a real interactive Claude Code session with agent teams on, and checks what actually happened. `claude -p` cannot run it: headless mode has no team tools.

## 1. Prepare

```
node tests/live/prepare.js "<new empty folder>"
```

This builds a NAC project in a new folder (it refuses an existing one), with board entry `T-001: Live check` and hook recording on: every hook call is appended to `team/work/hook-log.jsonl`.

## 2. Run the session

```
cd "<new empty folder>"
claude --plugin-dir "<this plugin folder>"
```

Paste this prompt and let it run. Approve the tool calls it asks for.

```
Live check. Spawn one named teammate from the agent type architect, named architect, and give it the native team task "T-001: Live check". Tell it only this: "Run the inbox command from your agent instructions. Then send the lead one message in thread live-check, one line: ROLE=<your role> LEAD=<yes if you are the team lead of this team, otherwise no> INBOX=<ok if the inbox command ran, failed otherwise>. Then mark your task completed and stop." Do not tell it whether it is the lead. When its message arrives, answer "done" and stop.
```

When the lead answers "done", exit Claude Code.

## 3. Check

```
node tests/live/check.js "<new empty folder>"
```

| Check | Passes when |
|---|---|
| L1 | The owner session received the lead instructions. |
| L2 | No teammate session received the lead instructions (also fails if two startup sessions received them, which means a teammate looked like the owner). |
| L3 | The teammate answered `LEAD=no`. |
| L4 | The teammate ran its inbox command (`${CLAUDE_PLUGIN_ROOT}` resolved in its instructions). |
| L5 | The mailbox hook saw a `SendMessage` from the teammate. |
| L6 | `TaskCompleted` fired with `task_subject`. The board still says `todo`, so the hook should block (`-> block`). |
| L7 | `TeammateIdle` fired with `teammate_name`. |

`MISSING` means the session did not produce the evidence; it is never a pass. The check also prints every payload field it saw per event, so the synthetic fixtures can be replaced with real ones.
