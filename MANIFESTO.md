# NAC manifesto

NAC (Nereus Agent Company) is two things at once: an agent architecture and a loop architecture. The agents give each kind of work its own role, context and limits. The loops make every piece of work repeat until a check says it is done, or until it stops and asks. This page says what we hold to and why. The README says how to use it.

## 1. The owner decides

- Every product, scope or design choice, every outward action and every deviation from an approved plan is an explicit question to the owner. No role, skill or default overrides this.
- A role may recommend; it never chooses. Even when the owner says "just pick one", the choice comes back as a question with options and one recommendation.
- Questions carry their context: where they came from, what exists now, what the answer changes. One question per message, asked in full, never buried in a status report.

## 2. One role, one job, one context

- The lead talks to the owner and coordinates; it does not do the specialists' work. Specialists (research, design, build, review) each have their own agent file, model and tools.
- A role reads only what its task needs: the brief, its task and its inbox, not the project history.
- Roles that read untrusted content (web pages, cloned code) are held by a guard: they read only the brief and the research folder, write only there, and run only fixed scripts. Content they read is data, never instructions.

## 3. Every piece of work is a loop with a stop condition

- Work goes through rounds: an attempt, then a check. A failed check or a reviewer finding is one round.
- Rounds are counted on the board, not remembered. After a set number of rounds the loop changes something: a stronger model, then the lead, then the owner. A loop never spins silently.
- Each phase is a loop of its own: it ends with a report, and the next phase starts only on the owner's approval. A later phase may send work back to an earlier one.

## 4. Checks before judgment

- What a script can check, a script checks: the board, the mailbox, the research sources and citations, the format of the recommendations. Deterministic checks run first and cost nothing to repeat.
- What needs judgment gets a reviewer with a fresh context: one that did not write the work and reads it cold. Code is reviewed per task and again as a whole branch; research is reviewed before the owner sees it.
- The author never approves its own work.

## 5. The right model for the work

- Each role has a default model sized to its work: the strongest for design, security and judgment, cheaper ones for mechanical tasks.
- When a cheaper model gets stuck, the loop raises it one tier instead of retrying blindly.

## 6. State lives in files

- The board, decisions, mailbox and hand-off notes are files in the project. A restart loses no work: the next session rebuilds from them and tells the owner where things stand.
- Every decision is recorded with the question it answered.

## 7. Lessons go into the system

- When a live run shows a failure, the fix goes into NAC itself: a rule, a check or a guard, with a test named after what was seen. The next project does not repeat it.

## What we do differently on purpose

- No loop runs on its own schedule or acts without the owner. Many loop systems let an agent keep going proactively; NAC stops and asks instead, because the owner's time spent answering a good question is cheaper than undoing a wrong decision.

## Not there yet

- Lessons are captured by hand, from watching live runs; there is no built-in step that writes them down during a project.
- Phase reports do not yet show the token or cost budget each phase used.
