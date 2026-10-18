#!/usr/bin/env node
// Mailbox CLI: send | inbox | read | close-thread.
import fs from 'node:fs';
import { runCli, need, UsageError } from './lib/cli.js';
import { writeMessage, listInbox, readMessage, setState, closeThread } from './lib/mailbox.js';

const usage = `Usage:
  mailbox.js send --from <role> --to <role> [--thread <id>] (--body <text> | --body-file <file>)
  mailbox.js inbox --role <role> [--state unread|read|closed]
  mailbox.js read --file <message file>
  mailbox.js close-thread --thread <id>
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, {
  from: { type: 'string' }, to: { type: 'string' }, thread: { type: 'string' },
  body: { type: 'string' }, 'body-file': { type: 'string' },
  role: { type: 'string' }, state: { type: 'string' }, file: { type: 'string' },
}, ({ values: v, positionals: [cmd], root }) => {
  switch (cmd) {
    case 'send': {
      need(v, 'from', 'to');
      const body = v.body ?? (v['body-file'] && fs.readFileSync(v['body-file'], 'utf8'));
      if (body === undefined) throw new UsageError('Missing --body or --body-file');
      return writeMessage(root, { from: v.from, to: v.to, thread: v.thread, body });
    }
    case 'inbox':
      need(v, 'role');
      return listInbox(root, v.role, { state: v.state ?? 'unread' });
    case 'read':
      need(v, 'file');
      setState(v.file, 'read');
      return readMessage(v.file);
    case 'close-thread':
      need(v, 'thread');
      return { closed: closeThread(root, v.thread) };
    default:
      throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  }
});
