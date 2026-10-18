# Setup requirements

What NAC needs on the machine that runs Claude Code.

| Requirement | Version / value | Why |
|---|---|---|
| Node.js | Node.js 20 or newer | Hooks and scripts are Node.js (ESM, no dependencies). `/nac:setup` warns when it is older. |
| Claude Code | 2.1.302 or newer (version used to verify hooks and bootstrap) | Plugin, hooks, agent teams. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `"1"` in the project's `.claude/settings.json` `env` | Team mode. `/nac:setup` adds it after your approval. |
| Plugin enabled for the project | `enabledPlugins["nac@nereus-agent-company"] = true` in `.claude/settings.json` | Written by `claude plugin enable nac@nereus-agent-company --scope project`; setup merges the same key. |
