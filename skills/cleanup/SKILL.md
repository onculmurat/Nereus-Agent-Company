---
name: cleanup
description: Use weekly or at phase end to archive or delete closed mailbox threads whose outcome is already in decisions.md.
---

# Cleanup

Nothing is removed unless its outcome is in `team/decisions.md`. A thread qualifies only when every message is closed, the thread has a decision, and its newest message is older than `cleanup.closedThreadMaxAgeDays`. `cleanup.mode` is `archive` (moved to `team/work/archive/`) or `delete`.

1. Dry run (the `assistant` role may run it and report):

   ```
   node "<scripts>/cleanup.js" --dry-run
   ```

2. Show the owner the threads that would be archived or deleted, and why the others are kept.
3. Only on the owner's approval, apply:

   ```
   node "<scripts>/cleanup.js" --apply
   ```
