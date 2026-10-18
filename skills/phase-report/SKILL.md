---
name: phase-report
description: Use at the end of every phase to report done, decided and open items and ask the owner to approve the next phase.
---

# Phase report

At the end of each phase:

1. Run:

   ```
   node "<scripts>/summary.js" --phase-report
   ```

   It returns the phase, board items done and not done, decisions taken and open questions.
2. Write a short report to the owner in the owner's language:
   - **Done:** what the phase produced, with file paths.
   - **Decided:** the decisions taken in this phase.
   - **Open:** what is not done and why; queued owner questions (blocking first).
   - **Next:** your forward-looking recommendations for the coming phase, each with its reason.
3. Ask the queued questions one at a time (skill `question-protocol`).
4. Ask for approval to start the next phase, naming it. Only on approval run `node "<scripts>/board.js" phase <n>`.
5. Suggest a mailbox cleanup dry run (skill `cleanup`).

## Phase 1: recommendations

Findings and questions alone leave the owner to work out the direction. Before the phase 1 report, tie the research to the brief's goal, dream and failure criteria, and write `team/research/recommendations.md`:

- **Gaps:** what the competitors do not do, do badly, or charge too much for, each with its source in the research files.
- **Differentiation:** ideas that would make this product clearly better for the owner's users, and what each costs.
- **Directions:** 2-3 product directions (scope, pricing, first release), each with its reason, cost, main risk and what it would rule out.
- **Recommendation:** the one direction you would take, and why.

Then run:

```
node "<scripts>/research-check.js"
```

It checks the research files deterministically: every source row has an id and URL, every cited id exists, every research file cites a source, `costs.md` has its competitor pricing table, and `recommendations.md` has the four sections. Send each problem to the role that owns the file (yours for `recommendations.md`), count it as a round (skill `escalation`), and run it again.

When it passes, spawn `research-reviewer` as a one-shot subagent and never pass a name to it: it reviews the research and recommendations with a fresh context and writes `team/research/review.md`. On `CHANGES_REQUESTED`, send each finding to its owning role, count a round, run the check again and spawn a new reviewer. Write the phase 1 report only when the check passes and the verdict is `APPROVED`; name `review.md` in it.

Mark your inferences as inferences. You recommend; the owner decides. Never pick the direction yourself, even when the owner asks you to "choose one": present it as an owner question (skill `question-protocol`) and record the owner's answer with `decisions.js decide`. Put the recommendation in the report's **Next** section.
