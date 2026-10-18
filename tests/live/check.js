#!/usr/bin/env node
// Live test, step 3: checks what a real agent-teams session recorded. Usage: node check.js <project>
// Exit 0 only when every check passes; missing evidence is never a pass.
import fs from 'node:fs';
import path from 'node:path';
import { teamPaths } from '../../scripts/lib/paths.js';
import { readMessage } from '../../scripts/lib/mailbox.js';

const root = path.resolve(process.argv[2] ?? '.');
const logFile = path.join(teamPaths(root).work, 'hook-log.jsonl');
const log = fs.existsSync(logFile)
  ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
  : [];
const of = (event) => log.filter((r) => r.event === event);
const isTeammate = (p) => Boolean(p.agent_id || p.agent_type);
const gotLead = (r) => (r.excerpt ?? '').startsWith('# NAC lead instructions');

function teammateReplies() {
  const box = teamPaths(root).mailbox;
  if (!fs.existsSync(box)) return [];
  return fs.readdirSync(box, { withFileTypes: true }).filter((d) => d.isDirectory())
    .flatMap((d) => fs.readdirSync(path.join(box, d.name)).filter((f) => f.endsWith('.md')).map((f) => readMessage(path.join(box, d.name, f))))
    .filter((m) => m.data.to === 'team-lead' && m.data.from !== 'team-lead' && /LEAD=/i.test(m.body));
}

const rows = [];
const row = (id, what, status, note = '') => rows.push({ id, what, status, note });

const starts = of('SessionStart');
const leadStarts = starts.filter((r) => !isTeammate(r.payload ?? {}) && gotLead(r));
row('L1', 'Owner session got the lead instructions', leadStarts.length ? 'PASS' : 'MISSING', `${leadStarts.length} session(s)`);

const mateStarts = starts.filter((r) => isTeammate(r.payload ?? {}));
const startupLeadSessions = new Set(leadStarts.filter((r) => r.payload?.source === 'startup').map((r) => r.payload?.session_id));
if (mateStarts.some(gotLead)) row('L2', 'No teammate session got the lead instructions', 'FAIL', 'a marked teammate session received them');
else if (startupLeadSessions.size > 1) row('L2', 'No teammate session got the lead instructions', 'FAIL', `${startupLeadSessions.size} startup sessions received them (a teammate without agent_id?)`);
else row('L2', 'No teammate session got the lead instructions', 'PASS', `${mateStarts.length} teammate SessionStart call(s)`);

const replies = teammateReplies();
const answer = (key) => {
  for (const m of replies) {
    const v = new RegExp(`${key}=(\\w+)`, 'i').exec(m.body);
    if (v) return { value: v[1].toLowerCase(), line: m.body.trim().split('\n')[0] };
  }
  return null;
};
const lead = answer('LEAD');
row('L3', 'Teammate says it is not the lead', !lead ? 'MISSING' : lead.value === 'no' ? 'PASS' : 'FAIL', lead?.line ?? 'no reply with LEAD= in the mailbox');
const inbox = answer('INBOX');
row('L4', 'Teammate could run its inbox command', !inbox ? 'MISSING' : inbox.value === 'ok' ? 'PASS' : 'FAIL', inbox?.line ?? '');

const sends = of('PostToolUse').filter((r) => r.payload?.tool_name === 'SendMessage' && isTeammate(r.payload));
row('L5', 'Teammate SendMessage reached the mailbox hook', sends.length ? 'PASS' : 'MISSING', `${sends.length} call(s)`);

const done = of('TaskCompleted').filter((r) => typeof r.payload?.task_subject === 'string');
row('L6', 'TaskCompleted payload carries task_subject', done.length ? 'PASS' : 'MISSING', done.map((r) => `${r.payload.task_subject} -> ${r.outcome}`).join('; '));

const idle = of('TeammateIdle').filter((r) => typeof r.payload?.teammate_name === 'string');
row('L7', 'TeammateIdle payload carries teammate_name', idle.length ? 'PASS' : 'MISSING', idle.map((r) => `${r.payload.teammate_name} -> ${r.outcome}`).join('; '));

const width = Math.max(...rows.map((r) => r.what.length));
process.stdout.write(`${rows.map((r) => `${r.id}  ${r.what.padEnd(width)}  ${r.status.padEnd(7)}  ${r.note}`).join('\n')}\n`);
const fields = [...new Set(log.map((r) => r.event))].map((e) => `${e}: ${[...new Set(of(e).flatMap((r) => Object.keys(r.payload ?? {})))].sort().join(', ')}`);
if (fields.length) process.stdout.write(`\nPayload fields seen:\n${fields.map((f) => `  ${f}`).join('\n')}\n`);
process.exitCode = rows.every((r) => r.status === 'PASS') ? 0 : 1;
