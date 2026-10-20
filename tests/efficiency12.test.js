import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addEntry, updateEntry, taskTree } from '../scripts/lib/board.js';
import { writePack } from '../scripts/lib/pack.js';
import { makeGitProject } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gateCli = path.join(pluginRoot, 'scripts', 'gate.js');

// g28: pack.js --base and gate.js --task ran in the main tree while the task worked in its own worktree; T-059's pack
// came out with an empty diff and the gate checked the wrong tree. Both now follow the board's worktree.
function projectWithWorktree() {
  const { root, git, commit } = makeGitProject();
  const base = commit('a.txt');
  const wt = `${root}-wt-T-1`;
  git('worktree', 'add', '-q', '-b', 'task/T-1', wt);
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-1.md'), '# T-1\n\nChange b.txt.\n');
  addEntry(root, { id: 'T-1', title: 'one', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(root, 'T-1', { status: 'in-progress', worktree: wt.split(path.sep).join('/') });
  fs.writeFileSync(path.join(wt, 'b.txt'), 'only in the worktree\n');
  execGit(wt, 'add', 'b.txt');
  execGit(wt, 'commit', '-q', '-m', 'b');
  return { root, wt, base };
}
const execGit = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

test('taskTree returns the board worktree, the main tree without one, and refuses a missing worktree', () => {
  const { root, wt } = projectWithWorktree();
  assert.equal(path.resolve(taskTree(root, 'T-1')), path.resolve(wt));
  addEntry(root, { id: 'T-2', title: 'two', owner: 'backend-developer', model: 'sonnet' });
  assert.equal(taskTree(root, 'T-2'), root);
  updateEntry(root, 'T-2', { worktree: path.join(root, 'gone') });
  assert.throws(() => taskTree(root, 'T-2'), /worktree .*does not exist/);
});

test('pack --base diffs the task worktree and writes the pack in the main project', () => {
  const { root, base } = projectWithWorktree();
  const r = writePack(root, { id: 'T-1', role: 'code-reviewer', base });
  assert.ok(r.path.startsWith(path.join(root, 'team', 'work', 'packs')), r.path);
  assert.match(fs.readFileSync(r.path, 'utf8'), /only in the worktree/);
});

test('gate.js --task runs the checks in the task worktree', () => {
  const { root, wt } = projectWithWorktree();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateCommands: [{ name: 'test', command: 'node -e "process.exit(require(\'fs\').existsSync(\'b.txt\') ? 0 : 1)"' }] }));
  const r = spawnSync(process.execPath, [gateCli, '--task', 'T-1', '--project', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(path.resolve(JSON.parse(r.stdout).tree), path.resolve(wt));
  const main = spawnSync(process.execPath, [gateCli, '--project', root], { encoding: 'utf8' });
  assert.equal(main.status, 1, 'without --task the gate stays in the main tree, where b.txt does not exist');
});
