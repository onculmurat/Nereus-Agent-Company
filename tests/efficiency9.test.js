// Batch 9: hardening loop, findings threshold, proportionality, security auto-tag, pack size, guard block, owner questions, source drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const cli = (script, root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const find = (root, ...a) => cli('findings.js', root, ...a);
const add = (root, text, o = {}) => find(root, 'add', '--module', o.module ?? 'auth', '--file', 'src/a.js', '--line', '3',
  '--severity', o.severity ?? 'hardening', '--class', o.cls ?? 'observed', '--task', 'T-001', '--text', text, ...(o.extra ?? []));
const withBatch = (root, n) => fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ findingsBatch: n }));

// ---- A2: findings threshold counting ----

test('A2 minor findings do not count toward the hardening threshold', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one', { severity: 'minor' });
  const r = add(root, 'two', { severity: 'minor' }).out;
  assert.equal(r.open, 2);
  assert.equal(r.counted, 0);
  assert.equal(r.hardeningDue, false);
});

test('A2 migrated findings do not count; they stay in the ledger', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one', { extra: ['--migrated'] });
  const r = add(root, 'two', { extra: ['--migrated'] }).out;
  assert.equal(r.counted, 0);
  assert.equal(r.hardeningDue, false);
  assert.equal(find(root, 'list', '--open').out.length, 2);
});

test('A2 findings from a hardening task do not count (--origin hardening)', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one', { extra: ['--origin', 'hardening'] });
  const r = add(root, 'two', { extra: ['--origin', 'hardening'] }).out;
  assert.equal(r.counted, 0);
  assert.equal(r.hardeningDue, false);
  assert.equal(find(root, 'list').out[0].origin, 'hardening');
});

test('A2 counted findings (hardening and blocker, not migrated) still trip the threshold', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one');
  const r = add(root, 'two', { severity: 'blocker' }).out;
  assert.equal(r.counted, 2);
  assert.equal(r.hardeningDue, true);
});

test('A2 --origin accepts only hardening', () => {
  const root = makeProject();
  assert.equal(add(root, 'x', { extra: ['--origin', 'other'] }).status, 1);
});

test('A2 the phase gate still lists ALL deferred findings (minor, migrated, hardening-origin included)', () => {
  const root = makeProject();
  add(root, 'm', { severity: 'minor' });
  add(root, 'g', { extra: ['--migrated'] });
  add(root, 'h', { extra: ['--origin', 'hardening'] });
  const r = cli('board.js', root, 'phase', '4');
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.deferredFindings.map((f) => f.id), ['F-001', 'F-002', 'F-003']);
});

// ---- A1: hardening loop ----

import { readBoard } from '../scripts/lib/board.js';
import { teamPaths } from '../scripts/lib/paths.js';

const board = (root, ...a) => cli('board.js', root, ...a);
const addHard = (root, module, ...extra) => board(root, 'add', '--title', `Harden ${module}`, '--owner', 'backend-developer', '--model', 'sonnet', '--module', module, '--hardening', 'yes', ...extra);

test('A1 a hardening task is stored with its phase', () => {
  const root = makeProject();
  const r = addHard(root, 'auth');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.hardening, 'yes');
  assert.equal(readBoard(root).entries[0].hardening, 'yes');
});

test('A1 --hardening needs a module', () => {
  const root = makeProject();
  const r = board(root, 'add', '--title', 't', '--owner', 'backend-developer', '--model', 'sonnet', '--hardening', 'yes');
  assert.equal(r.status, 1);
  assert.match(r.err, /--module/);
});

test('A1 a second hardening task for the same module in the same phase is refused without a recorded decision', () => {
  const root = makeProject();
  assert.equal(addHard(root, 'auth').status, 0);
  const second = addHard(root, 'auth');
  assert.equal(second.status, 1);
  assert.match(second.err, /--decision D-xxx/);
  assert.equal(addHard(root, 'db').status, 0, 'another module is fine');
  const bad = addHard(root, 'auth', '--decision', 'D-001');
  assert.equal(bad.status, 1);
  assert.match(bad.err, /no decision/i);
});

test('A1 with a recorded decision the second hardening task is allowed; a new phase resets the limit', () => {
  const root = makeProject();
  addHard(root, 'auth');
  const d = cli('decisions.js', root, 'record', '--outcome', 'Second hardening for auth approved');
  assert.equal(d.status, 0, d.err);
  const ok = addHard(root, 'auth', '--decision', d.out.id);
  assert.equal(ok.status, 0, ok.err);
  assert.equal(ok.out.hdecision, d.out.id);
  assert.equal(board(root, 'phase', '5').status, 0);
  assert.equal(addHard(root, 'auth').status, 0, 'new phase: first hardening of the module again');
});

test('A1 the pack of a hardening task states the review scope and the blocker/defer rule', () => {
  const root = makeProject();
  addHard(root, 'auth', '--id', 'T-070');
  fs.mkdirSync(teamPaths(root).tasks, { recursive: true });
  fs.writeFileSync(path.join(teamPaths(root).tasks, 'T-070.md'), '# T-070\n\nHarden auth.\n');
  const r = cli('pack.js', root, 'T-070', '--role', 'code-reviewer');
  assert.equal(r.status, 0, r.err);
  const pack = fs.readFileSync(r.out.path, 'utf8');
  assert.match(pack, /Hardening task/);
  assert.match(pack, /changed lines and their direct impact sites only/);
  assert.match(pack, /--origin hardening/);
});

