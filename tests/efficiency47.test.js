// 1.3.61: g103, task.js close records a main-tree task's code commits since its start commit by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { addEntry, readBoard, recordReview, updateEntry } from '../scripts/lib/board.js';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';

const run = (script, args, root) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8' });
const commitAs = (p, name, message) => {
  fs.writeFileSync(path.join(p.root, name), name);
  p.git('add', name);
  p.git('commit', '-q', '-m', message);
  return p.git('log', '-1', '--format=%h');
};
const task = (p, id) => {
  addEntry(p.root, { id, title: id, owner: 'backend-developer', model: 'sonnet', size: 'M' });
  recordReview(p.root, id, { role: 'code-reviewer', verdict: 'pass' });
};
const close = (p, id, ...args) => {
  const r = run('task.js', ['close', id, '--lead-note', 'n', ...args], p.root);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

// Seen live (Memory Agent T-117, 10-27): the lead recorded 91456ca, 79d6c5a and 393c40d one by one with board.js update
// --commit; the phase-5 lesson asked close to take them from git, and the owner agreed.
test('g103: close records the code commits since the start commit, without team or other tasks\' commits', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  task(p, 'T-001');
  task(p, 'T-002');
  assert.equal(run('task.js', ['start', 'T-001'], p.root).status, 0);
  const one = commitAs(p, 'one.rs', 'fix(core): step one');
  commitAs(p, 'note.md', 'chore(team): T-001 note');
  commitAs(p, 'other.rs', 'style(T-002): fmt');
  const done = commitAs(p, 'done.rs', 'feat(core): step two');
  updateEntry(p.root, 'T-002', { commits: [done] });
  const two = commitAs(p, 'two.rs', 'style(T-001): fmt');
  const closed = close(p, 'T-001');
  assert.deepEqual(closed.stepCommits, [one, two]);
  assert.deepEqual(readBoard(p.root).entries.find((e) => e.id === 'T-001').commits, [one, two]);
});

test('g103: a code task with no code commit since its start is refused; --commit still adds an older one', () => {
  const p = makeGitProject();
  const older = p.commit('seed.txt');
  task(p, 'T-001');
  assert.equal(run('task.js', ['start', 'T-001'], p.root).status, 0);
  const refused = run('task.js', ['close', 'T-001', '--lead-note', 'n'], p.root);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Missing --commit: T-001 has no recorded commit and no code commit since/);
  assert.equal(readBoard(p.root).entries.find((e) => e.id === 'T-001').status, 'in-progress');
  const one = commitAs(p, 'one.rs', 'fix(core): one');
  const closed = close(p, 'T-001', '--commit', older);
  assert.deepEqual(closed.commits, [one, older]);
});
