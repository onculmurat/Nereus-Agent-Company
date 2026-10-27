// 1.3.56: g98, task.js close --commit takes a comma-separated list for a main-tree task with step commits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { addEntry, readBoard, recordReview } from '../scripts/lib/board.js';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';

const run = (script, args, root) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8' });

// Seen live (Memory Agent, 10-27): T-113 ran in the main tree with step commits e9ee0ac and fd106d0; close took one
// --commit, so the board held one and the close needed --single-commit.
test('g98: close --commit a,b records both commits and needs no --single-commit', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  addEntry(p.root, { id: 'T-001', title: 'steps', owner: 'backend-developer', model: 'sonnet', size: 'M' });
  recordReview(p.root, 'T-001', { role: 'code-reviewer', verdict: 'pass' });
  assert.equal(run('task.js', ['start', 'T-001'], p.root).status, 0);
  const one = p.commit('one.txt');
  const two = p.commit('two.txt');
  const closed = run('task.js', ['close', 'T-001', '--commit', `${one}, ${two}`, '--lead-note', 'n'], p.root);
  assert.equal(closed.status, 0, closed.stderr);
  assert.deepEqual(readBoard(p.root).entries.find((e) => e.id === 'T-001').commits, [one, two]);
});
