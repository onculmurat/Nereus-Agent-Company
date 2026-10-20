// Batch 10 (1.3.0) part A: g18 gateCommands, g22 pack enforcement, g23 irreversible go path, g16 parked questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { runGate, gateChecks, detectGateCommands } from '../scripts/lib/gate.js';
import { validateConfig, loadConfig } from '../scripts/lib/config.js';
import { planSetup, applySetup } from '../scripts/lib/setup.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = JSON.stringify(process.execPath);
const exit = (n) => `${node} -e "process.exit(${n})"`;
const gateCli = path.join(pluginRoot, 'scripts', 'gate.js');

function projectWith(cfg) {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify(cfg));
  return root;
}

// ---- A1 (g18) gateCommands ----
test('g18: gateChecks prefers gateCommands and falls back to testCommand as a single entry', () => {
  assert.deepEqual(gateChecks({ gateCommands: [{ name: 'a', command: 'x' }, { name: 'b', command: 'y' }], testCommand: 'z' }).map((c) => c.name), ['a', 'b']);
  assert.deepEqual(gateChecks({ testCommand: 'cargo test' }), [{ name: 'test', command: 'cargo test' }]);
  assert.deepEqual(gateChecks({}), []);
});

test('g18: runGate runs every check in order, reports each and fails on any red one', () => {
  const root = makeProject();
  const r = runGate(root, [{ name: 'test', command: exit(0) }, { name: 'clippy', command: exit(2) }, { name: 'fmt', command: exit(0) }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.checks.map((c) => [c.name, c.ok]), [['test', true], ['clippy', false], ['fmt', true]], 'a red check does not stop the later ones');
  assert.equal(r.exitCode, 2);
  assert.equal(runGate(root, [{ name: 'test', command: exit(0) }, { name: 'lint', command: exit(0) }]).ok, true);
});

test('g18: cli runs all gateCommands and exits 1 when one is red', () => {
  const green = spawnSync(process.execPath, [gateCli, '--project', projectWith({ gateCommands: [{ name: 'a', command: exit(0) }, { name: 'b', command: exit(0) }] })], { encoding: 'utf8' });
  assert.equal(green.status, 0, green.stderr);
  assert.equal(JSON.parse(green.stdout).checks.length, 2);
  const red = spawnSync(process.execPath, [gateCli, '--project', projectWith({ testCommand: exit(0), gateCommands: [{ name: 'a', command: exit(0) }, { name: 'lint', command: exit(1) }] })], { encoding: 'utf8' });
  assert.equal(red.status, 1);
  const out = JSON.parse(red.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.checks.find((c) => c.name === 'lint').ok, false);
});

test('g18: a malformed gateCommands fails closed (config error, exit 1)', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: null });
  assert.doesNotThrow(() => validateConfig({ ...base, gateCommands: [{ name: 'test', command: 'npm test' }] }));
  for (const bad of [[], 'npm test', [{ name: 'a' }], [{ name: '', command: 'x' }], [{ name: 'a', command: ' ' }], [{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }]]) {
    assert.throws(() => validateConfig({ ...base, gateCommands: bad }), /gateCommands/, JSON.stringify(bad));
  }
  const r = spawnSync(process.execPath, [gateCli, '--project', projectWith({ gateCommands: [] })], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gateCommands/);
});

test('g18: detectGateCommands per stack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac stack '));
  assert.deepEqual(detectGateCommands(dir), []);
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\n');
  assert.deepEqual(detectGateCommands(dir).map((c) => c.name), ['test', 'clippy', 'fmt']);
  assert.match(detectGateCommands(dir).find((c) => c.name === 'clippy').command, /-D warnings/);
  assert.match(detectGateCommands(dir).find((c) => c.name === 'fmt').command, /fmt --check/);
  fs.writeFileSync(path.join(dir, 'deny.toml'), '');
  assert.deepEqual(detectGateCommands(dir).map((c) => c.name), ['test', 'clippy', 'fmt', 'deny']);
  const node1 = fs.mkdtempSync(path.join(os.tmpdir(), 'nac stack '));
  fs.writeFileSync(path.join(node1, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
  assert.deepEqual(detectGateCommands(node1).map((c) => c.name), ['test']);
  fs.writeFileSync(path.join(node1, 'package.json'), JSON.stringify({ scripts: { test: 'x', lint: 'y' } }));
  assert.deepEqual(detectGateCommands(node1).map((c) => c.name), ['test', 'lint']);
  fs.writeFileSync(path.join(node1, 'package.json'), '{ broken');
  assert.deepEqual(detectGateCommands(node1), [], 'detection fails open');
});

test('g18: setup records the detected gateCommands in team/config.json, never over an existing choice', () => {
  const config = loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac setup '));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\n');
  const plan = planSetup(dir, { pluginRoot, config });
  assert.deepEqual(plan.gateCommands.map((c) => c.name), ['test', 'clippy', 'fmt']);
  applySetup(plan);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'team', 'config.json'), 'utf8'));
  assert.deepEqual(written.gateCommands.map((c) => c.name), ['test', 'clippy', 'fmt']);
  // second run: config has gateCommands already, nothing planned
  assert.equal(planSetup(dir, { pluginRoot, config }).gateCommands, null);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nac setup '));
  fs.writeFileSync(path.join(dir2, 'Cargo.toml'), '[package]\n');
  fs.mkdirSync(path.join(dir2, 'team'));
  fs.writeFileSync(path.join(dir2, 'team', 'config.json'), JSON.stringify({ testCommand: 'cargo test' }));
  assert.equal(planSetup(dir2, { pluginRoot, config }).gateCommands, null, 'an owner-approved testCommand stays as it is');
});

test('g18: the task-loop skill states the red-check-is-a-finding rule', () => {
  const loop = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(loop, /gateCommands/);
  assert.match(loop, /red check you see is recorded as a finding/);
});
