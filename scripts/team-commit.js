#!/usr/bin/env node
// Team-state commit (lead only): commits team/ with a team/-only pathspec, so a developer's staged code in the shared
// index is never swept into a chore(team) commit (D-227).
import { runCli, need, UsageError } from './lib/cli.js';
import { commitPaths } from './lib/commit.js';

const usage = `Usage:
  team-commit.js --message <text> [--path <dir-or-file>]...   commit team/ (or the given paths under the project) with a pathspec
                                         anything else that is staged stays staged and is not part of the commit
  (accepts --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, { message: { type: 'string' }, path: { type: 'string', multiple: true } }, ({ values: v, root }) => {
  need(v, 'message');
  if (!v.message.trim()) throw new UsageError('--message must not be empty');
  const result = commitPaths(root, v.path?.length ? v.path : ['team'], v.message);
  if (result.warning) process.stderr.write(`${result.warning}\n`);
  return result;
});
