# NAC spike results (2026-10-18)

Claude Code 2.1.302, Windows 11, Node 24.22.0. Probe plugin: `spike/probe-plugin` (logs every hook payload to `<cwd>/spike-log/`). Test projects lived in the OS temp dir under paths containing a space (`nac spike A`, `B`, `C`).

## 1 SendMessage hook

- `PostToolUse` with matcher `SendMessage` fires for every send: from the lead (main session) and from spawned named agents. 6 of 6 sends were logged.
- Run headless (`claude -p`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): no team-creation or team task-list tools were offered, so the lead spawned named agents with the `Agent` tool; `SendMessage` between them and to the lead worked anyway.
- Not yet verified (needs an interactive team session): `TaskCompleted` and `TeammateIdle` payloads. See "Pending".

## 2 Bootstrap

- A plugin installed at user scope and disabled there (`claude plugin disable … --scope user`) is not available in a project: `/nac-probe:probe` is reported as not installed.
- `claude plugin enable <plugin>@<marketplace> --scope project`, run inside the project, writes `.claude/settings.json` → `"enabledPlugins": { "<plugin>@<marketplace>": true }`; the next session loads the plugin's command and hooks.
- Writing the same `enabledPlugins` key by hand has the same effect.

## 3 SessionStart injection

- Output `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}` reaches the model: asked for "the probe word", the session answered `HALCYON`.
- `source` is `startup` for a new session and `resume` for `claude -c`.

## Payload fields

Common: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`.

SessionStart: `source` (`startup` | `resume`; `clear`, `compact` per docs).

PostToolUse / SendMessage:
- recipient: `tool_input.to` — a name (`"alpha"`) or `"main"` for the lead.
- body: `tool_input.message` — a string for normal messages; an object (e.g. `{"type":"shutdown_request","reason":"…"}`) for protocol messages.
- summary: `tool_input.summary` (optional).
- message id: `tool_use_id`.
- sender: `agent_id` and `agent_type` are present only when an agent sends; absent when the lead sends. No sender *name* is given (only the opaque `agent_id`). The recipient's id is in `tool_response.pin.id` with name `tool_response.pin.name`.

TaskCompleted, TeammateIdle: pending.

## Ruling

- `mailbox-mode: hook` — the hook fires for lead and agent sends. Sender name comes from the message header `[thread:<id> from:<role>]`; without a header, a send with no `agent_id` is from `team-lead`, otherwise `unknown`. Recipient `main` maps to `team-lead`. Object (protocol) messages are not recorded.
- `bootstrap: project-enable` — the owner runs `claude plugin enable nac@nereus-agent-company --scope project` once in the project, then `/nac:setup`. Setup still merges the same `enabledPlugins` key (idempotent).

## Pending

One interactive session with agent teams (the owner) to record `TaskCompleted` and `TeammateIdle` payloads and confirm team-tool sends hit the same hook. Until then, `task-completed.js` and `teammate-idle.js` read the fields documented in the Claude Code hooks reference, and their tests use hand-written fixtures marked `synthetic` in the file name.
