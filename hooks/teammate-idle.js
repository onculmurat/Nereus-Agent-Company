#!/usr/bin/env node
// TeammateIdle: a teammate with unread mail is sent back to read it instead of going idle.
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { listInbox } from '../scripts/lib/mailbox.js';

runHook(async (payload, root) => {
  const name = payload.teammate_name;
  if (typeof name !== 'string' || !name) return;
  const n = listInbox(root, name).length;
  if (!n) return;
  const cli = path.join(pluginRoot, 'scripts', 'mailbox.js');
  return { block: `You have ${n} unread message(s). Run: node "${cli}" inbox --role ${name} --mark-read` };
});
