// 1.3.10: a gate red on format alone is fixed by the lead with gate.js --fix, not a round (g44, T-081 and T-084).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { addEntry } from '../scripts/lib/board.js';
import { fixCommand } from '../scripts/lib/gate.js';

const gateCli = path.join(pluginRoot, 'scripts', 'gate.js');
const run = (root, ...args) => spawnSync(process.execPath, [gateCli, '--task', 'T-1', ...args, '--project', root], { encoding: 'utf8', env: { ...process.env, NAC_GATE_WAIT_SECONDS: '0' } });
// "fmt" is red while a.txt holds a tab; its fix replaces the tab. "test" is red while b.txt says FAIL.
const FMT = { name: 'fmt', command: 'node -e "process.exit(require(\'fs\').readFileSync(\'a.txt\',\'utf8\').includes(\'\\t\') ? 1 : 0)"', fix: 'node -e "const f=require(\'fs\');f.writeFileSync(\'a.txt\',f.readFileSync(\'a.txt\',\'utf8\').replace(/\\t/g,\'  \'))"' };
const TEST = { name: 'test', command: 'node -e "process.exit(require(\'fs\').readFileSync(\'b.txt\',\'utf8\').includes(\'FAIL\') ? 1 : 0)"' };

function project(a, b) {
  const p = makeGitProject();
  fs.mkdirSync(path.join(p.root, 'team'), { recursive: true });
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), JSON.stringify({ gateCommands: [TEST, FMT] }));
  fs.writeFileSync(path.join(p.root, 'a.txt'), a);
  fs.writeFileSync(path.join(p.root, 'b.txt'), b);
  addEntry(p.root, { id: 'T-1', title: 't', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'seed');
  return p;
}

test('fixCommand: the fix field wins; cargo fmt, ruff format, black and prettier get their write form; others none', () => {
  assert.equal(fixCommand({ name: 'f', command: 'cargo fmt --check', fix: 'cargo fmt --all' }), 'cargo fmt --all');
  assert.equal(fixCommand({ name: 'f', command: 'cargo fmt --all --check' }), 'cargo fmt --all');
  assert.equal(fixCommand({ name: 'f', command: 'cargo fmt --check -- --color never' }), 'cargo fmt -- --color never');
  assert.equal(fixCommand({ name: 'f', command: 'ruff format --check .' }), 'ruff format .');
  assert.equal(fixCommand({ name: 'f', command: 'black --check src' }), 'black src');
  assert.equal(fixCommand({ name: 'f', command: 'npx prettier --check .' }), 'npx prettier --write .');
  assert.equal(fixCommand({ name: 't', command: 'cargo test' }), null);
  assert.equal(fixCommand({ name: 'c', command: 'cargo clippy -- -D warnings' }), null);
  const p = project('a\n', 'ok\n');
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), JSON.stringify({ gateCommands: [{ name: 'fmt', command: 'x', fix: ' ' }] }));
  assert.match(run(p.root).stderr, /fix must be a non-empty command/);
});

test('g44: a format-only red gate says fixable; --fix commits the fix as style(<id>) and the gate is green', () => {
  const p = project('a\tb\n', 'ok\n');
  const r = run(p.root);
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).fixable, true);
  const f = run(p.root, '--fix');
  assert.equal(f.status, 0, f.stdout + f.stderr);
  const out = JSON.parse(f.stdout);
  assert.deepEqual(out.fixed, ['fmt']);
  assert.equal(out.ok, true);
  assert.equal(p.git('log', '-1', '--format=%s'), 'style(T-1): fmt (gate --fix)');
  assert.equal(p.git('log', '-1', '--format=%h'), out.fixCommit);
  assert.equal(fs.readFileSync(path.join(p.root, 'a.txt'), 'utf8'), 'a  b\n');
});

test('g44: a red check without a fix is a round: no fixable flag, --fix refuses', () => {
  const p = project('a\tb\n', 'FAIL\n');
  assert.equal(JSON.parse(run(p.root).stdout).fixable, undefined);
  const f = run(p.root, '--fix');
  assert.notEqual(f.status, 0);
  assert.match(f.stderr, /red checks without a fix command: test; this is a round/);
  assert.equal(p.git('log', '-1', '--format=%s'), 'seed');
});

test('g44: --fix refuses with uncommitted changes outside team/, and needs --task', () => {
  const p = project('a\tb\n', 'ok\n');
  fs.writeFileSync(path.join(p.root, 'b.txt'), 'ok, edited\n');
  assert.match(run(p.root, '--fix').stderr, /uncommitted changes outside team\//);
  const noTask = spawnSync(process.execPath, [gateCli, '--fix', '--project', p.root], { encoding: 'utf8' });
  assert.match(noTask.stderr, /--fix needs --task/);
});

test('g44 prose: developers format before commit; the task loop runs --fix, not a round', () => {
  for (const f of ['backend-developer', 'database-engineer', 'frontend-developer', 'test-engineer']) {
    assert.match(fs.readFileSync(path.join(pluginRoot, 'agents', `${f}.md`), 'utf8'), /Before each commit run the project's formatter on your changes/);
  }
  assert.match(fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8'), /`fixable: true`[\s\S]*gate\.js" --task <id> --fix[\s\S]*not a round/);
});
