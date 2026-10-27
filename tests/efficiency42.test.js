// 1.3.54: g96, task.js note --chore committed all of team/ and swept in another task's work in progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { addEntry } from '../scripts/lib/board.js';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';

const run = (script, args, root) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8' });

// Seen live (Memory Agent, 10-27): T-111's doc-writer edited team/spec.md and team/threat-model.md in the main tree;
// the lead's "T-109c note: Gate skips" commit (5b348fa) took them, and T-111 was closed with that commit as its own.
test('g96: task.js note --chore commits only the task hand-off', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  addEntry(p.root, { id: 'T-001', title: 'first', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  assert.equal(run('task.js', ['start', 'T-001'], p.root).status, 0);
  fs.writeFileSync(path.join(p.root, 'team', 'spec.md'), 'another task, half written');
  const note = run('task.js', ['note', 'T-001', '--heading', 'Gate', '--text', 'green', '--chore'], p.root);
  assert.equal(note.status, 0, note.stderr);
  const git = (...a) => execFileSync('git', a, { cwd: p.root, encoding: 'utf8' }).trim();
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n'), ['team/work/handoffs/T-001.md']);
  assert.match(git('status', '--porcelain', '--', 'team'), /spec\.md/);
});
