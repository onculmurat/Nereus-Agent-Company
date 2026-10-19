#!/usr/bin/env node
// Context pack CLI (lead only): builds team/work/packs/<id>-<role>.md and prints its path and size.
import { runCli, need, UsageError } from './lib/cli.js';
import { writePack } from './lib/pack.js';

const usage = `Usage:
  pack.js <task-id> --role <role> [--base <sha>] [--gate <file>] [--paths <p1,p2>] [--allow-large]
  pack.js <task-id> --role <role> --round <n> --base <sha> (--findings <file> | --gate <file>)
                                         brief + the spec, contract, threat and decision text it names;
                                         --base adds git diff <sha>, --gate adds the tail of a gate output file
                                         delta (fix rounds, re-reviews): the findings or gate output, the diff since
                                         the previous attempt (<sha>) and the acceptance criteria only
                                         the diff never holds team/; --paths limits it to those paths (comma separated).
                                         A pack up to 25% over packMaxChars (default 60000) is accepted with a note; above that
                                         the test files of the diff are left out and named (testsLeftOut); a pack still over 125% is written but exits 3 with a warning
                                         on stderr: narrow it with --paths or a later --base; --allow-large accepts it.
  (accepts --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, { role: { type: 'string' }, base: { type: 'string' }, gate: { type: 'string' }, round: { type: 'string' }, findings: { type: 'string' }, paths: { type: 'string' }, 'allow-large': { type: 'boolean' } }, ({ values: v, positionals: [id], root }) => {
  if (!id) throw new UsageError('Missing task id');
  need(v, 'role');
  const { path: file, chars, notFound, limit, tooLarge, testsLeftOut, note } = writePack(root, { id, role: v.role, base: v.base, gate: v.gate, round: v.round === undefined ? undefined : Number(v.round), findings: v.findings, paths: v.paths });
  if (tooLarge && !v['allow-large']) {
    process.stderr.write(`WARNING: pack is ${chars} characters, over the limit of ${limit} (packMaxChars). Do not dispatch it as is: narrow the diff with --paths <code paths> or a later --base, then build it again. --allow-large accepts it deliberately.
`);
    process.exitCode = 3;
  }
  if (note) process.stderr.write(`NOTE: ${note}\n`);
  return { path: file, chars, notFound, ...(testsLeftOut ? { testsLeftOut } : {}), ...(note ? { note } : {}) };
});
