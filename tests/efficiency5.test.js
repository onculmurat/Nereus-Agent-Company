import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeGitProject } from './helpers.js';
import { buildPack } from '../scripts/lib/pack.js';
import { validateConfig } from '../scripts/lib/config.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const packCli = path.join(pluginRoot, 'scripts', 'pack.js');
const defaults = JSON.parse(read('defaults', 'config.json'));

const BRIEF = '# T-1: x\n\n## Acceptance criteria\n- works\n';

// Repo with a base commit, then a code change, a team/ change and a docs change.
function repo() {
  const { root, git, commit } = makeGitProject();
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-1.md'), BRIEF);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'one\n');
  fs.writeFileSync(path.join(root, 'docs', 'd.md'), 'doc\n');
  git('add', 'src', 'docs', 'team');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(root, 'src', 'a.js'), 'CODE_CHANGE\n');
  git('add', 'src');
  git('commit', '-q', '-m', 'code');
  fs.writeFileSync(path.join(root, 'team', 'work', 'board.md'), 'TEAM_CHANGE\n');
  git('add', 'team');
  git('commit', '-q', '-m', 'chore(team)');
  fs.appendFileSync(path.join(root, 'docs', 'd.md'), 'DOC_CHANGE\n');
  git('add', 'docs');
  git('commit', '-q', '-m', 'docs');
  return { root, base, git, commit };
}

test('item 1: full and delta pack diffs exclude team/', () => {
  const { root, base } = repo();
  const full = buildPack(root, { id: 'T-1', role: 'code-reviewer', base }).text;
  assert.match(full, /CODE_CHANGE/);
  assert.doesNotMatch(full, /TEAM_CHANGE/);
  const findings = path.join(root, 'f.md');
  fs.writeFileSync(findings, 'x');
  const delta = buildPack(root, { id: 'T-1', role: 'code-reviewer', round: 2, findings, base }).text;
  assert.match(delta, /CODE_CHANGE/);
  assert.doesNotMatch(delta, /TEAM_CHANGE/);
});

test('item 1: --paths limits the diff to those paths, still minus team/', () => {
  const { root, base } = repo();
  const text = buildPack(root, { id: 'T-1', role: 'code-reviewer', base, paths: 'src, team' }).text;
  assert.match(text, /CODE_CHANGE/);
  assert.doesNotMatch(text, /DOC_CHANGE/);
  assert.doesNotMatch(text, /TEAM_CHANGE/);
  const docsOnly = buildPack(root, { id: 'T-1', role: 'code-reviewer', base, paths: 'docs' }).text;
  assert.match(docsOnly, /DOC_CHANGE/);
  assert.doesNotMatch(docsOnly, /CODE_CHANGE/);
});

test('item 1: --paths rejects option-like and empty entries', () => {
  const { root, base } = repo();
  assert.throws(() => buildPack(root, { id: 'T-1', role: 'code-reviewer', base, paths: '--output=x' }), /Invalid path/);
  assert.throws(() => buildPack(root, { id: 'T-1', role: 'code-reviewer', base, paths: ':(top)x' }), /Invalid path/);
  assert.throws(() => buildPack(root, { id: 'T-1', role: 'code-reviewer', base, paths: ' , ' }), /Invalid path/);
});

test('item 1: packMaxChars is 60000 in the defaults and validated as a positive integer', () => {
  assert.equal(defaults.packMaxChars, 60000);
  assert.doesNotThrow(() => validateConfig(defaults));
  for (const bad of [0, -1, 1.5, '60000']) assert.throws(() => validateConfig({ ...defaults, packMaxChars: bad }), /packMaxChars/);
});

function runPack(root, ...args) {
  return spawnSync(process.execPath, [packCli, 'T-1', '--role', 'code-reviewer', '--project', root, ...args], { encoding: 'utf8' });
}

test('item 1: a pack above packMaxChars is written, warns on stderr and exits 3; --allow-large exits 0', () => {
  const { root, base, git } = repo();
  fs.writeFileSync(path.join(root, 'src', 'big.js'), 'x'.repeat(200) + '\n');
  git('add', 'src');
  git('commit', '-q', '-m', 'big');
  const cfg = path.join(root, 'team', 'config.json');
  fs.writeFileSync(cfg, JSON.stringify({ packMaxChars: 500 }));
  const r = runPack(root, '--base', base);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /pack is \d+ characters, over the limit of 500/);
  assert.match(r.stderr, /--paths/);
  assert.match(r.stderr, /--base/);
  assert.match(r.stderr, /--allow-large/);
  const out = JSON.parse(r.stdout);
  assert.ok(fs.existsSync(out.path), 'the pack is still written');
  const ok = runPack(root, '--base', base, '--allow-large');
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, '');
});

test('item 1: a pack below packMaxChars exits 0 without a warning; --paths brings a large pack under the limit', () => {
  const { root, base, git } = repo();
  fs.writeFileSync(path.join(root, 'docs', 'big.md'), 'y'.repeat(2000) + '\n');
  git('add', 'docs');
  git('commit', '-q', '-m', 'bigdoc');
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ packMaxChars: 1500 }));
  assert.equal(runPack(root, '--base', base).status, 3);
  const narrow = runPack(root, '--base', base, '--paths', 'src');
  assert.equal(narrow.status, 0);
  assert.equal(narrow.stderr, '');
});

test('item 1: task-loop builds fix-round packs with --paths and treats a size warning as a stop', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /--paths/);
  assert.match(loop, /never dispatch/i);
  assert.match(loop, /packMaxChars/);
});
