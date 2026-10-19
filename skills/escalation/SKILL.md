---
name: escalation
description: Use when a task or thread fails a round - count it on the board and act on the next action (retry, raise model, lead, owner).
---

# Escalation

One round is one attempt plus its review; a reviewer finding counts as a round. Only the lead counts rounds, on the board entry, so nobody relies on memory. The `rounds` field of the board entry is the only round count: hand-off notes, briefs and packs refer to it and never keep a count of their own.

The lead never fixes a role's output itself. Every fix goes back to the role that owns the work; the lead takes a round only when `next.action` is `to-lead`.

```
node "<scripts>/board.js" round <id>
```

It prints `{ entry, next }`. Act on `next.action`:

- `retry`: re-dispatch the same role on the same model with the findings; the owning role fixes.
- `raise-model`: the board entry's model is already raised one tier (haiku, sonnet, opus). Re-dispatch on it. In team mode a teammate's model is fixed at spawn, so close the teammate and respawn the role on the new model with its hand-off note.
- `to-lead`: you take one round yourself, the only action in which you fix anything yourself: read the findings and the hand-off, then fix or re-brief.
- `to-owner`: stop and ask the owner (skill `question-protocol`, blocking). Do not try again without an answer.

Review round cap: `reviewRoundCap` (2 by default) is a hard limit on rounds per task, checked before the ladder. When `board.js round <id>` refuses because the cap is reached, the ladder does not continue: send the open findings and the round history to the `architect` as one approach question (read-only answer), bring the decision to the owner as one question, record it, then `board.js round <id> --approach <decision-id>` (skill `task-loop`, "Review round cap"). The cap applies again after that round.

Thresholds come from `escalation` in the resolved rules (defaults: 2 model rounds, 2 authority rounds, 1 lead round). Every action other than `retry` is recorded in `team/work/escalations/`.

When `next.action` is `to-lead` or `to-owner`, also record a lesson: `node "<scripts>/lessons.js" add --trigger "<the escalation>" --what "<what went wrong>" --rule "<the rule that would have prevented it>" --task <id>`. A lesson is a proposal; the owner decides at the phase report which become NAC rules.

A role may report itself stuck, or a reviewer may find it stuck; both count as a round.
