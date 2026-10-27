import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addWorktree, integrateWorktree, removeWorktree, worktreePath } from '../scripts/lib/worktree.js';
import './helpers.js';
import { addEntry, readBoard } from '../scripts/lib/board.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(pluginRoot, 'scripts', 'worktree.js');

function repo() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nac wt '));
  const root = path.join(parent, 'proj');
  fs.mkdirSync(path.join(root, 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', 'base.txt', 'team/config.json');
  git(root, 'commit', '-q', '-m', 'base');
  return { root, git };
}

function commitIn(git, dir, file, text, msg) {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', msg);
}

test('add creates a worktree outside the repo on branch task/<id>', () => {
  const { root, git } = repo();
  const r = addWorktree(root, 'T-7');
  assert.equal(r.path, worktreePath(root, 'T-7'));
  assert.equal(r.path, path.join(`${root}-wt`, 'T-7'));
  assert.equal(r.branch, 'task/T-7');
  assert.equal(git(r.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'task/T-7');
  assert.equal(r.base, git(root, 'rev-parse', 'HEAD'));
  assert.throws(() => addWorktree(root, 'T-7'), /already exists/);
});

test('ids that could escape the worktree directory are rejected', () => {
  const { root } = repo();
  assert.throws(() => addWorktree(root, '../x'), /Invalid task id/);
});

test('integrate cherry-picks the task commits onto the working branch in order', () => {
  const { root, git } = repo();
  const wt = addWorktree(root, 'T-7');
  commitIn(git, wt.path, 'one.txt', '1\n', 'task commit one');
  commitIn(git, wt.path, 'two.txt', '2\n', 'task commit two');
  commitIn(git, root, 'other.txt', 'o\n', 'meanwhile on main');
  const r = integrateWorktree(root, 'T-7');
  assert.equal(r.commits.length, 2);
  assert.deepEqual(git(root, 'log', '--format=%s', '-3').split('\n'), ['task commit two', 'task commit one', 'meanwhile on main']);
  assert.ok(fs.existsSync(path.join(root, 'one.txt')) && fs.existsSync(path.join(root, 'two.txt')));
  assert.deepEqual(r.commits, git(root, 'log', '--format=%H', '-2', '--reverse').split('\n'));
});

// Seen live (Memory Agent, g97): T-108b, T-109b, T-109c, T-110c and T-114 integrated 2-4 step commits each, the board
// recorded only the --commit given at close, and every close needed --single-commit.
test('integrate records the integrated commits on the board entry (g97)', () => {
  const { root, git } = repo();
  addEntry(root, { id: 'T-9', title: 'steps', owner: 'backend-developer', model: 'sonnet' });
  const wt = addWorktree(root, 'T-9');
  commitIn(git, wt.path, 'one.txt', '1\n', 'step one');
  commitIn(git, wt.path, 'two.txt', '2\n', 'step two');
  integrateWorktree(root, 'T-9');
  const recorded = readBoard(root).entries.find((e) => e.id === 'T-9').commits;
  assert.deepEqual(recorded, git(root, 'log', '--format=%h', '-2', '--reverse').split('\n'));
});

test('a conflicting integrate is aborted and leaves the working branch clean', () => {
  const { root, git } = repo();
  const wt = addWorktree(root, 'T-8');
  commitIn(git, wt.path, 'base.txt', 'from task\n', 'task edit');
  commitIn(git, root, 'base.txt', 'from main\n', 'main edit');
  const head = git(root, 'rev-parse', 'HEAD');
  assert.throws(() => integrateWorktree(root, 'T-8'), /conflict/i);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('integrate with no task commits is an error', () => {
  const { root } = repo();
  addWorktree(root, 'T-9');
  assert.throws(() => integrateWorktree(root, 'T-9'), /no commits/i);
});

test('integrate refuses a dirty working branch', () => {
  const { root, git } = repo();
  const wt = addWorktree(root, 'T-10');
  commitIn(git, wt.path, 'one.txt', '1\n', 'task');
  fs.writeFileSync(path.join(root, 'base.txt'), 'dirty\n');
  assert.throws(() => integrateWorktree(root, 'T-10'), /uncommitted/i);
});

test('remove deletes the worktree directory and the branch', () => {
  const { root, git } = repo();
  const wt = addWorktree(root, 'T-7');
  commitIn(git, wt.path, 'one.txt', '1\n', 'task');
  integrateWorktree(root, 'T-7');
  removeWorktree(root, 'T-7');
  assert.ok(!fs.existsSync(wt.path));
  assert.equal(git(root, 'branch', '--list', 'task/T-7'), '');
});

// g50: build dirs a task put beside its worktree (target-<id>, target-<id>-sec) are removed with it; other tasks' stay.
test('remove also deletes the task build dirs beside the worktree', () => {
  const { root } = repo();
  const wt = addWorktree(root, 'T-12');
  assert.equal(wt.target, path.join(`${root}-wt`, 'target-T-12'));
  const base = path.dirname(wt.path);
  for (const d of ['target-T-12', 'target-t-12-sec', 'target-T-120', 'target-T-13']) {
    fs.mkdirSync(path.join(base, d, 'debug'), { recursive: true });
    fs.writeFileSync(path.join(base, d, 'debug', 'x.rlib'), 'x');
  }
  const r = removeWorktree(root, 'T-12');
  assert.deepEqual(r.buildDirs.map((p) => path.basename(p)).sort(), ['target-T-12', 'target-t-12-sec']);
  assert.ok(!fs.existsSync(path.join(base, 'target-T-12')) && !fs.existsSync(path.join(base, 'target-t-12-sec')));
  assert.ok(fs.existsSync(path.join(base, 'target-T-120')) && fs.existsSync(path.join(base, 'target-T-13')));
});

test('remove refuses a worktree with uncommitted changes', () => {
  const { root } = repo();
  const wt = addWorktree(root, 'T-11');
  fs.writeFileSync(path.join(wt.path, 'new.txt'), 'x');
  assert.throws(() => removeWorktree(root, 'T-11'), /uncommitted|untracked|modified/i);
  assert.ok(fs.existsSync(wt.path));
});

test('cli add, integrate and remove print JSON', () => {
  const { root, git } = repo();
  const run = (...a) => spawnSync(process.execPath, [cli, ...a, '--project', root], { encoding: 'utf8' });
  const add = run('add', 'T-12');
  assert.equal(add.status, 0, add.stderr);
  const wt = JSON.parse(add.stdout);
  commitIn(git, wt.path, 'c.txt', 'c\n', 'task c');
  const integ = run('integrate', 'T-12');
  assert.equal(integ.status, 0, integ.stderr);
  assert.equal(JSON.parse(integ.stdout).commits.length, 1);
  assert.equal(run('remove', 'T-12').status, 0);
  assert.equal(run('bogus', 'T-12').status, 1);
});
