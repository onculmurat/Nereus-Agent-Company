---
description: Ask the owner the queued NAC questions, blocking first
---

1. List the open questions, blocking first:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/decisions.js" open
   ```

2. If there are none, say so in one line.
3. Otherwise ask them as the skill `question-protocol` says: every question in full, never by its id, in its full shape (Source, Status, Impact, options, one recommendation). Blocking questions are asked at once. Ready non-blocking questions are batched, up to 4 per `AskUserQuestion` call, then the next call after the answers. Wait for the answers.
4. Record each answer:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/decisions.js" decide <Q-id> --answer <text>
   ```

   and pass it to the role that asked.
