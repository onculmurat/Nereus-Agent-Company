#!/usr/bin/env node
// Worktree CLI (lead only): add | integrate | remove, for tasks that run in parallel with another implementer.
import { runCli, UsageError } from './lib/cli.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, checkDeleteRoots } from './lib/config.js';
import { addWorktree, integrateWorktree, removeWorktree, pruneTaskBuilds, pruneShared } from './lib/worktree.js';

const usage = `Usage:
  worktree.js add <task-id>              new worktree <repo>-wt/<id> on branch task/<id> from the current commit
                                         (config worktreeRoot: <worktreeRoot>/<repo>-wt/<id>); prints the path for board.js update --worktree
                                         and the target path (target-<id> beside it) for a build dir kept outside the worktree
  worktree.js integrate <task-id>        cherry-pick the task's commits onto the current branch (aborts on conflict)
  worktree.js remove <task-id>           remove the worktree (the one the board records, else the path above), delete branch task/<id>
                                         and the task build dirs target-<id>[-suffix] beside it
  worktree.js prune [<task-id>]          remove the build output of done tasks (all, or the one named): target-<id>/tmp-<id> beside
                                         the worktrees and the folders in deleteRoots whose name holds the task id (review-t047,
                                         t105a); task.js close does it for the closed task, gate.js when the drive runs low (g90)
  worktree.js prune --shared             maintenance (g91): when no cargo/rustc runs, removes sharedBuildDirs (team/config.json, each
                                         inside the project or a deleteRoots folder) and the done tasks' build dirs; builds running: busy, exit 1.
                                         Due when the drive has less than maintenanceFreeGB (default 20, 0 = off) free: task.js start refuses then
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

const commands = { add: addWorktree, integrate: integrateWorktree, remove: removeWorktree };

runCli(usage, { shared: { type: 'boolean' } }, ({ values, positionals: [cmd, id], root }) => {
  if (!commands[cmd] && cmd !== 'prune') throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = loadConfig({ pluginRoot, projectRoot: root });
  validateConfig(config);
  if (cmd === 'prune' && values.shared) {
    const r = pruneShared(root, config, { deleteRoots: checkDeleteRoots(config.deleteRoots) });
    if (!r.ok) process.exitCode = 1;
    return r;
  }
  if (cmd === 'prune') return pruneTaskBuilds(root, { worktreeRoot: config.worktreeRoot, deleteRoots: checkDeleteRoots(config.deleteRoots), ...(id ? { ids: [id] } : {}) });
  if (!id) throw new UsageError('Missing task id');
  return commands[cmd](root, id, { worktreeRoot: config.worktreeRoot });
});
