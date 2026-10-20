import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { buildResumeSummary, buildPhaseReport } from '../scripts/lib/summary.js';
import { addEntry, updateEntry, setPhase } from '../scripts/lib/board.js';
import { addQuestion, decide } from '../scripts/lib/decisions.js';
import { writeMessage } from '../scripts/lib/mailbox.js';

const q = (title, blocking, thread) => ({ title, source: 's', status: 'st', impact: 'i', blocking, thread });

test('empty project shows only the phase', () => {
  assert.equal(buildResumeSummary(makeProject(), { gitStatus: '' }).trim(), 'Phase: 0');
});

test('summary lists in-progress work, unread lead mail and queued questions (blocking first)', () => {
  const root = makeProject();
  setPhase(root, 5);
  addEntry(root, { title: 'API', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(root, 'T-001', { status: 'in-progress' });
  addEntry(root, { title: 'UI', owner: 'frontend-developer', model: 'sonnet' });
  writeMessage(root, { id: '1', from: 'architect', to: 'team-lead', thread: 't', body: 'a' });
  writeMessage(root, { id: '2', from: 'planner', to: 'team-lead', thread: 't', body: 'b' });
  addQuestion(root, q('Colour?', 'no', 'colour'));
  addQuestion(root, q('Which DB?', 'yes', 'db'));
  const s = buildResumeSummary(root, { gitStatus: ' M src/api.js\n' });
  assert.match(s, /Phase: 5/);
  assert.match(s, /T-001: API \(backend-developer, in-progress\)/);
  assert.match(s, /M src\/api\.js/);
  assert.match(s, /T-002: UI \(frontend-developer, todo\)/);
  assert.match(s, /Unread for team-lead: 2/);
  assert.ok(s.indexOf('Which DB?') < s.indexOf('Colour?'));
  assert.match(s, /Q-002: Which DB\? \[blocking\]/);
});

test('CLI prints the summary and the phase report', () => {
  const root = makeProject();
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'summary.js');
  assert.match(execFileSync(process.execPath, [cli, '--project', root], { encoding: 'utf8' }), /Phase: 0/);
  const report = JSON.parse(execFileSync(process.execPath, [cli, '--phase-report', '--project', root], { encoding: 'utf8' }));
  assert.deepEqual(report.done, []);
});

test('phase report splits done and not done', () => {
  const root = makeProject();
  addEntry(root, { title: 'A', owner: 'planner', model: 'sonnet', size: 'S' });
  addEntry(root, { title: 'B', owner: 'planner', model: 'sonnet' });
  updateEntry(root, 'T-001', { status: 'done' });
  addQuestion(root, q('X?', 'no', 'x'));
  decide(root, 'Q-001', { answer: 'yes' });
  addQuestion(root, q('Y?', 'no', 'y'));
  const r = buildPhaseReport(root);
  assert.deepEqual(r.done.map((e) => e.id), ['T-001']);
  assert.deepEqual(r.notDone.map((e) => e.id), ['T-002']);
  assert.deepEqual(r.decided.map((d) => d.id), ['D-001']);
  assert.deepEqual(r.open.map((o) => o.id), ['Q-002']);
});

test('the resume summary points at the latest lead hand-off, not task hand-offs', () => {
  const root = makeProject();
  const dir = path.join(root, 'team', 'work', 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['lead-2026-10-19-0900.md', 'lead-2026-10-19-1430.md', 'T-001.md', 'lead-notes.txt']) fs.writeFileSync(path.join(dir, f), 'x');
  const s = buildResumeSummary(root, { gitStatus: '' });
  assert.match(s, /Lead hand-off: team\/work\/handoffs\/lead-2026-10-19-1430\.md/);
  assert.doesNotMatch(s, /0900/);
  assert.doesNotMatch(buildResumeSummary(makeProject(), { gitStatus: '' }), /Lead hand-off/);
});
