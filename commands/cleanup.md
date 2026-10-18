---
description: Archive or delete old closed NAC mailbox threads (dry run first, applies only on approval)
---

1. Run the dry run and show the result:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup.js" --dry-run
   ```

2. Ask the owner whether to apply it. Only on a clear yes run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup.js" --apply
   ```
