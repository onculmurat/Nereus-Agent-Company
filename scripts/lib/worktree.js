// Parallel tasks run in their own git worktree on branch task/<id>, outside the repo.
// The lead integrates an approved task locally by cherry-picking its commits; push and remote merge stay with the owner.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBoard } from './board.js';
import { listProcesses } from './gate.js';

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
  return { id, path: dir, branch: branchOf(id), base, target: path.join(path.dirname(dir), `target-${id}`) };
}

// g50: a build dir kept outside the worktree (a full drive, a second profile) lives beside it as target-<id>[-suffix];
// remove deletes those with the worktree. g81: the task's tmp-<id> folders beside it go too (T-060, T-097, T-099 stayed). Ids are checked, so the match never leaves the worktree base.
function removeBuildDirs(base, id) {
  const name = new RegExp(`^(?:target|tmp)-${id.replace(/-/g, '\\-')}(?:-.*)?$`, 'i');
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  const removed = [];
  for (const e of entries) {
    if (!e.isDirectory() || !name.test(e.name)) continue;
    const p = path.join(base, e.name);
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(p);
  }
  return removed;
}

// g90: review and base builds of a task went to a deleteRoots folder under names that only carry its id
// (Memory Agent: review-t047, review-t047-base, t105a, review-061b, ~33 GB), nothing removed them and D: filled up
// with five tasks building at once. A child folder of a deleteRoots folder whose name holds the id as its own part
// (T-047: t047, t-047, 047) is the task's build output.
export function idPattern(id) {
  const core = checkId(id).replace(/^[A-Za-z]+-?/, '').replace(/[-]/g, '\\-');
  // only a t or t- prefix: any letters let a uuid part (d018-) stand for T-018
  return new RegExp(`(?:^|[-_.])(?:t-?)?${core}(?=$|[-_.])`, 'i');
}

export function taskBuildDirs(roots, id) {
  const name = idPattern(id);
  const found = [];
  for (const r of roots) {
    let entries = [];
    try { entries = fs.readdirSync(r, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && name.test(e.name)) found.push(path.join(r, e.name));
  }
  return found;
}

// Removes the build output of done tasks: target-<id>/tmp-<id> beside the worktrees and the deleteRoots folders named
// after the task. Tasks that are not done keep theirs. Returns the removed paths and the ones that stayed (locked).
export function pruneTaskBuilds(root, { worktreeRoot, deleteRoots = [], ids } = {}) {
  const entries = readBoard(root).entries;
  const done = new Set(entries.filter((e) => e.status === 'done').map((e) => e.id));
  const open = entries.filter((e) => e.status !== 'done').map((e) => idPattern(e.id));
  const wanted = (ids ?? [...done]).filter((id) => done.has(id) && ID_RE.test(id));
  const beside = path.dirname(worktreePath(root, 'T-1', { worktreeRoot }));
  const removed = [];
  const failed = [];
  for (const id of wanted) {
    const besideName = new RegExp(`^(?:target|tmp)-${id.replace(/-/g, '\\-')}(?:-.*)?$`, 'i');
    let near = [];
    try { near = fs.readdirSync(beside, { withFileTypes: true }).filter((e) => e.isDirectory() && besideName.test(e.name)).map((e) => path.join(beside, e.name)); } catch { /* no worktrees yet */ }
    // a folder whose name also names a task still open (review-t047-t110a) stays
    const named = taskBuildDirs(deleteRoots, id).filter((p) => !open.some((re) => re.test(path.basename(p))));
    for (const p of [...near, ...named]) {
      if (removed.includes(p)) continue;
      try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); removed.push(p); } catch (err) { failed.push({ path: p, error: err.message }); }
    }
  }
  return { removed, ...(failed.length ? { failed } : {}) };
}

// NAC_FREE_BYTES stands in for the free space in tests (g91)
export function freeBytes(dir) {
  if (/^\d+$/.test(process.env.NAC_FREE_BYTES ?? '')) return Number(process.env.NAC_FREE_BYTES);
  let d = path.resolve(dir);
  while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
  try {
    const s = fs.statfsSync(d);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

// g91: the shared build dirs (the main tree's target, a CARGO_TARGET_DIR every gate uses) grow with each build and
// the done-task prune never touches them (Memory Agent: ~90 + 53 GB). The owner asked for a routine: below
// maintenanceFreeGB the lead starts nothing new, lets the running work end, removes them and goes on.
export const DEFAULT_MAINTENANCE_FREE_GB = 20;
const GB = 1024 ** 3;
const gbOf = (n) => Math.round(n / GB * 10) / 10;

export function maintenanceState(root, config = {}) {
  const dirs = config.sharedBuildDirs ?? [];
  const min = config.maintenanceFreeGB ?? DEFAULT_MAINTENANCE_FREE_GB;
  if (!dirs.length || !(min > 0)) return { due: false };
  const free = Math.min(...[root, ...dirs].map((d) => freeBytes(d) ?? Infinity));
  if (free >= min * GB) return { due: false, freeGB: gbOf(free) };
  return {
    due: true, freeGB: gbOf(free), minGB: min, dirs,
    note: `maintenance due (g91): ${gbOf(free)} GB free, under maintenanceFreeGB ${min}. Start no new task, developer, gate or review; let the running ones finish and take their results. When nothing builds, run worktree.js prune --shared (it removes the done tasks' build dirs and sharedBuildDirs: ${dirs.join(', ')}), then go on. If it still reports maintenance due, ask the owner to free space.`,
  };
}

const BUILD_PROCESS = /(?:^|[\\/\s"])(?:cargo|rustc|clippy-driver)(?:\.exe)?(?=["\s]|$)/i;
const inside = (d, base) => { const r = path.relative(path.resolve(base), path.resolve(d)); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

// Removes sharedBuildDirs, and the done tasks' build dirs, when no build runs. Each shared dir must lie inside the
// project or a deleteRoots folder; one outside is refused, not removed.
export function pruneShared(root, config = {}, { list = listProcesses, deleteRoots = [] } = {}) {
  const busy = list().filter((p) => p.pid !== process.pid && BUILD_PROCESS.test(p.cmd ?? ''));
  if (busy.length) {
    return { ok: false, busy: busy.map((p) => ({ pid: p.pid, cmd: String(p.cmd).slice(0, 160) })), note: 'builds still run: start nothing new, wait for these to end (never stop them by name), then run prune --shared again.' };
  }
  const removed = [];
  const refused = [];
  const failed = [];
  for (const d of config.sharedBuildDirs ?? []) {
    if (!path.isAbsolute(d) || ![root, ...deleteRoots].some((b) => inside(d, b))) { refused.push(d); continue; }
    if (!fs.existsSync(d)) continue;
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); removed.push(d); } catch (err) { failed.push({ path: d, error: err.message }); }
  }
  const tasks = pruneTaskBuilds(root, { worktreeRoot: config.worktreeRoot, deleteRoots });
  const after = maintenanceState(root, config);
  return {
    ok: !failed.length, removed, tasksRemoved: tasks.removed,
    ...(refused.length ? { refused, refusedNote: 'outside the project and deleteRoots: not removed' } : {}),
    ...(failed.length ? { failed } : {}),
    ...(after.freeGB !== undefined ? { freeGB: after.freeGB } : {}), ...(after.due ? { maintenance: after } : {}),
  };
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
  return { id, removed: dir, buildDirs: removeBuildDirs(path.dirname(dir), id) };
}
