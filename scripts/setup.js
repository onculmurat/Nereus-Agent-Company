#!/usr/bin/env node
// /nac:setup CLI. Always show the dry run to the owner before --apply.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig } from './lib/config.js';
import { planSetup, applySetup, planGlobalModelPointer, applyGlobalModelPointer } from './lib/setup.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = `Usage:
  node setup.js [--project <dir>] --dry-run
  node setup.js [--project <dir>] --apply
  node setup.js --global-model-pointer [--claude-md <file>]
  node setup.js --apply-global-model-pointer [--claude-md <file>]
`;

function describe(plan) {
  const rel = (p) => path.relative(plan.projectRoot, p).split(path.sep).join('/');
  const lines = [`Project: ${plan.projectRoot}`, ...plan.files.map((f) => `${f.action === 'create' ? 'create' : 'skip  '}  ${rel(f.path)}${f.action === 'create' ? '' : ' (exists)'}`)];
  const s = plan.settings;
  if (s.conflicts.length) lines.push(`CONFLICT  ${rel(s.path)}: ${s.conflicts.join(', ')} already set to a different value`);
  else if (JSON.stringify(s.before) !== JSON.stringify(s.after)) lines.push(`${s.before ? 'merge ' : 'create'}  ${rel(s.path)} (agent teams env, enable nac plugin)`);
  if (plan.gitignoreLine) lines.push(`append  .gitignore: ${plan.gitignoreLine}`);
  if (plan.nodeWarning) lines.push(`WARNING  ${plan.nodeWarning}`);
  return `${lines.join('\n')}\n`;
}

runCli(
  usage,
  {
    'dry-run': { type: 'boolean' },
    apply: { type: 'boolean' },
    'global-model-pointer': { type: 'boolean' },
    'apply-global-model-pointer': { type: 'boolean' },
    'claude-md': { type: 'string' },
  },
  ({ values }) => {
    const claudeMd = values['claude-md'] ?? path.join(os.homedir(), '.claude', 'CLAUDE.md');
    if (values['global-model-pointer']) {
      const p = planGlobalModelPointer(claudeMd);
      return `File: ${p.path}\n--- before\n${p.before}\n--- after\n${p.after}`;
    }
    if (values['apply-global-model-pointer']) {
      applyGlobalModelPointer(planGlobalModelPointer(claudeMd));
      return `Updated ${claudeMd}\n`;
    }
    if (!values['dry-run'] && !values.apply) throw new UsageError('Pass --dry-run or --apply.');
    // Setup works on the folder it runs in, never on a parent NAC project, unless --project says otherwise.
    const root = path.resolve(values.project ?? process.cwd());
    const plan = planSetup(root, { pluginRoot, config: loadConfig({ pluginRoot, projectRoot: root }) });
    if (values['dry-run']) return describe(plan);
    applySetup(plan);
    return `Applied:\n${describe(plan)}\nNext: run /clear (or restart Claude Code) so this session loads the NAC lead instructions, then start phase 0.\n`;
  },
  { requireProject: false },
);
