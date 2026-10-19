// /nac:setup: plans (dry run) and applies the per-project setup. Never overwrites an existing file
// and never replaces an existing settings value; conflicts stop the apply.
import fs from 'node:fs';
import path from 'node:path';

export const PLUGIN_KEY = 'nac@nereus-agent-company';
const TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
// Only the generated context packs are ignored; the rest of team/work/ (board, briefs, hand-offs, mailbox) is committed.
const GITIGNORE_LINE = 'team/work/packs/';
// An older setup ignored the whole folder; that line is replaced.
const OLD_GITIGNORE_LINES = new Set(['team/work/', 'team/work', '/team/work/', '/team/work']);
const DOCUMENTS = {
  memory: ['memory.md', 'memory.md'],
  plan: ['plan.md', 'plan.md'],
  articleDev: ['article_dev.md', 'article_dev.md'],
  setupRequirements: ['setup-requirements.md', path.join('docs', 'setup-requirements.md')],
};
export const GUARD_START = '<!-- nac:guard:start -->';
export const GUARD_END = '<!-- nac:guard:end -->';
const BLOCK_START = '<!-- nac:models -->';
const BLOCK_END = '<!-- /nac:models -->';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [full];
  });
}

function readJsonOrNull(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    throw new Error(`Invalid JSON in ${file}; fix it before setup`);
  }
}

function planSettings(projectRoot, compaction = {}) {
  const file = path.join(projectRoot, '.claude', 'settings.json');
  const before = readJsonOrNull(file);
  const after = structuredClone(before ?? {});
  const conflicts = [];
  // 1, "1" and true all mean "on"; an existing equivalent value is kept as it is.
  const on = (v) => v === true || v === 1 || v === '1';
  const want = (obj, key, value, label) => {
    if (obj[key] === undefined) obj[key] = value;
    else if (obj[key] !== value && !(on(obj[key]) && on(value))) conflicts.push(label);
  };
  after.env ??= {};
  want(after.env, TEAMS_ENV, '1', `env.${TEAMS_ENV}`);
  after.enabledPlugins ??= {};
  want(after.enabledPlugins, PLUGIN_KEY, true, `enabledPlugins.${PLUGIN_KEY}`);
  // Conditional compaction: an existing value of the owner is kept, never a conflict.
  if (after.autoCompactWindow === undefined) after.autoCompactWindow = compaction.autoCompactWindow ?? 200000;
  if (after.idleCompaction === undefined) after.idleCompaction = false;
  return { path: file, before, after, conflicts };
}

// Only the two compaction keys, for projects set up earlier (the owner runs it; the auto-mode classifier blocks the lead).
export function planCompaction(projectRoot, { config } = {}) {
  const plan = planSettings(path.resolve(projectRoot), config?.compaction);
  const before = plan.before ?? {};
  const after = structuredClone(before);
  after.autoCompactWindow ??= plan.after.autoCompactWindow;
  after.idleCompaction ??= plan.after.idleCompaction;
  return { path: plan.path, before: plan.before, after };
}

export function hasCompactionSettings(projectRoot) {
  try {
    return readJsonOrNull(path.join(projectRoot, '.claude', 'settings.json'))?.autoCompactWindow !== undefined;
  } catch {
    return true;
  }
}

export function applyCompaction(plan) {
  if (JSON.stringify(plan.before) === JSON.stringify(plan.after)) return;
  fs.mkdirSync(path.dirname(plan.path), { recursive: true });
  fs.writeFileSync(plan.path, `${JSON.stringify(plan.after, null, 2)}
`);
}

// The project CLAUDE.md block that still works when the plugin is not loaded and no hook runs.
function guardBlock(pluginRoot) {
  return [
    GUARD_START,
    '## NAC',
    "This project is run by NAC (Nereus Agent Company). If this session's context does not contain the marker `NAC-LEAD-ACTIVE`, NAC is not loaded:",
    'do not act as lead, do not dispatch or edit team/ files, and tell the owner NAC is not loaded. To restore it:',
    `\`claude plugin marketplace add "${pluginRoot.split(path.sep).join('/')}"\` then \`claude plugin install nac@nereus-agent-company\`.`,
    GUARD_END,
  ].join('\n');
}

export function hasGuardBlock(projectRoot) {
  const file = path.join(projectRoot, 'CLAUDE.md');
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(GUARD_START);
}

