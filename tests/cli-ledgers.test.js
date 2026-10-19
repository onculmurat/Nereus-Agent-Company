import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, makeGitProject } from './helpers.js';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const run = (script, root, ...args) =>
  JSON.parse(execFileSync(process.execPath, [path.join(scripts, script), ...args, '--project', root], { encoding: 'utf8' }));

test('board CLI add, update with commit, phase', () => {
  const { root, commit } = makeGitProject();
  const [c1, c2] = [commit('a.txt'), commit('b.txt')];
  assert.equal(run('board.js', root, 'add', '--title', 'API', '--owner', 'backend-developer', '--model', 'sonnet').id, 'T-001');
  run('board.js', root, 'update', 'T-001', '--status', 'in-progress', '--commit', c1);
  const e = run('board.js', root, 'update', 'T-001', '--commit', c2);
  assert.deepEqual(e.commits, [c1, c2]);
  assert.equal(e.status, 'in-progress');
  assert.equal(run('board.js', root, 'phase', '3').phase, 3);
  assert.equal(run('board.js', root, 'show').phase, 3);
});

test('board CLI round reaches to-lead on the fourth round', () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ reviewRoundCap: 10 }));
  run('board.js', root, 'add', '--title', 'API', '--owner', 'backend-developer', '--model', 'sonnet');
  const actions = [1, 2, 3, 4].map(() => run('board.js', root, 'round', 'T-001').next.action);
  assert.deepEqual(actions, ['retry', 'raise-model', 'retry', 'to-lead']);
});

test('decisions CLI ask, open (blocking first), decide', () => {
  const root = makeProject();
  const ask = (title, blocking, thread) =>
    run('decisions.js', root, 'ask', '--title', title, '--source', 's', '--status', 'st', '--impact', 'i', '--blocking', blocking, '--thread', thread);
  ask('Later', 'no', 'later');
  ask('Now', 'yes', 'now');
  assert.deepEqual(run('decisions.js', root, 'open').map((q) => q.title), ['Now', 'Later']);
  assert.equal(run('decisions.js', root, 'decide', 'Q-002', '--answer', 'go').question, 'Q-002');
});

test('board CLI reports rotate: true on the fifth done and rotated resets it', () => {
  const { root, commit } = makeGitProject();
  const sha = commit('a.txt');
  for (let i = 1; i <= 5; i += 1) run('board.js', root, 'add', '--title', `T${i}`, '--owner', 'backend-developer', '--model', 'sonnet');
  const flags = [1, 2, 3, 4, 5].map((n) => run('board.js', root, 'update', `T-00${n}`, '--status', 'done').rotate);
  assert.deepEqual(flags, [false, false, false, false, true]);
  assert.deepEqual(run('board.js', root, 'rotated'), { rotated: true });
  assert.equal(run('board.js', root, 'update', 'T-001', '--commit', sha).rotate, undefined);
  assert.equal(run('board.js', root, 'show').doneSinceRotation, undefined);
});

test('board CLI foldin counts fold-in rounds from the config cap, and --reset starts a new cycle', () => {
  const root = makeProject();
  run('board.js', root, 'add', '--title', 'Spec', '--owner', 'architect', '--model', 'opus');
  assert.equal(run('board.js', root, 'foldin', 'T-001').action, 'fold-in');
  assert.equal(run('board.js', root, 'foldin', 'T-001').foldIns, 2);
  const third = run('board.js', root, 'foldin', 'T-001');
  assert.equal(third.action, 'batch');
  assert.equal(third.cap, 2);
  assert.equal(run('board.js', root, 'foldin', 'T-001', '--reset').action, 'reset');
  assert.equal(run('board.js', root, 'foldin', 'T-001').foldIns, 1);
});
