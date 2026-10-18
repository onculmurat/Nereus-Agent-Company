// /nac:setup: plans (dry run) and applies the per-project setup. Never overwrites an existing file
// and never replaces an existing settings value; conflicts stop the apply.
import fs from 'node:fs';
import path from 'node:path';

export const PLUGIN_KEY = 'nac@nereus-agent-company';
const TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
const GITIGNORE_LINE = 'team/work/';
const DOCUMENTS = {
  memory: ['memory.md', 'memory.md'],
  plan: ['plan.md', 'plan.md'],
  articleDev: ['article_dev.md', 'article_dev.md'],
  setupRequirements: ['setup-requirements.md', path.join('docs', 'setup-requirements.md')],
};
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
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Invalid JSON in ${file}; fix it before setup`);
  }
}

function planSettings(projectRoot) {
  const file = path.join(projectRoot, '.claude', 'settings.json');
  const before = readJsonOrNull(file);
  const after = structuredClone(before ?? {});
  const conflicts = [];
  const want = (obj, key, value, label) => {
    if (obj[key] !== undefined && obj[key] !== value) conflicts.push(label);
    else obj[key] = value;
  };
  after.env ??= {};
  want(after.env, TEAMS_ENV, '1', `env.${TEAMS_ENV}`);
  after.enabledPlugins ??= {};
  want(after.enabledPlugins, PLUGIN_KEY, true, `enabledPlugins.${PLUGIN_KEY}`);
  return { path: file, before, after, conflicts };
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
  const ignored = fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf8').split(/\r?\n/).some((l) => l.trim() === GITIGNORE_LINE);
  const major = Number(process.versions.node.split('.')[0]);
  return {
    projectRoot: root,
    files,
    settings: planSettings(root),
    gitignoreLine: ignored ? null : GITIGNORE_LINE,
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
  if (plan.gitignoreLine) {
    const file = path.join(plan.projectRoot, '.gitignore');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${current}${sep}${plan.gitignoreLine}\n`);
  }
}

export function planGlobalModelPointer(claudeMdPath, { pluginRoot }) {
  const before = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
  const block = [
    BLOCK_START,
    '# Model selection',
    'Role models come from the NAC plugin model table (single source of truth):',
    `${path.join(pluginRoot, 'defaults', 'config.json')}, overridable in ~/.claude/nac/config.json and in each project's team/config.json.`,
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