// Adds or replaces the guard block in the project CLAUDE.md; everything outside the markers stays as it is.
export function planClaudeMd(projectRoot, pluginRoot) {
  const file = path.join(path.resolve(projectRoot), 'CLAUDE.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const block = guardBlock(pluginRoot);
  const text = before ?? '';
  const start = text.indexOf(GUARD_START);
  const end = text.indexOf(GUARD_END);
  let after;
  if (start >= 0 && end > start) after = text.slice(0, start) + block + text.slice(end + GUARD_END.length);
  else after = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`;
  return { path: file, before, after };
}

export function applyClaudeMd(plan) {
  if (plan.before !== plan.after) fs.writeFileSync(plan.path, plan.after);
}

export function planSetup(projectRoot, { pluginRoot, config }) {
  const root = path.resolve(projectRoot);
  const templates = path.join(pluginRoot, 'templates');
  const files = walk(path.join(templates, 'team')).map((source) => ({
    source,
    path: path.join(root, 'team', path.relative(path.join(templates, 'team'), source)),
  }));
  for (const [toggle, [template, target]] of Object.entries(DOCUMENTS)) {
    if (config.documents?.[toggle]) files.push({ source: path.join(templates, 'docs', template), path: path.join(root, target) });
  }
  for (const f of files) f.action = fs.existsSync(f.path) ? 'skip-exists' : 'create';

  const gitignore = path.join(root, '.gitignore');
  const lines = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const ignored = lines.includes(GITIGNORE_LINE);
  const old = lines.find((l) => OLD_GITIGNORE_LINES.has(l)) ?? null;
  const major = Number(process.versions.node.split('.')[0]);
  return {
    projectRoot: root,
    files,
    settings: planSettings(root, config.compaction),
    claudeMd: planClaudeMd(root, pluginRoot),
    // gitignoreLine: the line to write; gitignoreReplaces: the older whole-folder line it takes the place of.
    gitignoreLine: ignored && !old ? null : GITIGNORE_LINE,
    gitignoreReplaces: old,
    nodeWarning: major < 20 ? `Node.js ${process.versions.node} found; NAC needs Node.js 20 or newer.` : null,
  };
}

export function applySetup(plan) {
  if (plan.settings.conflicts.length) {
    throw new Error(`Settings conflict in ${plan.settings.path}: ${plan.settings.conflicts.join(', ')}. Resolve it, then run setup again.`);
  }
  for (const f of plan.files) {
    if (f.action !== 'create') continue;
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.copyFileSync(f.source, f.path, fs.constants.COPYFILE_EXCL);
  }
  if (JSON.stringify(plan.settings.before) !== JSON.stringify(plan.settings.after)) {
    fs.mkdirSync(path.dirname(plan.settings.path), { recursive: true });
    fs.writeFileSync(plan.settings.path, `${JSON.stringify(plan.settings.after, null, 2)}\n`);
  }
  applyClaudeMd(plan.claudeMd);
  if (plan.gitignoreLine) {
    const file = path.join(plan.projectRoot, '.gitignore');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (plan.gitignoreReplaces) {
      // Replace the old line in place (or drop it when the new line is already there); keep every other line and the line endings.
      const had = current.split(/\r?\n/).some((l) => l.trim() === plan.gitignoreLine);
      const next = current.split('\n').flatMap((l) => {
        if (!OLD_GITIGNORE_LINES.has(l.trim())) return [l];
        return had ? [] : [l.replace(l.trim(), plan.gitignoreLine)];
      });
      fs.writeFileSync(file, next.join('\n'));
      return;
    }
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${current}${sep}${plan.gitignoreLine}\n`);
  }
}

// The installed plugin path changes with every version, so the pointer names the file, not the path.
export function planGlobalModelPointer(claudeMdPath) {
  const before = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
  const block = [
    BLOCK_START,
    '# Model selection',
    'Role models come from the NAC plugin model table (single source of truth):',
    "defaults/config.json in the installed NAC plugin, overridable in ~/.claude/nac/config.json and in each project's team/config.json.",
    BLOCK_END,
  ].join('\n');
  const start = before.indexOf(BLOCK_START);
  const end = before.indexOf(BLOCK_END);
  let after;
  if (start >= 0 && end > start) after = before.slice(0, start) + block + before.slice(end + BLOCK_END.length);
  else after = `${before}${before && !before.endsWith('\n') ? '\n' : ''}${before ? '\n' : ''}${block}\n`;
  return { path: claudeMdPath, before, after };
}

export function applyGlobalModelPointer({ path: file, after }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
}
