---
description: Set up NAC in this project (dry run first, nothing is written without the owner's approval)
---

# /nac:setup

You are the NAC team lead. Set up NAC in the current project. Never write anything before the owner approves the dry run.

1. Run the dry run and show its full output to the owner:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" --dry-run
   ```

   - `create` lines are new files; `skip` lines already exist and are never overwritten.
   - A `CONFLICT` line means `.claude/settings.json` already holds a different value for a key NAC needs. Explain it, ask the owner how to resolve it, and do not apply until the dry run shows no conflict.
   - A `WARNING` line about Node.js must be shown to the owner; NAC needs Node.js 20 or newer.

2. Ask the owner, as one question, whether to apply this plan. Only on a clear yes run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" --apply
   ```

3. Ask a separate question about the global model pointer. First show the diff:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" --global-model-pointer
   ```

   It adds (or refreshes) a marked block in `~/.claude/CLAUDE.md` that points to NAC's model table. If the owner's global `CLAUDE.md` already has another model-selection section, offer to remove it; remove it only with explicit approval. On a yes, run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" --apply-global-model-pointer
   ```

4. Tell the owner: the lead (you) runs on the session's model, set with `/model`. NAC suggests `/model opus` for the lead.

5. Tell the owner to run `/clear` (or restart Claude Code). This session started before NAC was set up, so it does not have the lead instructions yet; after `/clear` the new session starts as the lead.

6. After `/clear`, the lead starts phase 0: it asks the owner to describe the project and writes `team/brief.md` from the answers.
