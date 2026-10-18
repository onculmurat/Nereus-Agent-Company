import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planSetup, applySetup, planGlobalModelPointer } from '../scripts/lib/setup.js';
import { loadConfig } from '../scripts/lib/config.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null });
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nac setup '));
const plan = (dir, cfg = config) => planSetup(dir, { pluginRoot, config: cfg });
const rel = (dir, files) => files.map((f) => path.relative(dir, f.path).split(path.sep).join('/')).sort();

test('dry run lists every file as create and writes nothing', () => {
  const dir = fresh();
  const p = plan(dir);
  assert.ok(p.files.every((f) => f.action === 'create'));
  assert.deepEqual(rel(dir, p.files), [
    'article_dev.md', 'docs/setup-requirements.md', 'memory.md', 'plan.md',
    'team/brief.md', 'team/config.json', 'team/contracts/README.md', 'team/decisions.md', 'team/glossary.md',
    'team/research/.gitkeep', 'team/work/archive/.gitkeep', 'team/work/board.md', 'team/work/escalations/.gitkeep',
    'team/work/handoffs/.gitkeep', 'team/work/mailbox/.gitkeep',
  ]);
  assert.equal(p.gitignoreLine, 'team/work/');
  assert.equal(p.settings.before, null);
  assert.equal(p.settings.after.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  assert.equal(p.settings.after.enabledPlugins['nac@nereus-agent-company'], true);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('apply creates files; a second run changes nothing', () => {
  const dir = fresh();
  applySetup(plan(dir));
  assert.ok(fs.existsSync(path.join(dir, 'team', 'config.json')));
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^team\/work\/$/m);
  const settingsFile = path.join(dir, '.claude', 'settings.json');
  const before = fs.readdirSync(dir, { recursive: true }).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]);
  const again = plan(dir);
  assert.ok(again.files.every((f) => f.action === 'skip-exists'));
  assert.equal(again.gitignoreLine, null);
  applySetup(again);
  const after = fs.readdirSync(dir, { recursive: true }).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]);
  assert.deepEqual(after, before);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').match(/team\/work\//g).length, 1);
  assert.ok(fs.existsSync(settingsFile));
});

test('existing settings keep their own env and hooks', () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, '.claude'));
  const hooks = { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] };
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { FOO: '1' }, hooks }));
  applySetup(plan(dir));
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.env.FOO, '1');
  assert.equal(s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  assert.deepEqual(s.hooks, hooks);
});

test('a conflicting value is reported and apply refuses', () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } }));
  const p = plan(dir);
  assert.deepEqual(p.settings.conflicts, ['env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS']);
  assert.throws(() => applySetup(p), /conflict/i);
  assert.ok(!fs.existsSync(path.join(dir, 'team')));
});

test('invalid settings JSON stops setup with the path', () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ broken');
  assert.throws(() => plan(dir), (e) => e.message.includes(`Invalid JSON in ${path.join(dir, '.claude', 'settings.json')}`));
});

test('document toggles skip disabled documents', () => {
  const dir = fresh();
  const cfg = { ...config, documents: { ...config.documents, articleDev: false } };
  assert.ok(!rel(dir, plan(dir, cfg).files).includes('article_dev.md'));
});

test('existing project documents are never overwritten', () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, 'memory.md'), 'mine');
  const p = plan(dir);
  assert.equal(p.files.find((f) => f.path === path.join(dir, 'memory.md')).action, 'skip-exists');
  applySetup(p);
  assert.equal(fs.readFileSync(path.join(dir, 'memory.md'), 'utf8'), 'mine');
});

test('global model pointer replaces only the marked block', () => {
  const file = path.join(fresh(), 'CLAUDE.md');
  fs.writeFileSync(file, '# Mine\nkeep\n<!-- nac:models -->\nold\n<!-- /nac:models -->\n# Other\nkeep too\n');
  const { before, after } = planGlobalModelPointer(file, { pluginRoot });
  assert.match(before, /old/);
  assert.doesNotMatch(after, /\nold\n/);
  assert.match(after, /^# Mine\nkeep\n<!-- nac:models -->/);
  assert.match(after, /<!-- \/nac:models -->\n# Other\nkeep too\n$/);
  assert.match(after, /defaults\/config\.json|defaults\\config\.json/);
});

test('global model pointer is appended when there is no block', () => {
  const file = path.join(fresh(), 'CLAUDE.md');
  fs.writeFileSync(file, '# Mine\n');
  const { after } = planGlobalModelPointer(file, { pluginRoot });
  assert.match(after, /^# Mine\n\n<!-- nac:models -->[\s\S]*<!-- \/nac:models -->\n$/);
});

test('CLI without --project plans setup in the current directory', () => {
  const dir = fresh();
  const cli = path.join(pluginRoot, 'scripts', 'setup.js');
  const out = execFileSync(process.execPath, [cli, '--dry-run'], { encoding: 'utf8', cwd: dir });
  assert.match(out, /create\s+team\/config\.json/);
});

test('CLI dry run writes nothing; apply writes', () => {
  const dir = fresh();
  const cli = path.join(pluginRoot, 'scripts', 'setup.js');
  const out = execFileSync(process.execPath, [cli, '--project', dir, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /create\s+team\/config\.json/);
  assert.deepEqual(fs.readdirSync(dir), []);
  execFileSync(process.execPath, [cli, '--project', dir, '--apply'], { encoding: 'utf8' });
  assert.ok(fs.existsSync(path.join(dir, 'team', 'work', 'board.md')));
});
