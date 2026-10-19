#!/usr/bin/env node
// Worktree CLI (lead only): add | integrate | remove, for tasks that run in parallel with another implementer.
import { runCli, UsageError } from './lib/cli.js';
import { addWorktree, integrateWorktree, removeWorktree } from './lib/worktree.js';

const usage = `Usage:
  worktree.js add <task-id>              new worktree <repo>-wt/<id> on branch task/<id> from the current commit
  worktree.js integrate <task-id>        cherry-pick the task's commits onto the current branch (aborts on conflict)
  worktree.js remove <task-id>           remove the worktree and delete branch task/<id>
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

const commands = { add: addWorktree, integrate: integrateWorktree, remove: removeWorktree };

runCli(usage, {}, ({ positionals: [cmd, id], root }) => {
  if (!commands[cmd]) throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  if (!id) throw new UsageError('Missing task id');
  return commands[cmd](root, id);
});
