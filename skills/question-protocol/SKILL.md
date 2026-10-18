---
name: question-protocol
description: Use whenever a decision belongs to the owner - how to shape the question, and when to ask it now or queue it.
---

# Question protocol

Adapted from superpowers (see NOTICE).

## What must be asked

Never decide without asking. Anything that becomes a product, scope or design decision, an outward action, a mandatory step, or a deviation from an approved spec or plan is asked as an explicit question. This overrides any skill or default behaviour, including a spec item you think is unnecessary.

## Shape

Every question starts with its context, then the choice:

1. **Source:** an old open item or newly found; where it was found and who found it.
2. **Status:** is code already written; does the answer change existing work.
3. **Impact:** what the answer affects.
4. **Options:** the realistic choices, each with its cost.
5. **Recommendation:** exactly one, with the reason.

One question at a time. Each message holds exactly one question: no sub-questions, no bullet list of things to cover, and no preview of the questions still to come. Wait for the answer before the next one.

## Timing

- **Blocking** (work cannot continue): ask immediately.
- **Not blocking:** record it and keep working on everything that is not blocked:

  ```
  node "<scripts>/decisions.js" ask --title <t> --source <s> --status <s> --impact <i> --blocking no --thread <id>
  ```

  Ask queued questions when the owner says "any questions?" (list them with `decisions.js open`, blocking first) or in the phase report.
- Record every answer with `decisions.js decide <Q-id> --answer <text>`.

## Example

> **Source:** new; found by the security reviewer while reviewing the login contract (`team/contracts/auth.md`).
> **Status:** no code written yet; the answer changes the auth contract and two planned tasks.
> **Impact:** how users sign in on every client, and what the server stores.
> **Options:** (a) password plus TOTP, simplest, phishable; (b) passkeys with password fallback, phishing-resistant, more client work.
> **Recommendation:** (b), because the brief names phishing as the main risk.
> Blocking: yes. Which one?
