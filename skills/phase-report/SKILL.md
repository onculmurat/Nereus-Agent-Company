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
3. Ask the queued questions one at a time (skill `question-protocol`).
4. Ask for approval to start the next phase, naming it. Only on approval run `node "<scripts>/board.js" phase <n>`.
5. Suggest a mailbox cleanup dry run (skill `cleanup`).
