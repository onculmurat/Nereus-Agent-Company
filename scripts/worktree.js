#!/usr/bin/env node
// Worktree CLI (lead only): add | integrate | remove, for tasks that run in parallel with another implementer.
import { runCli, UsageError } from './lib/cli.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig } from './lib/config.js';
import { addWorktree, integrateWorktree, removeWorktree } from './lib/worktree.js';

const usage = `Usage:
  worktree.js add <task-id>              new worktree <repo>-wt/<id> on branch task/<id> from the current commit
                                         (config worktreeRoot: <worktreeRoot>/<repo>-wt/<id>); prints the path for board.js update --worktree
                                         and the target path (target-<id> beside it) for a build dir kept outside the worktree
  worktree.js integrate <task-id>        cherry-pick the task's commits onto the current branch (aborts on conflict)
  worktree.js remove <task-id>           remove the worktree (the one the board records, else the path above), delete branch task/<id>
                                         and the task build dirs target-<id>[-suffix] beside it
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

const commands = { add: addWorktree, integrate: integrateWorktree, remove: removeWorktree };

runCli(usage, {}, ({ positionals: [cmd, id], root }) => {
  if (!commands[cmd]) throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  if (!id) throw new UsageError('Missing task id');
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = loadConfig({ pluginRoot, projectRoot: root });
  validateConfig(config);
  return commands[cmd](root, id, { worktreeRoot: config.worktreeRoot });
});
