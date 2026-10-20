// /nac:setup: plans (dry run) and applies the per-project setup. Never overwrites an existing file
// and never replaces an existing settings value; conflicts stop the apply.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { detectGateCommands } from './gate.js';
import { commitPaths, dirtyPaths, notIgnored } from './commit.js';

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

// g27: the auto-mode classifier refuses the lead's team-commit.js run ("Modify Shared Resources"), so every team
// commit fell to the owner. The project allows exactly that script, from the plugin root and from a directory
// marketplace source (the lead reads scripts from there), and nothing else.
export function marketplaceSources(file = path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json')) {
  try {
    const known = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return Object.values(known)
      .filter((m) => m?.source?.source === 'directory' && typeof m.source.path === 'string')
      .map((m) => m.source.path)
      .filter((p) => fs.existsSync(path.join(p, 'scripts', 'team-commit.js')));
  } catch {
    return [];
  }
}

// g33: task.js start and close commit team/ the same way, so they get the same rule.
export function teamCommitRules(pluginRoot, { sources = marketplaceSources() } = {}) {
  const rules = (root) => ['team-commit.js', 'task.js'].map((s) => `Bash(node "${String(root).replace(/\\/g, '/').replace(/\/+$/, '')}/scripts/${s}" *)`);
  return [...new Set([pluginRoot, ...sources].flatMap(rules))];
}

function addAllowRules(settings, rules) {
  settings.permissions ??= {};
  settings.permissions.allow ??= [];
  for (const r of rules) if (!settings.permissions.allow.includes(r)) settings.permissions.allow.push(r);
}

function planSettings(projectRoot, compaction = {}, rules = []) {
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
  if (rules.length) addAllowRules(after, rules);
  return { path: file, before, after, conflicts };
}

// Only the two compaction keys, for projects set up earlier (the owner runs it; the auto-mode classifier blocks the lead).
// g34: window replaces an existing autoCompactWindow (the owner lowers it so the lead compacts at task ends).
export function planCompaction(projectRoot, { config, window } = {}) {
  if (window !== undefined && (!Number.isInteger(window) || window < 100000)) throw new Error(`--window must be a whole number of at least 100000 tokens; got ${JSON.stringify(window)}`);
  const plan = planSettings(path.resolve(projectRoot), config?.compaction);
  const before = plan.before ?? {};
  const after = structuredClone(before);
  if (window !== undefined) after.autoCompactWindow = window;
  after.autoCompactWindow ??= plan.after.autoCompactWindow;
  after.idleCompaction ??= plan.after.idleCompaction;
  return { path: plan.path, before: plan.before, after };
}

// Only the team-commit allow rule, for projects set up earlier (the owner runs it; the classifier blocks the lead
// from editing its own permissions, "Self-Modification").
export function planPermissions(projectRoot, { pluginRoot, sources } = {}) {
  const file = path.join(path.resolve(projectRoot), '.claude', 'settings.json');
  const before = readJsonOrNull(file);
  const after = structuredClone(before ?? {});
  addAllowRules(after, teamCommitRules(pluginRoot, sources === undefined ? {} : { sources }));
  return { path: file, before, after };
}

export function applyPermissions(plan) {
  return writeAndCommit(plan, 'chore(nac): allow team-commit.js and task.js for the lead (g27, g33)', 'the allow rules');
}

// g29: only the owner sets the proxy (the classifier refuses a standing delegation the lead writes itself).
// session 'off' removes it.
export function planProxy(projectRoot, { session, until } = {}) {
  const file = path.join(path.resolve(projectRoot), 'team', 'config.json');
  const before = readJsonOrNull(file);
  const after = structuredClone(before ?? {});
  if (session === 'off') delete after.ownerProxy;
  else after.ownerProxy = { session, ...(until === undefined ? {} : { until }) };
  return { path: file, before, after };
}

export function applyProxy(plan) {
  const p = plan.after.ownerProxy;
  return writeAndCommit(plan, p ? `chore(nac): owner proxy ${p.session}${p.until ? ` until ${p.until}` : ''} (g29)` : 'chore(nac): owner proxy off (g29)', 'the owner proxy');
}

export function hasCompactionSettings(projectRoot) {
  try {
    return readJsonOrNull(path.join(projectRoot, '.claude', 'settings.json'))?.autoCompactWindow !== undefined;
  } catch {
    return true;
  }
}

// Serialises a JSON value the way the original file was written: same indentation (tab or N spaces), same line
// endings (CRLF or LF) and the same trailing-newline habit, so a two-key change is a two-line diff (g11).
export function formatLike(value, original) {
  const text = typeof original === 'string' ? original.replace(/^\uFEFF/, '') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /\n([\t ]+)\S/.exec(text.replace(/\r\n/g, '\n'))?.[1] ?? '  ';
  const trailing = text === '' || /\n$/.test(text) ? eol : '';
  return JSON.stringify(value, null, indent).replace(/\n/g, eol) + trailing;
}

const originalText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

// Writes the two keys and commits that one file as its own chore(nac) commit, so the PreCompact clean-tree check
// is not blocked by NAC's own change. Fail-open: when it cannot commit (no git, ignored file, owner edits already
// pending in the file) it leaves the file written and returns a warning. Returns { changed, committed, warning }.
export function applyCompaction(plan) {
  return writeAndCommit(plan, 'chore(nac): enable conditional compaction settings', 'the compaction keys');
}

