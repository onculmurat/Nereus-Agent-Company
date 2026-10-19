#!/usr/bin/env node
// Context pack CLI (lead only): builds team/work/packs/<id>-<role>.md and prints its path and size.
import { runCli, need, UsageError } from './lib/cli.js';
import { writePack } from './lib/pack.js';

const usage = `Usage:
  pack.js <task-id> --role <role> [--base <sha>] [--gate <file>]
  pack.js <task-id> --role <role> --round <n> --base <sha> (--findings <file> | --gate <file>)
                                         brief + the spec, contract, threat and decision text it names;
                                         --base adds git diff <sha>, --gate adds the tail of a gate output file
                                         delta (fix rounds, re-reviews): the findings or gate output, the diff since
                                         the previous attempt (<sha>) and the acceptance criteria only
  (accepts --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, { role: { type: 'string' }, base: { type: 'string' }, gate: { type: 'string' }, round: { type: 'string' }, findings: { type: 'string' } }, ({ values: v, positionals: [id], root }) => {
  if (!id) throw new UsageError('Missing task id');
  need(v, 'role');
  const { path: file, chars, notFound } = writePack(root, { id, role: v.role, base: v.base, gate: v.gate, round: v.round === undefined ? undefined : Number(v.round), findings: v.findings });
  return { path: file, chars, notFound };
});
