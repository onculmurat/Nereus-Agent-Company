import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeProject } from '../helpers.js';
import { runHook, fixture } from './run-hook.js';
import { addEntry, updateEntry } from '../../scripts/lib/board.js';
import { teamPaths } from '../../scripts/lib/paths.js';

function projectWithTask(status) {
  const root = makeProject();
  addEntry(root, { title: 'Build the API', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(root, 'T-001', { status });
  return root;
}

test('blocks completion of a board task that is not done', async () => {
  const root = projectWithTask('in-progress');
  const r = runHook('task-completed', await fixture('task-completed.synthetic', { cwd: root }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /T-001 is not complete/);
});

test('blocks a done task without a hand-off note', async () => {
  const root = projectWithTask('done');
  const r = runHook('task-completed', await fixture('task-completed.synthetic', { cwd: root }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /hand-off/);
});

test('allows a done task with a hand-off note', async () => {
  const root = projectWithTask('done');
  fs.mkdirSync(teamPaths(root).handoffs, { recursive: true });
  fs.writeFileSync(path.join(teamPaths(root).handoffs, 'T-001.md'), 'done');
  const r = runHook('task-completed', await fixture('task-completed.synthetic', { cwd: root }));
  assert.equal(r.status, 0, r.stderr);
});

test('a native task without a board id is not gated', async () => {
  const root = projectWithTask('todo');
  const r = runHook('task-completed', await fixture('task-completed.synthetic', { cwd: root, task_subject: 'Say hello' }));
  assert.equal(r.status, 0);
});

test('a board id that does not exist is not gated', async () => {
  const root = projectWithTask('todo');
  const r = runHook('task-completed', await fixture('task-completed.synthetic', { cwd: root, task_subject: 'T-404: Ghost' }));
  assert.equal(r.status, 0);
});
