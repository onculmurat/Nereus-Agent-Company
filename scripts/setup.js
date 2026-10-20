#!/usr/bin/env node
// /nac:setup CLI. Always show the dry run to the owner before --apply.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig } from './lib/config.js';
import { planSetup, applySetup, planGlobalModelPointer, applyGlobalModelPointer, planClaudeMd, applyClaudeMd, planCompaction, applyCompaction, GUARD_START, GUARD_END } from './lib/setup.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = `Usage:
  node setup.js [--project <dir>] --dry-run
  node setup.js [--project <dir>] --apply
  node setup.js [--project <dir>] --guard-block   writes only the NAC block into the project CLAUDE.md (projects set up earlier)
  node setup.js [--project <dir>] --guard-block --dry-run   prints the block that would be written; writes nothing
                                         The owner runs --guard-block, typed in the prompt as "! node <path>/scripts/setup.js --guard-block":
                                         the auto-mode classifier blocks the lead from writing CLAUDE.md ("Self-Modification").
  node setup.js [--project <dir>] --compaction [--dry-run]   writes only autoCompactWindow and idleCompaction into .claude/settings.json (existing values stay)
                                         The owner runs it as "! node <path>/scripts/setup.js --compaction" if the lead is blocked from editing settings.
  node setup.js --global-model-pointer [--claude-md <file>]
  node setup.js --apply-global-model-pointer [--claude-md <file>]
`;

function describe(plan) {
  const rel = (p) => path.relative(plan.projectRoot, p).split(path.sep).join('/');
  const lines = [`Project: ${plan.projectRoot}`, ...plan.files.map((f) => `${f.action === 'create' ? 'create' : 'skip  '}  ${rel(f.path)}${f.action === 'create' ? '' : ' (exists)'}`)];
  const s = plan.settings;
  if (s.conflicts.length) lines.push(`CONFLICT  ${rel(s.path)}: ${s.conflicts.join(', ')} already set to a different value`);
  else if (JSON.stringify(s.before) !== JSON.stringify(s.after)) lines.push(`${s.before ? 'merge ' : 'create'}  ${rel(s.path)} (agent teams env, enable nac plugin, autoCompactWindow, idleCompaction)`);
  if (plan.gateCommands) lines.push(`write   team/config.json gateCommands: ${plan.gateCommands.map((c) => `${c.name} (${c.command})`).join(', ')}`);
  if (plan.claudeMd.before !== plan.claudeMd.after) lines.push(`${plan.claudeMd.before === null ? 'create' : 'merge '}  CLAUDE.md (NAC guard block)`);
  if (plan.gitignoreReplaces) lines.push(`change  .gitignore:\n- ${plan.gitignoreReplaces}\n+ ${plan.gitignoreLine}`);
  else if (plan.gitignoreLine) lines.push(`append  .gitignore:\n+ ${plan.gitignoreLine}`);
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
    'guard-block': { type: 'boolean' },
    compaction: { type: 'boolean' },
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
    if (values.compaction) {
      const root = path.resolve(values.project ?? process.cwd());
      const plan = planCompaction(root, { config: loadConfig({ pluginRoot, projectRoot: root }) });
      const changed = JSON.stringify(plan.before) !== JSON.stringify(plan.after);
      const keys = `autoCompactWindow=${plan.after.autoCompactWindow}, idleCompaction=${plan.after.idleCompaction}`;
      if (values['dry-run']) return `${changed ? 'would write' : 'already set, nothing would change in'} ${plan.path} (${keys}; nothing written)
`;
      applyCompaction(plan);
      return `${changed ? 'Updated' : 'Unchanged'} ${plan.path} (${keys})
`;
    }
    if (values['guard-block']) {
      const plan = planClaudeMd(path.resolve(values.project ?? process.cwd()), pluginRoot);
      if (values['dry-run']) {
        if (plan.before === plan.after) return `${plan.path} is already up to date; nothing would change.\n`;
        const block = plan.after.slice(plan.after.indexOf(GUARD_START), plan.after.indexOf(GUARD_END) + GUARD_END.length);
        return `${plan.before === null ? 'would create' : 'would update'} ${plan.path} with this block (nothing written):\n${block}\n`;
      }
      applyClaudeMd(plan);
      return `Updated ${plan.path}\n`;
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