function writeAndCommit(plan, message, what) {
  if (JSON.stringify(plan.before) === JSON.stringify(plan.after)) return { changed: false, committed: false };
  const dir = path.dirname(plan.path);
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  let dirtyBefore = null;
  try {
    if (fs.existsSync(dir)) dirtyBefore = git('status', '--porcelain', '--', plan.path) !== '';
  } catch {
    dirtyBefore = null; // not a git repository
  }
  const original = originalText(plan.path);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(plan.path, formatLike(plan.after, original));
  if (dirtyBefore === null) {
    try {
      git('rev-parse', '--is-inside-work-tree');
    } catch {
      return { changed: true, committed: false, warning: 'not committed: the project is not a git repository' };
    }
    dirtyBefore = false;
  }
  if (dirtyBefore) return { changed: true, committed: false, warning: `${path.basename(plan.path)} had uncommitted edits already; ${what} ${what.endsWith('keys') ? 'are' : 'is'} written but not committed. Commit it yourself, or the PreCompact clean-tree check waits for the ceiling.` };
  try {
    git('add', '--', plan.path);
    git('commit', '-q', '-m', message, '--', plan.path);
    return { changed: true, committed: true };
  } catch (e) {
    return { changed: true, committed: false, warning: `not committed (${String(e.stderr || e.message).trim().split('\n')[0]}). Commit ${path.basename(plan.path)} yourself so the PreCompact clean-tree check passes.` };
  }
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
  // g18: default gate checks for the detected stack, only when the config has no gate choice yet.
  let gateCommands = null;
  try {
    const cfgFile = path.join(root, 'team', 'config.json');
    const existing = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^﻿/, '')) : {};
    const found = detectGateCommands(root);
    if (existing.gateCommands === undefined && existing.testCommand === undefined && found.length) gateCommands = found;
  } catch {
    gateCommands = null;
  }
  const major = Number(process.versions.node.split('.')[0]);
  return {
    projectRoot: root,
    files,
    settings: planSettings(root, config.compaction, teamCommitRules(pluginRoot)),
    gateCommands,
    claudeMd: planClaudeMd(root, pluginRoot),
    // gitignoreLine: the line to write; gitignoreReplaces: the older whole-folder line it takes the place of.
    gitignoreLine: ignored && !old ? null : GITIGNORE_LINE,
    gitignoreReplaces: old,
    nodeWarning: major < 20 ? `Node.js ${process.versions.node} found; NAC needs Node.js 20 or newer.` : null,
  };
}

// Files the plan would create or change, for the setup commit (absolute paths).
function plannedFiles(plan) {
  const out = plan.files.filter((f) => f.action === 'create').map((f) => f.path);
  if (JSON.stringify(plan.settings.before) !== JSON.stringify(plan.settings.after)) out.push(plan.settings.path);
  const cfg = path.join(plan.projectRoot, 'team', 'config.json');
  if (plan.gateCommands && !out.includes(cfg)) out.push(cfg);
  if (plan.claudeMd.before !== plan.claudeMd.after) out.push(plan.claudeMd.path);
  if (plan.gitignoreLine) out.push(path.join(plan.projectRoot, '.gitignore'));
  return out;
}

// Applies the plan, then commits exactly the files it created or changed as one chore(nac) commit (g11 follow-up), so
// the PreCompact and other clean-tree checks are not tripped by NAC's own scaffolding. Fail-open: outside git, or for a
// file that already had uncommitted edits, it leaves the files written, commits what it safely can and returns a warning.
// Returns { committed, sha?, warning? }.
export function applySetup(plan) {
  if (plan.settings.conflicts.length) {
    throw new Error(`Settings conflict in ${plan.settings.path}: ${plan.settings.conflicts.join(', ')}. Resolve it, then run setup again.`);
  }
  const touched = plannedFiles(plan);
  let before = { git: false, dirty: [] };
  try {
    before = dirtyPaths(plan.projectRoot, touched.filter((f) => fs.existsSync(f)));
  } catch { /* the commit is optional */ }
  writeSetup(plan);
  if (!touched.length) return { committed: false };
  try {
    const dirty = new Set(before.dirty);
    const rel = (f) => path.relative(plan.projectRoot, f).split(path.sep).join('/');
    const wanted = notIgnored(plan.projectRoot, touched.filter((f) => !dirty.has(f) && fs.existsSync(f))).map(rel);
    // team/ files are listed individually: a directory pathspec would also take the owner's other team/ files.
    const result = wanted.length || !before.git ? commitPaths(plan.projectRoot, wanted, 'chore(nac): set up NAC (team scaffolding, settings, guard block)') : { committed: false };
    const skipped = before.dirty.map(rel);
    if (skipped.length) return { ...result, warning: `${skipped.join(', ')} had uncommitted edits already; written but not committed. Commit ${skipped.length > 1 ? 'them' : 'it'} yourself so the clean-tree checks pass.${result.warning ? ` ${result.warning}` : ''}` };
    return result;
  } catch (e) {
    return { committed: false, warning: `not committed (${e.message})` };
  }
}

function writeSetup(plan) {
  for (const f of plan.files) {
    if (f.action !== 'create') continue;
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.copyFileSync(f.source, f.path, fs.constants.COPYFILE_EXCL);
  }
  if (JSON.stringify(plan.settings.before) !== JSON.stringify(plan.settings.after)) {
    fs.mkdirSync(path.dirname(plan.settings.path), { recursive: true });
    fs.writeFileSync(plan.settings.path, formatLike(plan.settings.after, originalText(plan.settings.path)));
  }
  if (plan.gateCommands) {
    const cfgFile = path.join(plan.projectRoot, 'team', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^﻿/, ''));
    cfg.gateCommands = plan.gateCommands;
    fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}
`);
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
