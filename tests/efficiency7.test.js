// Batch 7: batched owner questions (defer/flush), decision batching, security gate.
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
const ask = (root, title, ...extra) => cli('decisions.js', root, 'ask', '--title', title, '--source', 'src', '--status', 'st', '--impact', 'imp', '--blocking', 'no', '--thread', title.toLowerCase().replace(/\W+/g, '-'), ...extra);
const addTask = (root, ...extra) => cli('board.js', root, 'add', '--title', 'API', '--owner', 'backend-developer', '--model', 'sonnet', ...extra);

// Item 3: batched owner questions.
test('ask --defer stores the question as deferred with its task', () => {
  const root = makeProject();
  const r = ask(root, 'Which lib', '--defer', '--task', 'T-001');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.state, 'deferred');
  assert.equal(r.out.task, 'T-001');
  assert.equal(ask(root, 'Plain').out.state, undefined);
});

test('flush prints deferred questions in groups of at most 4, recommendation first, and marks them open', () => {
  const root = makeProject();
  for (let i = 1; i <= 5; i++) ask(root, `Question ${i}`, '--defer', '--task', 'T-001', '--options', 'alpha|beta', '--recommend', 'beta');
  ask(root, 'Other task', '--defer', '--task', 'T-002');
  ask(root, 'Not deferred');
  const f = cli('decisions.js', root, 'flush', '--task', 'T-001');
  assert.equal(f.status, 0, f.err);
  assert.deepEqual(f.out.map((g) => g.questions.length), [4, 1]);
  const first = f.out[0].questions[0];
  assert.match(first.question, /Question 1/);
  assert.match(first.question, /Source: src/);
  assert.ok(first.header.length <= 12);
  assert.deepEqual(first.options.map((o) => o.label), ['beta (Recommended)', 'alpha']);
  assert.equal(first.multiSelect, false);
  // flushed ones are open now; the other task's stays deferred
  const open = cli('decisions.js', root, 'open').out;
  assert.equal(open.filter((q) => q.state === 'deferred').length, 1);
  assert.equal(cli('decisions.js', root, 'flush', '--task', 'T-001').out.length, 0);
  assert.equal(cli('decisions.js', root, 'flush').out.flatMap((g) => g.questions).length, 1);
});

test('board update --status done refuses while the task has deferred questions', () => {
  const root = makeProject();
  addTask(root);
  ask(root, 'Later', '--defer', '--task', 'T-001');
  const r = cli('board.js', root, 'update', 'T-001', '--status', 'done');
  assert.equal(r.status, 1);
  assert.match(r.err, /deferred question/);
  assert.match(r.err, /decisions\.js flush --task T-001/);
  cli('decisions.js', root, 'flush', '--task', 'T-001');
  assert.equal(cli('board.js', root, 'update', 'T-001', '--status', 'done').status, 0);
});

test('question-protocol and task-loop describe defer, flush and the 4-question call', () => {
  const qp = read('skills', 'question-protocol', 'SKILL.md');
  assert.match(qp, /--defer/);
  assert.match(qp, /decisions\.js" flush/);
  assert.match(qp, /one `AskUserQuestion` call[^\n]*up to 4/);
  assert.match(read('skills', 'task-loop', 'SKILL.md'), /flush --task <id>/);
});

// Item 4: decision batching.
const decisions = (root, ...a) => cli('decisions.js', root, ...a);
const decided = (root) => decisions(root, 'show').out.decided;

test('record --file records an array of decisions in one call and prints the ids', () => {
  const root = makeProject();
  const file = path.join(root, 'batch.json');
  fs.writeFileSync(file, JSON.stringify([{ outcome: 'Use Rust', title: 'Language' }, { outcome: 'Use SQLite', thread: 'db', link: 'docs/db.md' }]));
  const r = decisions(root, 'record', '--file', file);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.ids, ['D-001', 'D-002']);
  const [a, b] = decided(root);
  assert.equal(a.title, 'Language');
  assert.equal(a.thread, 'language');
  assert.equal(b.answer, 'Use SQLite');
  assert.equal(b.thread, 'db');
  assert.equal(b.link, 'docs/db.md');
});

test('record --file rejects a non-array or an item without an outcome and writes nothing', () => {
  const root = makeProject();
  const file = path.join(root, 'bad.json');
  fs.writeFileSync(file, JSON.stringify([{ outcome: 'ok' }, { title: 'no outcome' }]));
  const r = decisions(root, 'record', '--file', file);
  assert.equal(r.status, 1);
  assert.match(r.err, /outcome/);
  assert.equal(decided(root).length, 0);
  fs.writeFileSync(file, '{}');
  assert.equal(decisions(root, 'record', '--file', file).status, 1);
});

