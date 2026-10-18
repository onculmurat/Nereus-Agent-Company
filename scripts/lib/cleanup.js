// Mailbox cleanup: a thread is archived (or deleted) only when every message is closed, the thread
// has a decision in decisions.md, and its newest message is older than closedThreadMaxAgeDays.
import fs from 'node:fs';
import path from 'node:path';
import { teamPaths } from './paths.js';
import { readMessage } from './mailbox.js';
import { isThreadDecided } from './decisions.js';

export function planCleanup(root, config, now = new Date()) {
  const { mailbox } = teamPaths(root);
  if (!fs.existsSync(mailbox)) return [];
  const { closedThreadMaxAgeDays: maxDays, mode } = config.cleanup;
  const out = [];
  for (const d of fs.readdirSync(mailbox, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const thread = d.name;
    const dir = path.join(mailbox, thread);
    const msgs = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => readMessage(path.join(dir, f)));
    const keep = (reason) => out.push({ thread, action: 'keep', reason });
    if (msgs.some((m) => m.data.state !== 'closed')) { keep('has messages that are not closed'); continue; }
    if (!isThreadDecided(root, thread)) { keep('not in decisions.md'); continue; }
    const newest = Math.max(...msgs.map((m) => Date.parse(m.data.date)));
    const ageDays = (now.getTime() - newest) / 86400000;
    if (!(ageDays > maxDays)) { keep(`newest message is ${Math.floor(ageDays)} day(s) old`); continue; }
    out.push({ thread, action: mode, reason: `closed, decided, ${Math.floor(ageDays)} day(s) old` });
  }
  return out;
}

export function applyCleanup(root, plan) {
  const { mailbox, archive } = teamPaths(root);
  for (const { thread, action } of plan) {
    const dir = path.join(mailbox, thread);
    if (action === 'delete') fs.rmSync(dir, { recursive: true, force: true });
    if (action !== 'archive') continue;
    fs.mkdirSync(archive, { recursive: true });
    let target = path.join(archive, thread);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(archive, `${thread}-${n}`);
    fs.renameSync(dir, target);
  }
}
