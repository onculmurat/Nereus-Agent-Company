#!/usr/bin/env node
// /nac:setup CLI. Always show the dry run to the owner before --apply.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { planSetup, applySetup, planGlobalModelPointer, applyGlobalModelPointer, planClaudeMd, applyClaudeMd, planCompaction, applyCompaction, planPermissions, applyPermissions, planProxy, applyProxy, GUARD_START, GUARD_END } from './lib/setup.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = `Usage:
  node setup.js [--project <dir>] --dry-run
  node setup.js [--project <dir>] --apply   writes the setup, then commits exactly the files it created or changed as chore(nac)
                                         (warns instead when outside git or when one of them had uncommitted edits)
  node setup.js [--project <dir>] --guard-block   writes only the NAC block into the project CLAUDE.md (projects set up earlier)
  node setup.js [--project <dir>] --guard-block --dry-run   prints the block that would be written; writes nothing
                                         The owner runs --guard-block, typed in the prompt as "! node <path>/scripts/setup.js --guard-block":
                                         the auto-mode classifier blocks the lead from writing CLAUDE.md ("Self-Modification").
  node setup.js [--project <dir>] --compaction [--dry-run]   writes only autoCompactWindow and idleCompaction into .claude/settings.json (existing values stay),
                                         keeps the file's line endings and indentation, and commits that one file as chore(nac) (warns instead when it cannot)
                                         The owner runs it as "! node <path>/scripts/setup.js --compaction" if the lead is blocked from editing settings.
                                         --window <n> (at least 100000) replaces an existing autoCompactWindow: 100000 lets the lead compact at the
                                         end of each task (g34) instead of growing to the ceiling
  node setup.js [--project <dir>] --permissions [--dry-run]   adds only the allow rules for team-commit.js and task.js to .claude/settings.json (g27, g33),
                                         keeps formatting and commits that one file as chore(nac). The owner runs it as
                                         "! node <path>/scripts/setup.js --permissions": the classifier blocks the lead from editing its permissions.
  node setup.js [--project <dir>] --proxy <session> [--until YYYY-MM-DD [--full]] [--dry-run]   sets the owner proxy in team/config.json (g29);
                                         --full (g110, needs --until) also hands it merge, spending, irreversible steps and deleting data
                                         and commits that one file; --proxy off removes it. Every lead session then sends owner
                                         questions to that session by SendMessage instead of AskUserQuestion. The owner runs it with "!".
  node setup.js --global-model-pointer [--claude-md <file>]
  node setup.js --apply-global-model-pointer [--claude-md <file>]
`;

function describe(plan) {
  const rel = (p) => path.relative(plan.projectRoot, p).split(path.sep).join('/');
  const lines = [`Project: ${plan.projectRoot}`, ...plan.files.map((f) => `${f.action === 'create' ? 'create' : 'skip  '}  ${rel(f.path)}${f.action === 'create' ? '' : ' (exists)'}`)];
  const s = plan.settings;
  if (s.conflicts.length) lines.push(`CONFLICT  ${rel(s.path)}: ${s.conflicts.join(', ')} already set to a different value`);
  else if (JSON.stringify(s.before) !== JSON.stringify(s.after)) lines.push(`${s.before ? 'merge ' : 'create'}  ${rel(s.path)} (agent teams env, enable nac plugin, autoCompactWindow, idleCompaction, team-commit.js allow rule)`);
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
    window: { type: 'string' },
    permissions: { type: 'boolean' },
    proxy: { type: 'string' },
    until: { type: 'string' },
    full: { type: 'boolean' },
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
      const plan = planCompaction(root, { config: loadConfig({ pluginRoot, projectRoot: root }), window: values.window === undefined ? undefined : Number(values.window) });
      const changed = JSON.stringify(plan.before) !== JSON.stringify(plan.after);
      const keys = `autoCompactWindow=${plan.after.autoCompactWindow}, idleCompaction=${plan.after.idleCompaction}`;
      if (values['dry-run']) return `${changed ? 'would write' : 'already set, nothing would change in'} ${plan.path} (${keys}; nothing written)
`;
      const done = applyCompaction(plan);
      if (done.warning) process.stderr.write(`WARNING  ${done.warning}
`);
      return `${changed ? 'Updated' : 'Unchanged'} ${plan.path} (${keys})${done.committed ? '; committed as chore(nac)' : ''}
`;
    }
    if (values.proxy !== undefined) {
      const root = path.resolve(values.project ?? process.cwd());
      if (values.proxy === 'off' && values.until !== undefined) throw new UsageError('--until goes with a proxy session, not with off.');
      if (values.full && (values.proxy === 'off' || values.until === undefined)) throw new UsageError('--full needs a proxy session and --until: a full proxy is always time-bound (g110).');
      const plan = planProxy(root, { session: values.proxy, until: values.until, full: values.full });
      validateConfig({ ...loadConfig({ pluginRoot, projectRoot: root }), ownerProxy: plan.after.ownerProxy });
      const changed = JSON.stringify(plan.before) !== JSON.stringify(plan.after) || plan.extra.some((x) => x.before !== x.after);
      const what = plan.after.ownerProxy ? `ownerProxy ${JSON.stringify(plan.after.ownerProxy)}` : 'no ownerProxy';
      if (values['dry-run']) return `${changed ? 'would write' : 'already set, nothing would change in'} ${plan.path} (${what}; nothing written)
`;
      const done = applyProxy(plan);
      if (done.warning) process.stderr.write(`WARNING  ${done.warning}
`);
      return `${changed ? 'Updated' : 'Unchanged'} ${plan.path} (${what})${done.committed ? '; committed as chore(nac)' : ''}
`;
    }
    if (values.permissions) {
      const plan = planPermissions(path.resolve(values.project ?? process.cwd()), { pluginRoot });
      const changed = JSON.stringify(plan.before) !== JSON.stringify(plan.after);
      const rules = plan.after.permissions.allow.filter((r) => /scripts\/(team-commit|task)\.js/.test(r)).join(', ');
      if (values['dry-run']) return `${changed ? 'would write' : 'already set, nothing would change in'} ${plan.path} (${rules}; nothing written)\n`;
      const done = applyPermissions(plan);
      if (done.warning) process.stderr.write(`WARNING  ${done.warning}\n`);
      return `${changed ? 'Updated' : 'Unchanged'} ${plan.path} (${rules})${done.committed ? '; committed as chore(nac)' : ''}\n`;
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
    const done = applySetup(plan);
    if (done.warning) process.stderr.write(`WARNING  ${done.warning}\n`);
    return `Applied${done.committed ? ' and committed as chore(nac)' : ''}:\n${describe(plan)}\nNext: run /clear (or restart Claude Code) so this session loads the NAC lead instructions, then start phase 0.\n`;
  },
  { requireProject: false },
);
