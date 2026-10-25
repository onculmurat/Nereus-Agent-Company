---
name: escalation
description: Use when a task or thread fails a round - count it on the board and act on the next action (retry, raise model, lead, owner).
---

# Escalation

One round is one attempt plus its review; a reviewer finding counts as a round. Only the lead counts rounds, on the board entry, so nobody relies on memory. The `rounds` field of the board entry is the only round count: hand-off notes, briefs and packs refer to it and never keep a count of their own.

The lead never fixes a role's output itself. Every fix goes back to the role that owns the work. `to-lead` means you decide, re-plan or escalate (architect, owner); it never means you implement. Once the decision exists, the implementation round goes to the task's owning role with a delta pack (`--paths` set to the task's code paths), carrying the decision id and any probe findings as notes. You edit only team files (board, briefs, decisions, hand-offs) and one-line text fixes in docs, never source or test code.

```
node "<scripts>/board.js" round <id> --reason <gate|review|stuck>
```

`--reason` is required: `gate` for a red test gate, `review` for a blocking review finding, `stuck` for a role that reports itself stuck. A red that is red on the task's base too is not a round: `--reason base --finding <F-id>` records it and leaves the round count and the model unchanged (g66). A dispatch that stopped at its turn budget is not a round and `--reason budget` is refused (g46): re-dispatch the same role on the same model with a fresh pack for the remainder, or split the task. A raised model therefore always follows a real failure, never a long task.

It prints `{ entry, next }`. Act on `next.action`:

- `retry`: re-dispatch the same role on the same model with the findings; the owning role fixes.
- `raise-model`: the board entry's model is already raised one tier (haiku, sonnet, opus). Re-dispatch on it. In team mode a teammate's model is fixed at spawn, so close the teammate and respawn the role on the new model with its hand-off note.
- `to-lead`: you decide, re-plan or escalate: read the findings and the hand-off, then re-brief, split the task, or take the question to the architect and the owner. When the decision exists (record its id with `decisions.js`), dispatch the owning role with a delta pack and the decision id in the notes; you do not write the fix.
- `to-owner`: stop and ask the owner (skill `question-protocol`, blocking). Do not try again without an answer.

Review round cap: `reviewRoundCap` (2 by default) is a hard limit on rounds per task, checked before the ladder. When `board.js round <id>` refuses because the cap is reached, the ladder does not continue: send the open findings and the round history to the `architect` as one approach question (read-only answer), bring the decision to the owner as one question, record it, then `board.js round <id> --approach <decision-id>` (skill `task-loop`, "Review round cap"). The cap applies again after that round.

Thresholds come from `escalation` in the resolved rules (defaults: 2 model rounds, 2 authority rounds, 1 lead round). Every action other than `retry` is recorded in `team/work/escalations/`.

When `next.action` is `to-lead` or `to-owner`, also record a lesson: `node "<scripts>/lessons.js" add --trigger "<the escalation>" --what "<what went wrong>" --rule "<the rule that would have prevented it>" --task <id>`. A lesson is a proposal; the owner decides at the phase report which become NAC rules.

A role may report itself stuck, or a reviewer may find it stuck; both count as a round.
