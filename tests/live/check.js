#!/usr/bin/env node
// Live test, step 3: checks what a real session recorded for the project's scenario.
// Usage: node check.js <project>. Exit 0 only when every check passes; missing evidence is never a pass.
import fs from 'node:fs';
import path from 'node:path';
import { scenarios } from './scenarios.js';
import { readTranscript } from './transcript.js';

const root = path.resolve(process.argv[2] ?? '.');
const live = path.join(root, '.live');
const name = fs.existsSync(path.join(live, 'scenario')) ? fs.readFileSync(path.join(live, 'scenario'), 'utf8').trim() : '';
const scenario = scenarios[name];
if (!scenario) {
  process.stderr.write(`${root} was not made by prepare.js (no known scenario in .live/scenario).\n`);
  process.exit(1);
}

const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const log = readLines(path.join(live, 'hook-log.jsonl')).map((r) => ({ ...r, payload: r.payload ?? {} }));
const of = (event) => log.filter((r) => r.event === event);
const isTeammate = (p) => Boolean(p.agent_id || p.agent_type);
const gotLead = (r) => (r.excerpt ?? '').startsWith('# NAC lead instructions');

// The owner's sessions (one more after each /clear), in the order they started.
const transcripts = [...new Set(of('SessionStart').filter((r) => !isTeammate(r.payload)).map((r) => r.payload.transcript_path).filter(Boolean))];
const entries = transcripts.flatMap(readTranscript);
const statePath = path.join(live, 'state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};

const rows = scenario.checks({ root, state, log, of, isTeammate, gotLead, entries }).map(([id, what, status, note]) => ({ id, what, status, note }));
const width = Math.max(...rows.map((r) => r.what.length));
process.stdout.write(`Scenario ${name}: ${scenario.about}\n\n`);
process.stdout.write(`${rows.map((r) => `${r.id}  ${r.what.padEnd(width)}  ${r.status.padEnd(7)}  ${r.note}`).join('\n')}\n`);
const fields = [...new Set(log.map((r) => r.event))].map((e) => `${e}: ${[...new Set(of(e).flatMap((r) => Object.keys(r.payload)))].sort().join(', ')}`);
if (fields.length) process.stdout.write(`\nPayload fields seen:\n${fields.map((f) => `  ${f}`).join('\n')}\n`);
process.stdout.write(`\n${transcripts.length} owner transcript(s), ${entries.length} entries read.\n`);
process.exitCode = rows.every((r) => r.status === 'PASS') ? 0 : 1;
