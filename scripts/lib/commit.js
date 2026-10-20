// Commits made by NAC scripts for state files (team/, settings) use an explicit pathspec, never the whole index:
// the shared index may hold a developer's staged code, and a plain `git commit` would sweep it in (D-227).
import { execFileSync } from 'node:child_process';

// Commits the current content of `paths` (relative to root) as one commit. Anything else staged stays staged and
// uncommitted. Returns { committed, sha } or { committed: false, warning }. Never throws.
export function commitPaths(root, paths, message) {
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  try {
    git('rev-parse', '--is-inside-work-tree');
  } catch {
    return { committed: false, warning: 'not committed: the project is not a git repository' };
  }
  try {
    if (git('status', '--porcelain', '--', ...paths) === '') return { committed: false, warning: `nothing to commit in ${paths.join(', ')}` };
    git('add', '--', ...paths);
    git('commit', '-q', '-m', message, '--', ...paths);
    return { committed: true, sha: git('rev-parse', '--short', 'HEAD') };
  } catch (e) {
    return { committed: false, warning: `not committed (${String(e.stderr || e.message).trim().split('\n')[0]})` };
  }
}

// The subset of `paths` (absolute or relative to root) that git reports as modified or staged right now, and whether
// root is a git work tree at all: { git: boolean, dirty: string[] }.
export function dirtyPaths(root, paths) {
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  try {
    git('rev-parse', '--is-inside-work-tree');
  } catch {
    return { git: false, dirty: [] };
  }
  const dirty = paths.filter((p) => {
    try {
      return git('status', '--porcelain', '--', p) !== '';
    } catch {
      return false;
    }
  });
  return { git: true, dirty };
}

// Keeps only the paths git would accept for `git add` (drops files matched by .gitignore).
export function notIgnored(root, paths) {
  return paths.filter((p) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: root, stdio: 'ignore' });
      return false;
    } catch {
      return true;
    }
  });
}
