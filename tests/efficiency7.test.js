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
