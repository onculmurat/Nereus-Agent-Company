import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { runTestGate } from '../scripts/lib/gate.js';
import { validateConfig, loadConfig } from '../scripts/lib/config.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(pluginRoot, 'scripts', 'gate.js');
const node = JSON.stringify(process.execPath);

function project(testCommand) {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify(testCommand === undefined ? {} : { testCommand }));
  return root;
}

function runCli(root) {
  return spawnSync(process.execPath, [cli, '--project', root], { encoding: 'utf8' });
}

test('a passing test command passes the gate', () => {
  const r = runTestGate(project(), `${node} -e "console.log('all green')"`);
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /all green/);
});

test('a failing test command fails the gate with its exit code and output', () => {
  const r = runTestGate(project(), `${node} -e "console.error('1 failed'); process.exit(3)"`);
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 3);
  assert.match(r.output, /1 failed/);
});

test('the command runs in the project root', () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'marker.txt'), 'here');
  const r = runTestGate(root, `${node} -e "process.exit(require('fs').existsSync('marker.txt') ? 0 : 1)"`);
  assert.equal(r.ok, true);
});

test('only the tail of a long output is kept', () => {
  const r = runTestGate(project(), `${node} -e "for (let i = 1; i <= 500; i++) console.log('line ' + i)"`);
  assert.match(r.output, /line 500/);
  assert.doesNotMatch(r.output, /line 1\n/);
  assert.ok(r.output.split('\n').length <= 61);
});

test('cli runs the testCommand from team/config.json and exits 1 on failure', () => {
  const pass = runCli(project(`${node} -e "process.exit(0)"`));
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(JSON.parse(pass.stdout).ok, true);
  const fail = runCli(project(`${node} -e "process.exit(2)"`));
  assert.equal(fail.status, 1);
  assert.equal(JSON.parse(fail.stdout).exitCode, 2);
});

test('cli without a testCommand fails with a clear message', () => {
  const r = runCli(project());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No testCommand in team\/config\.json/);
});

test('validateConfig rejects an empty or non-string testCommand', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: null });
  assert.doesNotThrow(() => validateConfig({ ...base, testCommand: 'cargo test' }));
  assert.throws(() => validateConfig({ ...base, testCommand: '' }), /testCommand/);
  assert.throws(() => validateConfig({ ...base, testCommand: 42 }), /testCommand/);
});

// Seen while building the gate: node --test collected scripts/test-gate.js as a test file and ran it.
test('no file under scripts/ matches a node --test default pattern', () => {
  const pattern = /(^test-.*|^test|[-_.]test)\.[cm]?js$/;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [e.name]);
  assert.deepEqual(walk(path.join(pluginRoot, 'scripts')).filter((f) => pattern.test(f)), []);
});
