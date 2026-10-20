// Parallel tasks run in their own git worktree on branch task/<id>, outside the repo.
// The lead integrates an approved task locally by cherry-picking its commits; push and remote merge stay with the owner.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBoard } from './board.js';

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function git(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new Error(`git ${args[0]} failed: ${String(e.stderr || e.message).trim()}`);
  }
}

const checkId = (id) => {
  if (!ID_RE.test(id ?? '')) throw new Error(`Invalid task id "${id}"`);
  return id;
};

// worktreeRoot (config) puts the worktrees under another directory, for example a drive with space: <worktreeRoot>/<project>-wt/<id>.
export const worktreePath = (root, id, { worktreeRoot } = {}) => {
  const base = worktreeRoot ? path.join(path.resolve(worktreeRoot), `${path.basename(path.resolve(root))}-wt`) : `${path.resolve(root)}-wt`;
  return path.join(base, checkId(id));
};
const branchOf = (id) => `task/${id}`;

export function addWorktree(root, id, opts) {
  const dir = worktreePath(root, id, opts);
  if (fs.existsSync(dir)) throw new Error(`Worktree for ${id} already exists at ${dir}`);
  const base = git(root, 'rev-parse', 'HEAD');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(root, 'worktree', 'add', '-b', branchOf(id), dir, base);
  return { id, path: dir, branch: branchOf(id), base };
}

// Cherry-picks the commits of task/<id> (since it left the working branch) onto the current branch, oldest first.
export function integrateWorktree(root, id) {
  const branch = branchOf(checkId(id));
  if (git(root, 'status', '--porcelain', '--untracked-files=no')) {
    throw new Error('The working branch has uncommitted changes; commit or stash them before integrating.');
  }
  const commits = git(root, 'rev-list', '--reverse', `${git(root, 'merge-base', 'HEAD', branch)}..${branch}`).split('\n').filter(Boolean);
  if (!commits.length) throw new Error(`Branch ${branch} has no commits to integrate`);
  try {
    git(root, 'cherry-pick', ...commits);
  } catch (e) {
    try { git(root, 'cherry-pick', '--abort'); } catch { /* nothing to abort */ }
    throw new Error(`Cherry-pick conflict integrating ${branch}; the working branch is unchanged. ${e.message}`);
  }
  const added = git(root, 'rev-list', '--reverse', `HEAD~${commits.length}..HEAD`).split('\n').filter(Boolean);
  return { id, branch, commits: added };
}

// g30: the board's worktree wins over the computed path; T-059's worktree lived elsewhere and remove did not find it.
export function removeWorktree(root, id, opts) {
  const recorded = readBoard(root).entries.find((e) => e.id === checkId(id))?.worktree;
  const dir = recorded ? path.resolve(root, recorded) : worktreePath(root, id, opts);
  git(root, 'worktree', 'remove', dir);
  git(root, 'branch', '-D', branchOf(id));
  return { id, removed: dir };
}
