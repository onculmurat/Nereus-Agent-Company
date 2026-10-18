#!/usr/bin/env node
// Decision log CLI (lead only): show | open | ask | decide | record.
import { runCli, need, UsageError } from './lib/cli.js';
import { readDecisions, addQuestion, decide, recordOutcome, threadFromText } from './lib/decisions.js';
import { isValidThread } from './lib/mailbox.js';

const usage = `Usage:
  decisions.js show
  decisions.js open                      open questions, blocking first
  decisions.js ask --title <t> --source <s> --status <s> --impact <i> --blocking <yes|no> --thread <id>
  decisions.js decide <Q-id> --answer <text> [--link <path or url>]
  decisions.js record --outcome <text> [--thread <id>] [--title <t>] [--link <path or url>]
                                         an outcome without a question; the thread defaults to one made from the title
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
    case 'record': {
      need(v, 'outcome');
      const thread = v.thread ?? threadFromText(v.title ?? v.outcome);
      if (!isValidThread(thread)) throw new UsageError(`Invalid thread id "${thread}"`);
      return recordOutcome(root, { thread, outcome: v.outcome, title: v.title, link: v.link });
    }
    default:
      throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  }
});
