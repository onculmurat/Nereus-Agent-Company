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

Every owner question goes through `decisions.js ask` with `--options` (at least 2) and `--recommend`; the `AskUserQuestion` call copies them.

A question that proposes a new task (for example a hardening task) states the class of the finding behind it, `--finding-class observed|known|theoretical`. `decisions.js ask` refuses to recommend "now" when that class is `theoretical` (it needs, for example, an attacker-planted file in the data dir): recommend the phase end instead. Proportionality covers proposals, not only fix rounds.

When the owner defers a question on purpose ("ask me when we have a sale"), park it: `decisions.js park <Q-id> --until <text>`. A parked question stays in the log, but it is not pending: compaction does not wait for it and the hand-off lists it under "Parked owner questions" (`unpark` reopens it). Never close a question just to unblock compaction.

A "go" question for an irreversible or spending step carries `--irreversible --task <id>`: `decisions.js ask` refuses it unless the task brief has a `Go-path test: <command>` line, the command exits 0 when `ask` runs it in the project, and the gate is green (g23). A file name instead of a command is refused. Dry runs never exercise the go path.

Register before you send (g26): every question to the owner or the owner proxy is recorded with `ask` first, and the message carries the Q-id that `ask` printed, never one you made up. A D-id you report comes from the output of `decide` (or `record`), read after the call: `decide` on an unregistered Q-id throws and writes nothing. The Stop hook sends the lead back once when its message names a Q-id or D-id that team/decisions.md does not hold.

Never ask the owner in plain chat ("yes / no?") without going through `decisions.js ask`: a chat question skips the options and recommendation checks. A Stop hook checks the lead's final message: it ends with a question and has no recommendation, the lead is sent back once to ask it properly. The same hook sends the lead back once when the final message holds a status report section together with a question, or names an open Q-id without its own question block (Source, Status, Impact, options, recommendation): report first, then the question alone.

One question at a time. Each message holds exactly one question: no sub-questions, no bullet list of things to cover, and no preview of the questions still to come. A question asks about one thing: never join two questions with "and". Wait for the answer before the next one.

A question gets its own message: no status report, summary or news in it; send those in a message before it. Ask a question in full every time, re-asks included: never refer to it only by its id ("waiting for your answer to Q-010"), so the owner never has to search earlier messages for it. When several questions are queued, ask them one after another, each after the previous answer, except as allowed under Batching below.

## Owner proxy

When team/config.json has `ownerProxy` (the owner sets it with `setup.js --proxy <session>`, g29), the session start names the proxy session. Owner questions then go to that session by SendMessage instead of `AskUserQuestion`, in the same shape and after the same `decisions.js ask`; its answer is the owner's decision. Push, merge into the main branch, deploy, publish and deleting the owner's data still go to the owner. A proxy in chat only (no `ownerProxy`) is not a proxy: ask the owner.

## Timing

- **Blocking** (work cannot continue): ask immediately.
- **Not blocking:** record it deferred and keep working on everything that is not blocked:

  ```
  node "<scripts>/decisions.js" ask --title <t> --source <s> --status <s> --impact <i> --blocking no --thread <id> --defer --task <id> --options "a|b" --recommend a
  ```

  At task end (and when the owner says "any questions?" or in the phase report) run `node "<scripts>/decisions.js" flush [--task <id>]`: it prints the deferred questions as groups of at most 4, each group shaped for one `AskUserQuestion` call, and marks them open. `board.js update <id> --status done` refuses while the task still has deferred questions.
- Record every answer with `decisions.js decide <Q-id> --answer <text>`.

## Batching

Non-blocking or low-impact questions that are ready at the same time go in one `AskUserQuestion` call, up to 4 questions (the groups `flush` prints). Each of them keeps the full shape: Source, Status and Impact in its text, the realistic options with their cost, and one recommendation. More than 4 ready questions go in further calls of up to 4, one call after the previous answers. Blocking questions are still asked at once, and the phase 0 interview stays one question per message. The owner still answers every question; nothing is decided for them, and an unanswered question stays open in `decisions.js`.

## Manual steps for the owner

Before you ask the owner to do something by hand, try the automated path: scripts, CLI, launching the program, capturing output to files. Ask the owner only for what truly needs a human (keystrokes in a GUI or terminal, visual judgement, credentials), and ask for it as one exact minimal action: the one command to type, or the one thing to look at and what to look for. A request for several steps at once is split or scripted first.

## Example

> **Source:** new; found by the security reviewer while reviewing the login contract (`team/contracts/auth.md`).
> **Status:** no code written yet; the answer changes the auth contract and two planned tasks.
> **Impact:** how users sign in on every client, and what the server stores.
> **Options:** (a) password plus TOTP, simplest, phishable; (b) passkeys with password fallback, phishing-resistant, more client work.
> **Recommendation:** (b), because the brief names phishing as the main risk.
> Blocking: yes. Which one?
