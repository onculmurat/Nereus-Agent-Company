---
name: escalation
description: Use when a task or thread fails a round - count it on the board and act on the next action (retry, raise model, lead, owner).
---

# Escalation

One round is one attempt plus its review; a reviewer finding counts as a round. Only the lead counts rounds, on the board entry, so nobody relies on memory.

```
node "<scripts>/board.js" round <id>
```

It prints `{ entry, next }`. Act on `next.action`:

- `retry`: re-dispatch the same role on the same model with the findings.
- `raise-model`: the board entry's model is already raised one tier (haiku, sonnet, opus). Re-dispatch on it. In team mode a teammate's model is fixed at spawn, so close the teammate and respawn the role on the new model with its hand-off note.
- `to-lead`: you take one round yourself: read the findings and the hand-off, then fix or re-brief.
- `to-owner`: stop and ask the owner (skill `question-protocol`, blocking). Do not try again without an answer.

Thresholds come from `escalation` in the resolved rules (defaults: 2 model rounds, 2 authority rounds, 1 lead round). Every action other than `retry` is recorded in `team/work/escalations/`.

A role may report itself stuck, or a reviewer may find it stuck; both count as a round.
