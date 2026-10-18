---
name: mailbox
description: Use when sending, reading or closing team messages - the file mailbox under team/work/mailbox is the record in every mode.
---

# Mailbox

Every message is one file under `team/work/mailbox/<thread>/`, with id, from, to, thread, date and state (`unread`, `read`, `closed`). Live delivery is `SendMessage`; a hook copies each message into the mailbox as `read`, because `SendMessage` already delivered it. The mailbox keeps one file per message: a repeat with the same id, or a `send` of a message the hook already recorded (same sender, recipient, thread and text within 60 seconds), is not stored again. Two `send` calls with the same text are two messages. A message to `all` appears in every inbox except the sender's.

## Header

Start every message with `[thread:<thread-id> from:<your role>]`. Thread ids are lowercase letters, digits and hyphens, up to 64 characters. Without a valid thread the message goes to `general`.

## Commands

```
node "<scripts>/mailbox.js" inbox --role <role> --mark-read unread messages, oldest first; marks them read
node "<scripts>/mailbox.js" read --file <message file>      show it and mark it read
node "<scripts>/mailbox.js" send --from <role> --to <role> --thread <id> --body=<text>
node "<scripts>/mailbox.js" close-thread --thread <id>      lead only, after the outcome is in decisions.md
```

Write text arguments as `--body=<text>` (with `=`): text that starts with `-` is otherwise read as an option.

## When

- Every role checks its inbox at start, after each step and before finishing, with `--mark-read`. A teammate with unread messages is not allowed to go idle.
- Use `send` only when the hook did not record a live message, or in subagent mode where messages go through the lead.
- When a thread is resolved, the lead records the outcome and then closes the thread. If the thread had an owner question, `decisions.js decide` records it (the question carries the thread). Otherwise run `node "<scripts>/decisions.js" record --thread <id> --outcome=<text>` (add `--title=<t>` for a short title; without `--thread` the thread id is made from the title). Cleanup only removes threads with a recorded outcome.
