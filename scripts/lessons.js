#!/usr/bin/env node
// Lessons CLI (lead only): add | show.
import { runCli, need, UsageError } from './lib/cli.js';
import { addLesson, readLessons } from './lib/lessons.js';

const usage = `Usage:
  lessons.js add --trigger <text> --what <text> --rule <text> [--task <id>]
                                         appends to team/lessons.md and to ~/.claude/nac/lessons.md (this machine only, never sent anywhere)
  lessons.js show [--since <YYYY-MM-DD>] [--shared]
                                         lessons of this project (--shared: of every project on this machine)
  A lesson is a proposal; the owner decides which ones become NAC rules.
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, { trigger: { type: 'string' }, what: { type: 'string' }, rule: { type: 'string' }, task: { type: 'string' }, since: { type: 'string' }, shared: { type: 'boolean' } },
  ({ values: v, positionals: [cmd], root }) => {
    switch (cmd) {
      case 'add':
        need(v, 'trigger', 'what', 'rule');
        return addLesson(root, v);
      case 'show':
        return readLessons(root, { since: v.since, shared: v.shared });
      default:
        throw new UsageError(`Unknown command "${cmd ?? ''}"`);
    }
  });
