---
name: mailbox
description: Use when sending, reading or closing team messages - the file mailbox under team/work/mailbox is the record in every mode.
---

# Mailbox

Every message is one file under `team/work/mailbox/<thread>/`, with id, from, to, thread, date and state (`unread`, `read`, `closed`). Live delivery is `SendMessage`; a hook copies each message into the mailbox, and a message seen twice (live and on disk) is handled once by its id.

## Header

Start every message with `[thread:<thread-id> from:<your role>]`. Thread ids are lowercase letters, digits and hyphens, up to 64 characters. Without a valid thread the message goes to `general`.

## Commands

```
node "<scripts>/mailbox.js" inbox --role <role>             unread messages, oldest first
node "<scripts>/mailbox.js" read --file <message file>      show it and mark it read
node "<scripts>/mailbox.js" send --from <role> --to <role> --thread <id> --body <text>
node "<scripts>/mailbox.js" close-thread --thread <id>      lead only, after the outcome is in decisions.md
```

## When

- Every role checks its inbox at start, after each step and before finishing.
- Use `send` only when the hook did not record a live message, or in subagent mode where messages go through the lead.
- When a thread is resolved, the lead records the outcome with `decisions.js decide` (with `--link` or the question's thread) and then closes the thread.