test('A1 a normal task pack has no hardening note', () => {
  const root = makeProject();
  board(root, 'add', '--title', 't', '--owner', 'backend-developer', '--model', 'sonnet', '--id', 'T-001');
  fs.mkdirSync(teamPaths(root).tasks, { recursive: true });
  fs.writeFileSync(path.join(teamPaths(root).tasks, 'T-001.md'), '# T-001\n');
  const r = cli('pack.js', root, 'T-001', '--role', 'code-reviewer');
  assert.doesNotMatch(fs.readFileSync(r.out.path, 'utf8'), /Hardening task/);
});

test('A1 guidance lives in skills and agents: invariant brief, blocker rule, review scope, no lead growth', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /violated invariant/);
  assert.match(loop, /every route/);
  assert.match(loop, /--decision/);
  assert.match(loop, /--origin hardening/);
  assert.match(read('agents', 'planner.md'), /violated invariant/);
  assert.match(read('agents', 'code-reviewer.md'), /changed lines and their direct impact sites only/);
});

// ---- A3: proportionality on new-task proposals ----

const ask = (root, ...extra) => cli('decisions.js', root, 'ask', '--title', 'Add a hardening task?', '--source', 's', '--status', 'st', '--impact', 'i', '--blocking', 'no', '--thread', 'th', '--options', 'now|phase end', ...extra);

test('A3 a theoretical-only proposal with a "now" recommendation is refused', () => {
  const root = makeProject();
  const r = ask(root, '--recommend', 'now', '--finding-class', 'theoretical');
  assert.equal(r.status, 1);
  assert.match(r.err, /theoretical/);
  assert.match(r.err, /phase end/);
  assert.equal(cli('decisions.js', root, 'open').out.length, 0);
});

test('A3 a theoretical proposal recommending the phase end is accepted and stores the class', () => {
  const root = makeProject();
  const r = ask(root, '--recommend', 'phase end', '--finding-class', 'theoretical');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out['finding-class'], 'theoretical');
});

test('A3 observed and known proposals may recommend now', () => {
  const root = makeProject();
  assert.equal(ask(root, '--recommend', 'now', '--finding-class', 'observed').status, 0);
  assert.equal(ask(root, '--recommend', 'now', '--finding-class', 'known').status, 0);
});

test('A3 --finding-class must be observed, known or theoretical', () => {
  const root = makeProject();
  assert.equal(ask(root, '--recommend', 'now', '--finding-class', 'maybe').status, 1);
});

test('A3 the question-protocol skill requires the finding class on new-task questions', () => {
  const t = read('skills', 'question-protocol', 'SKILL.md');
  assert.match(t, /--finding-class/);
  assert.match(t, /theoretical/);
});

// ---- A4: security tag from threat-model references ----

const briefFor = (root, id, text) => {
  fs.mkdirSync(teamPaths(root).tasks, { recursive: true });
  fs.writeFileSync(path.join(teamPaths(root).tasks, `${id}.md`), text);
};
const addTask = (root, id, ...extra) => board(root, 'add', '--title', 't', '--owner', 'backend-developer', '--model', 'sonnet', '--id', id, ...extra);

test('A4 starting a task whose brief cites threat-model IDs tags it security: yes', () => {
  const root = makeProject();
  addTask(root, 'T-021');
  briefFor(root, 'T-021', '# T-021\n\nSpec: **5.4**; threat-model T12, M2, M6.\n');
  const r = board(root, 'update', 'T-021', '--status', 'in-progress');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.security, 'yes');
  assert.match(r.out.securityNote, /T12, M2, M6/);
  assert.equal(readBoard(root).entries[0].security, 'yes');
});

test('A4 add tags at once when the brief already exists', () => {
  const root = makeProject();
  briefFor(root, 'T-022', 'Spec: **1**; threat-model T5.\n');
  assert.equal(addTask(root, 'T-022').out.security, 'yes');
});

test('A4 a brief without threat-model IDs is left alone; an explicit tag is kept', () => {
  const root = makeProject();
  addTask(root, 'T-001');
  briefFor(root, 'T-001', '# T-001\n\nNo threats here, mentions T12 in prose only.\n');
  assert.equal(board(root, 'update', 'T-001', '--status', 'in-progress').out.security, undefined);
  addTask(root, 'T-002', '--security', 'contract');
  briefFor(root, 'T-002', 'threat-model T5\n');
  assert.equal(board(root, 'update', 'T-002', '--status', 'in-progress').out.security, 'contract');
});

test('A4 --security no in the same call is respected', () => {
  const root = makeProject();
  addTask(root, 'T-003');
  briefFor(root, 'T-003', 'threat-model T5\n');
  assert.equal(board(root, 'update', 'T-003', '--status', 'in-progress', '--security', 'no').out.security, undefined);
});
