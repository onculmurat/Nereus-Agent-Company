#!/usr/bin/env node
// Findings ledger CLI (lead only): add | list | close | amend | pack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, need, UsageError } from './lib/cli.js';
import { addFinding, listFindings, closeFinding, amendFinding, packFindings } from './lib/findings.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const usage = `Usage:
  findings.js add --module <m> --file <path> --line <n> [--symbol <name>] --severity blocker|hardening|minor
                  --class observed|known|theoretical --task <id> --text <text> [--origin hardening] [--migrated]
                                         records a finding in team/findings/<m>.md; prints it with the open count of the
                                         module, the counted number and hardeningDue (counted >= findingsBatch, default 8): ask the planner for a hardening task.
                                         Only open non-minor findings count; --migrated (bulk import of old items) and --origin hardening
                                         (found while reviewing a hardening task: deferred to phase end) are kept but not counted
  findings.js list [--module <m>] [--open]
  findings.js close <F-id> --commit <sha>
  findings.js amend <F-id> [--file <path>] [--line <n>] [--symbol <name>]
                                         corrects the address of an open finding (the same checks as add); never edit the ledger by hand
  findings.js pack --module <m> [--ids <F-1,F-2>] [--context <n>]
                                         writes team/work/packs/<m>-hardening.md: per open finding its text, file:line with
                                         +-n lines (default 15), the other lines that reference the symbol (or the enclosing
                                         function) and the tests that reference it. Nothing else from the module.
                                         --ids limits it to those open findings of the module.
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

runCli(usage, {
  module: { type: 'string' }, file: { type: 'string' }, line: { type: 'string' }, symbol: { type: 'string' }, severity: { type: 'string' },
  class: { type: 'string' }, task: { type: 'string' }, text: { type: 'string' }, origin: { type: 'string' }, migrated: { type: 'boolean' }, open: { type: 'boolean' }, commit: { type: 'string' }, context: { type: 'string' },
  ids: { type: 'string' },
}, ({ values: v, positionals: [cmd, id], root }) => {
  switch (cmd) {
    case 'add':
      need(v, 'module', 'file', 'line', 'severity', 'class', 'task', 'text');
      return addFinding(root, { ...v, pluginRoot });
    case 'list':
      return listFindings(root, { module: v.module, open: v.open });
    case 'close':
      if (!id) throw new UsageError('Missing finding id');
      need(v, 'commit');
      return closeFinding(root, id, { commit: v.commit });
    case 'amend':
      if (!id) throw new UsageError('Missing finding id');
      return amendFinding(root, id, { file: v.file, line: v.line, symbol: v.symbol });
    case 'pack':
      need(v, 'module');
      return packFindings(root, v.module, {
        context: v.context === undefined ? undefined : Number(v.context),
        ids: v.ids === undefined ? undefined : v.ids.split(',').map((s) => s.trim()).filter(Boolean),
      });
    default:
      throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  }
});
