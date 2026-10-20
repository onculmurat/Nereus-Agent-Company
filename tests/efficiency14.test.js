import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addEntry, updateEntry } from '../scripts/lib/board.js';
import { removeWorktree } from '../scripts/lib/worktree.js';
import { makeGitProject } from './helpers.js';

// g30: worktree.js remove looked only under <worktreeRoot>/<repo>-wt/<id>, so T-059's worktree, recorded on the board
// at another path, was not found and the lead removed it with git by hand. Remove now follows the board like g28.
function projectWithBoardWorktree(wt) {
  const { root, git, commit } = makeGitProject();
  commit('a.txt');
  git('worktree', 'add', '-q', '-b', 'task/T-1', wt(root));
  addEntry(root, { id: 'T-1', title: 'one', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(root, 'T-1', { worktree: wt(root).split(path.sep).join('/') });
  return { root, git };
}

test('remove takes the worktree the board records, not the computed path', () => {
  const wt = (root) => `${root}-elsewhere-T-1`;
  const { root, git } = projectWithBoardWorktree(wt);
  const r = removeWorktree(root, 'T-1', { worktreeRoot: path.join(root, 'nowhere') });
  assert.equal(path.resolve(r.removed), path.resolve(wt(root)));
  assert.equal(fs.existsSync(wt(root)), false);
  assert.equal(git('branch', '--list', 'task/T-1'), '');
});

test('remove without a board worktree keeps the computed path', () => {
  const { root, git, commit } = makeGitProject();
  commit('a.txt');
  git('worktree', 'add', '-q', '-b', 'task/T-2', `${root}-wt/T-2`);
  const r = removeWorktree(root, 'T-2');
  assert.equal(path.resolve(r.removed), path.resolve(`${root}-wt/T-2`));
  assert.equal(git('branch', '--list', 'task/T-2'), '');
});
