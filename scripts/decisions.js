#!/usr/bin/env node
// Decision log CLI (lead only): show | open | ask | decide | record.
import { runCli, need, UsageError } from './lib/cli.js';
import { readDecisions, addQuestion, decide, recordOutcome } from './lib/decisions.js';
import { isValidThread } from './lib/mailbox.js';

const usage = `Usage:
  decisions.js show
  decisions.js open                      open questions, blocking first
  decisions.js ask --title <t> --source <s> --status <s> --impact <i> --blocking <yes|no> --thread <id>
  decisions.js decide <Q-id> --answer <text> [--link <path or url>]
  decisions.js record --thread <id> --outcome <text> [--link <path or url>]   a thread's outcome without a question
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, {
  title: { type: 'string' }, source: { type: 'string' }, status: { type: 'string' }, impact: { type: 'string' },
  blocking: { type: 'string' }, thread: { type: 'string' }, answer: { type: 'string' }, link: { type: 'string' },
  outcome: { type: 'string' },
}, ({ values: v, positionals: [cmd, id], root }) => {
  switch (cmd) {
    case 'show':
      return readDecisions(root);
    case 'open':
      return readDecisions(root).open.sort((a, b) => (a.blocking === 'yes' ? 0 : 1) - (b.blocking === 'yes' ? 0 : 1));
    case 'ask':
      need(v, 'title', 'source', 'status', 'impact', 'blocking', 'thread');
      if (!['yes', 'no'].includes(v.blocking)) throw new UsageError('--blocking must be yes or no');
      return addQuestion(root, v);
    case 'decide':
      if (!id) throw new UsageError('Missing question id');
      need(v, 'answer');
      return decide(root, id, { answer: v.answer, link: v.link });
    case 'record':
      need(v, 'thread', 'outcome');
      if (!isValidThread(v.thread)) throw new UsageError(`Invalid thread id "${v.thread}"`);
      return recordOutcome(root, { thread: v.thread, outcome: v.outcome, link: v.link });
    default:
      throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  }
});
