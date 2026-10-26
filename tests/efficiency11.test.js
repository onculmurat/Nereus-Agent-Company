import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planSetup, teamCommitRules, planPermissions, applyPermissions } from '../scripts/lib/setup.js';
import { loadConfig } from '../scripts/lib/config.js';
import { makeProject, makeGitProject, taskLoopText } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null });
const slash = (p) => p.split(path.sep).join('/');
const settingsOf = (root) => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));

// g27: the auto-mode classifier refused the lead's team-commit.js run ("Modify Shared Resources") and the owner had
// to commit team/config.json by hand. Setup writes a project allow rule for exactly that script.
test('team-commit rules name the plugin root and a directory marketplace source, forward slashes, no duplicates', () => {
  const rules = teamCommitRules('C:\\cache\\nac\\1.3.0', { sources: ['D:\\Projects\\Agent Team', 'C:\\cache\\nac\\1.3.0'] });
  assert.deepEqual(rules, [
    'Bash(node "C:/cache/nac/1.3.0/scripts/team-commit.js" *)',
    'Bash(node "C:/cache/nac/1.3.0/scripts/task.js" *)',
    'Bash(node "D:/Projects/Agent Team/scripts/team-commit.js" *)',
    'Bash(node "D:/Projects/Agent Team/scripts/task.js" *)',
  ]);
});

test('setup --apply plan adds the team-commit allow rule and keeps existing allow entries', () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(cargo test)'] } }));
  const plan = planSetup(root, { pluginRoot, config });
  const allow = plan.settings.after.permissions.allow;
  assert.equal(allow[0], 'Bash(cargo test)');
  assert.ok(allow.includes(`Bash(node "${slash(pluginRoot)}/scripts/team-commit.js" *)`), allow.join('\n'));
  assert.deepEqual(plan.settings.conflicts, []);
});

test('--permissions writes only the rule, keeps formatting and commits that one file', () => {
  const { root, git } = makeGitProject();
  fs.mkdirSync(path.join(root, '.claude'));
  const file = path.join(root, '.claude', 'settings.json');
  fs.writeFileSync(file, '{\r\n\t"autoCompactWindow": 200000\r\n}\r\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const plan = planPermissions(root, { pluginRoot, sources: [] });
  const done = applyPermissions(plan);
  assert.equal(done.committed, true);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\r\n\t"permissions"/);
  assert.equal(settingsOf(root).autoCompactWindow, 200000);
  assert.deepEqual(settingsOf(root).permissions.allow, [`Bash(node "${slash(pluginRoot)}/scripts/team-commit.js" *)`, `Bash(node "${slash(pluginRoot)}/scripts/task.js" *)`]);
  assert.equal(git('status', '--porcelain'), '');
  assert.match(git('log', '-1', '--format=%s'), /^chore\(nac\): allow team-commit\.js and task\.js for the lead \(g27, g33\)$/);
  assert.equal(applyPermissions(planPermissions(root, { pluginRoot, sources: [] })).changed, false);
});

test('setup.js --permissions --dry-run writes nothing and names the rule', () => {
  const root = makeProject();
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'setup.js'), '--project', root, '--permissions', '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /team-commit\.js/);
  assert.equal(fs.existsSync(path.join(root, '.claude', 'settings.json')), false);
});

test('task-loop tells the lead to run team-commit.js on its own, not chained', () => {
  const skill = taskLoopText();
  assert.match(skill, /team-commit\.js[^\n]*on its own/);
});
