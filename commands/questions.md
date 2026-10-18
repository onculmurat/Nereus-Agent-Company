---
description: Ask the owner the queued NAC questions, blocking first, one at a time
---

1. List the open questions, blocking first:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/decisions.js" open
   ```

2. If there are none, say so in one line.
3. Otherwise ask them one at a time, each in the shape of the skill `question-protocol` (Source, Status, Impact, options, one recommendation). Wait for each answer.
4. Record each answer:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/decisions.js" decide <Q-id> --answer <text>
   ```

   and pass it to the role that asked.
