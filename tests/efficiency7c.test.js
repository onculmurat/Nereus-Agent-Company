// Batch 7 addendum D: module-level security gate at phase close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const cli = (script, root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const find = (root, ...a) => cli('findings.js', root, ...a);
const add = (root, text, o = {}) => find(root, 'add', '--module', o.module ?? 'auth', '--file', 'src/a.js', '--line', '3', '--severity', o.severity ?? 'hardening', '--class', 'observed', '--task', 'T-001', '--text', text);

const board = (root, ...a) => cli('board.js', root, ...a);

test('board phase refuses while a blocker finding is open', () => {
  const root = makeProject();
  add(root, 'secret leaks', { severity: 'blocker' });
  const r = board(root, 'phase', '5');
  assert.equal(r.status, 1);
  assert.match(r.err, /F-001/);
  assert.match(r.err, /blocker/);
  add(root, 'minor', { module: 'db', severity: 'minor' });
  find(root, 'close', 'F-001', '--commit', 'abc1234');
  assert.equal(board(root, 'phase', '5').status, 0);
});

test('board phase refuses while a module has security tasks done after its last security pass', () => {
  const root = makeProject();
  board(root, 'add', '--title', 'Login', '--owner', 'backend-developer', '--model', 'sonnet', '--module', 'auth', '--security', 'yes');
  board(root, 'add', '--title', 'Docs', '--owner', 'doc-writer', '--model', 'sonnet', '--module', 'docs');
  board(root, 'update', 'T-001', '--status', 'done');
  board(root, 'update', 'T-002', '--status', 'done');
  const r = board(root, 'phase', '5');
  assert.equal(r.status, 1);
  assert.match(r.err, /auth/);
  assert.match(r.err, /board\.js review --module auth --role security-reviewer --verdict pass/);
  assert.doesNotMatch(r.err, /docs/);
  assert.equal(board(root, 'review', '--module', 'auth', '--role', 'security-reviewer', '--verdict', 'pass').status, 0);
  assert.equal(board(root, 'phase', '5').status, 0);
  // a later security task in the same module is not covered by the earlier pass
  board(root, 'add', '--title', 'Reset', '--owner', 'backend-developer', '--model', 'sonnet', '--module', 'auth', '--security', 'yes');
  board(root, 'update', 'T-003', '--status', 'done');
  assert.equal(board(root, 'phase', '6').status, 1);
});

test('review --module needs a module with a task; a fail verdict does not pass the gate', () => {
  const root = makeProject();
  assert.equal(board(root, 'review', '--module', 'nope', '--role', 'security-reviewer', '--verdict', 'pass').status, 1);
  board(root, 'add', '--title', 'Login', '--owner', 'backend-developer', '--model', 'sonnet', '--module', 'auth', '--security', 'yes');
  board(root, 'update', 'T-001', '--status', 'done');
  board(root, 'review', '--module', 'auth', '--role', 'security-reviewer', '--verdict', 'fail');
  assert.equal(board(root, 'phase', '5').status, 1);
});

test('the module gate sits in board.js phase, which phase-report step 4 runs', () => {
  assert.match(read('skills', 'phase-report', 'SKILL.md'), /refuses[^\n]*blocker[^\n]*security/i);
});

