#!/usr/bin/env node
// Decision log CLI (lead only): show | open | ask | decide.
import { runCli, need, UsageError } from './lib/cli.js';
import { readDecisions, addQuestion, decide } from './lib/decisions.js';

const usage = `Usage:
  decisions.js show
  decisions.js open                      open questions, blocking first
  decisions.js ask --title <t> --source <s> --status <s> --impact <i> --blocking <yes|no> --thread <id>
  decisions.js decide <Q-id> --answer <text> [--link <path or url>]
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, {
  title: { type: 'string' }, source: { type: 'string' }, status: { type: 'string' }, impact: { type: 'string' },
  blocking: { type: 'string' }, thread: { type: 'string' }, answer: { type: 'string' }, link: { type: 'string' },
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
    default:
      throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  }
});
