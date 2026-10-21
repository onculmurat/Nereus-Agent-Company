import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfig, loadConfig } from '../scripts/lib/config.js';
import { proxyContext } from '../scripts/lib/proxy.js';
import { makeProject, makeGitProject } from './helpers.js';
import { runHook, fixture } from './hooks/run-hook.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setupCli = path.join(pluginRoot, 'scripts', 'setup.js');
const config = (extra) => ({ ...loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null }), ...extra });

// g29: the owner proxy lived only in chat. A new lead session did not know it and opened an AskUserQuestion box the
// proxy cannot answer; a standing delegation recorded by the lead was refused by the classifier. The owner now sets
// it once in team/config.json (setup.js --proxy, run with "!"), and the session start hands it to every lead session.
test('ownerProxy needs a session name and an optional YYYY-MM-DD end date', () => {
  validateConfig(config({ ownerProxy: { session: 'personal-vault-77' } }));
  validateConfig(config({ ownerProxy: { session: 'personal-vault-77', until: '2026-12-31' } }));
  assert.throws(() => validateConfig(config({ ownerProxy: { session: '' } })), /ownerProxy.session/);
  assert.throws(() => validateConfig(config({ ownerProxy: { session: 'a\nb' } })), /ownerProxy.session/);
  assert.throws(() => validateConfig(config({ ownerProxy: { session: 'p', until: 'tomorrow' } })), /ownerProxy.until/);
});

test('proxyContext routes owner questions to the proxy until it expires', () => {
  assert.equal(proxyContext({}), '');
  const open = proxyContext({ ownerProxy: { session: 'pv-77' } }, '2026-10-20');
  assert.match(open, /SendMessage/);
  assert.match(open, /pv-77/);
  assert.match(open, /instead of AskUserQuestion/);
  assert.match(open, /push, merge/);
  assert.match(proxyContext({ ownerProxy: { session: 'pv-77', until: '2026-10-20' } }, '2026-10-20'), /until 2026-10-20/);
  const expired = proxyContext({ ownerProxy: { session: 'pv-77', until: '2026-10-19' } }, '2026-10-20');
  assert.match(expired, /expired/);
  assert.doesNotMatch(expired, /instead of AskUserQuestion/);
});

test('session start gives the lead the owner proxy from team/config.json', async () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ ownerProxy: { session: 'pv-77' } }));
  const r = runHook('session-start', await fixture('session-start-startup', { cwd: root }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /## Owner proxy[\s\S]*pv-77/);
});

test('setup --proxy writes ownerProxy into team/config.json, keeps the other keys and commits that one file; off removes it', () => {
  const { root, git } = makeGitProject();
  const file = path.join(root, 'team', 'config.json');
  fs.writeFileSync(file, '{\n  "worktreeRoot": "C:/wt"\n}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const run = (...a) => spawnSync(process.execPath, [setupCli, '--project', root, ...a], { encoding: 'utf8' });

  const dry = run('--proxy', 'pv-77', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /ownerProxy/);

  const set = run('--proxy', 'pv-77', '--until', '2026-12-31');
  assert.equal(set.status, 0, set.stderr);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(cfg, { worktreeRoot: 'C:/wt', ownerProxy: { session: 'pv-77', until: '2026-12-31' } });
  assert.equal(git('status', '--porcelain'), '');
  assert.match(git('log', '-1', '--format=%s'), /^chore\(nac\): owner proxy pv-77/);

  assert.equal(run('--proxy', 'off').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { worktreeRoot: 'C:/wt' });

  const bad = run('--proxy', 'pv-77', '--until', 'soon');
  assert.notEqual(bad.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { worktreeRoot: 'C:/wt' });
});

test('question protocol names the owner proxy', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'question-protocol', 'SKILL.md'), 'utf8');
  assert.match(skill, /ownerProxy/);
});

// g49: a proxy answer recorded as the owner's own approval was refused by the classifier, and the lead stopped
// recording proxy answers at all. The delegation now sits in CLAUDE.md in the owner's words and a proxy decision says so.
const decisionsCli = path.join(pluginRoot, 'scripts', 'decisions.js');

test('setup --proxy writes the owner-proxy block into CLAUDE.md with the config, keeps the rest; off removes it (g49)', () => {
  const { root, git } = makeGitProject();
  const md = path.join(root, 'CLAUDE.md');
  fs.writeFileSync(md, '# Project rules\n\nKeep this.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const run = (...a) => spawnSync(process.execPath, [setupCli, '--project', root, ...a], { encoding: 'utf8' });
  assert.equal(run('--proxy', 'pv-77').status, 0);
  const text = fs.readFileSync(md, 'utf8');
  assert.match(text, /Keep this\./);
  assert.match(text, /nac:owner-proxy:start[\s\S]*pv-77[\s\S]*--by proxy[\s\S]*nac:owner-proxy:end/);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(run('--proxy', 'pv-88').status, 0);
  assert.equal(fs.readFileSync(md, 'utf8').match(/nac:owner-proxy:start/g).length, 1);
  assert.match(fs.readFileSync(md, 'utf8'), /pv-88/);
  assert.equal(run('--proxy', 'off').status, 0);
  assert.equal(fs.readFileSync(md, 'utf8'), '# Project rules\n\nKeep this.\n');
});

test('decide --by proxy records the proxy and refuses owner-only questions (g49)', () => {
  const root = makeProject();
  const run = (...a) => spawnSync(process.execPath, [decisionsCli, ...a, '--project', root], { encoding: 'utf8' });
  const ask = (title, ...extra) => JSON.parse(run('ask', `--title=${title}`, '--source=s', '--status=s', '--impact=i', '--blocking', 'yes', '--thread', 't-1', '--options=a|b', '--recommend=a', ...extra).stdout).id;
  const design = ask('Which header text?');
  const none = run('decide', design, '--answer=A', '--by', 'proxy');
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /no ownerProxy/);
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ ownerProxy: { session: 'pv-77' } }));
  const ok = run('decide', design, '--answer=A', '--by', 'proxy');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).by, 'owner proxy pv-77');
  const merge = ask('Merge the branch into main?');
  assert.match(run('decide', merge, '--answer=yes', '--by', 'proxy').stderr, /stay with the owner/);
  assert.equal(run('decide', merge, '--answer=yes').status, 0, 'the owner still decides it directly');
  assert.notEqual(run('decide', ask('Other'), '--answer=x', '--by', 'someone').status, 0);
});