test('record --supersedes marks the old decision, on the command line and per item in a file', () => {
  const root = makeProject();
  decisions(root, 'record', '--outcome', 'Use MySQL');
  const r = decisions(root, 'record', '--outcome', 'Use Postgres', '--supersedes', 'D-001');
  assert.equal(r.out.supersedes, 'D-001');
  assert.equal(decided(root)[0]['superseded-by'], 'D-002');
  const file = path.join(root, 'b.json');
  fs.writeFileSync(file, JSON.stringify([{ outcome: 'Use Cockroach', supersedes: 'D-002' }]));
  decisions(root, 'record', '--file', file);
  assert.equal(decided(root)[1]['superseded-by'], 'D-003');
  const bad = decisions(root, 'record', '--outcome', 'x', '--supersedes', 'D-999');
  assert.equal(bad.status, 1);
  assert.match(bad.err, /D-999/);
  assert.equal(decided(root).length, 3);
});

test('amend changes a field of an existing decision in place', () => {
  const root = makeProject();
  decisions(root, 'record', '--outcome', 'Use MySQL', '--title', 'DB');
  const r = decisions(root, 'amend', 'D-001', '--answer', 'Use Postgres', '--link', 'docs/x.md');
  assert.equal(r.status, 0, r.err);
  const d = decided(root)[0];
  assert.equal(d.answer, 'Use Postgres');
  assert.equal(d.link, 'docs/x.md');
  assert.equal(d.title, 'DB');
  assert.equal(decisions(root, 'amend', 'D-404', '--answer', 'x').status, 1);
  assert.equal(decisions(root, 'amend', 'D-001').status, 1);
});

test('lead skills forbid hand edits of decisions.md and keep builds out of the lead', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /never Edit `team\/decisions\.md` by hand[^\n]*record[^\n]*amend[^\n]*--supersedes/i);
  assert.match(loop, /lead does not run builds or tests itself[^\n]*gate script/i);
});

// Item 5: security-reviewer gate.
const board = (root, ...a) => cli('board.js', root, ...a);
const entry = (root, id = 'T-001') => board(root, 'show').out.entries.find((e) => e.id === id);

test('board add/update --security stores the tag and the board file shows it', () => {
  const root = makeProject();
  assert.equal(addTask(root, '--security', 'yes').out.security, 'yes');
  assert.match(fs.readFileSync(path.join(root, 'team', 'work', 'board.md'), 'utf8'), /^- security: yes$/m);
  assert.equal(entry(root).security, 'yes');
  assert.equal(board(root, 'update', 'T-001', '--security', 'no').out.security, undefined);
  assert.equal(board(root, 'update', 'T-001', '--security', 'maybe').status, 1);
  assert.equal(addTask(root).out.security, undefined);
});

test('a security: yes task cannot be done without a security-reviewer pass', () => {
  const root = makeProject();
  addTask(root, '--security', 'yes');
  const refused = board(root, 'update', 'T-001', '--status', 'done');
  assert.equal(refused.status, 1);
  assert.match(refused.err, /security-reviewer/);
  assert.match(refused.err, /board\.js review T-001 --role security-reviewer --verdict pass/);
  assert.equal(board(root, 'review', 'T-001', '--role', 'security-reviewer', '--verdict', 'fail').status, 0);
  assert.equal(board(root, 'update', 'T-001', '--status', 'done').status, 1, 'a failed review is not a pass');
  assert.deepEqual(board(root, 'review', 'T-001', '--role', 'security-reviewer', '--verdict', 'pass').out.reviews, { 'security-reviewer': 'pass' });
  assert.deepEqual(entry(root).reviews, { 'security-reviewer': 'pass' });
  assert.equal(board(root, 'update', 'T-001', '--status', 'done').status, 0);
});

test('an untagged task needs no review; review rejects an unknown verdict, role or task', () => {
  const root = makeProject();
  addTask(root);
  assert.equal(board(root, 'update', 'T-001', '--status', 'done').status, 0);
  assert.equal(board(root, 'review', 'T-001', '--role', 'code-reviewer', '--verdict', 'meh').status, 1);
  assert.equal(board(root, 'review', 'T-404', '--role', 'code-reviewer', '--verdict', 'pass').status, 1);
  assert.equal(board(root, 'review', 'T-001', '--verdict', 'pass').status, 1);
});

test('planner tags security tasks and the lead skill says tagged tasks need security-reviewer before done', () => {
  assert.match(read('agents', 'planner.md'), /`security: yes`[^\n]*threat-model[^\n]*auth[^\n]*crypto[^\n]*secret[^\n]*`security\/`/i);
  assert.match(read('skills', 'task-loop', 'SKILL.md'), /`security: yes`[^\n]*security-reviewer[^\n]*before[^\n]*done[^\n]*board\.js review/i);
});
