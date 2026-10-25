// 1.3.26: g64, the gate stopped at a known environmental red, and a red from a parallel task's load cost a round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { runTestGate, runGate, retryRed, failedTests, noFailFast } from '../scripts/lib/gate.js';
import os from 'node:os';
import { loadConfig, validateConfig } from '../scripts/lib/config.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = JSON.stringify(process.execPath);
// A command that prints cargo-style test lines and exits 101 when any is FAILED.
const cargoLike = (lines) => `${node} -e "const l=${JSON.stringify(lines).replace(/"/g, '\\"')};console.log(l.join('\\n'));process.exit(l.some(x=>/FAILED|could not compile/.test(x))?101:0)"`;
const acl = { test: 'c4_broad_write_acl_warns', finding: 'F-500', reason: 'TEMP on D: has a broad ACL on this machine' };

// Seen live (Memory Agent T-058): `cargo test` stopped at data_dir c4_broad_write_acl_warns, red on this machine
// since 082b65e, so the tests after it never ran in the gate and the lead passed the red by hand every time.
test('g64: cargo test runs with --no-fail-fast, other commands are left alone', () => {
  assert.equal(noFailFast('cargo test'), 'cargo test --no-fail-fast');
  assert.equal(noFailFast('cargo test -p a -- --nocapture'), 'cargo test --no-fail-fast -p a -- --nocapture');
  assert.equal(noFailFast('cargo test --no-fail-fast -p a'), 'cargo test --no-fail-fast -p a');
  assert.equal(noFailFast('cargo clippy -- -D warnings'), 'cargo clippy -- -D warnings');
  assert.equal(noFailFast('npm test'), 'npm test');
});

test('g64: failedTests reads cargo and pytest failures', () => {
  assert.deepEqual(failedTests('test a::b ... ok\ntest data_dir::c4 ... FAILED\nFAILED tests/x.py::test_y - assert'), ['data_dir::c4', 'tests/x.py::test_y']);
});

test('g64: a check red only on gateKnownRed tests counts as green and names them', () => {
  const root = makeProject();
  const r = runTestGate(root, cargoLike(['test data_dir::c4_broad_write_acl_warns ... FAILED', 'test other ... ok']), { knownRed: [acl] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.knownRed, ['data_dir::c4_broad_write_acl_warns']);
});

test('g64: another failure, or a build error, keeps the check red', () => {
  const root = makeProject();
  const other = runTestGate(root, cargoLike(['test data_dir::c4_broad_write_acl_warns ... FAILED', 'test new_bug ... FAILED']), { knownRed: [acl] });
  assert.equal(other.ok, false);
  const build = runTestGate(root, cargoLike(['test data_dir::c4_broad_write_acl_warns ... FAILED', 'error: could not compile `cli` (test "features") due to 1 previous error']), { knownRed: [acl] });
  assert.equal(build.ok, false);
});

test('g64: a known red test that passes now is reported so its entry can go', () => {
  const r = runTestGate(makeProject(), cargoLike(['test data_dir::c4_broad_write_acl_warns ... ok']), { knownRed: [acl] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.knownRedPassed, ['c4_broad_write_acl_warns']);
});

test('g64: gateKnownRed entries need a test, a finding and a reason; gateRetry is 0 to 3', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: path.join(os.tmpdir(), 'none.json') });
  assert.doesNotThrow(() => validateConfig({ ...base, gateKnownRed: [acl], gateRetry: 0 }));
  assert.throws(() => validateConfig({ ...base, gateKnownRed: [{ test: 'x' }] }), /test, finding and reason/);
  assert.throws(() => validateConfig({ ...base, gateKnownRed: 'x' }), /gateKnownRed must be a list/);
  assert.throws(() => validateConfig({ ...base, gateRetry: 5 }), /gateRetry must be 0 to 3/);
});

// Seen live (Memory Agent T-097): the gate was red on "Blocking waiting for file lock on package cache" while a
// parallel task built; it counted as round 1, the developer found nothing to fix, and the gate run alone was green.
test('g64: a red check runs again; red then green is flaky, not a round', () => {
  const root = makeProject();
  const mark = path.join(root, 'ran-once').replace(/\\/g, '/');
  const checks = [{ name: 'test', command: `${node} -e "const fs=require('fs');if(fs.existsSync('${mark}'))process.exit(0);fs.writeFileSync('${mark}','');process.exit(1)"` }];
  const first = runGate(root, checks, {});
  assert.equal(first.ok, false);
  const r = retryRed(root, checks, first, { retries: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.flaky, ['test']);
  assert.match(r.flakyNote, /not a round/);
});

test('g64: a red that stays red is not flaky, and gateRetry 0 does not run it again', () => {
  const root = makeProject();
  const checks = [{ name: 'test', command: `${node} -e "process.exit(1)"` }];
  const first = runGate(root, checks, {});
  const again = retryRed(root, checks, first, { retries: 1 });
  assert.equal(again.ok, false);
  assert.equal(again.flaky, undefined);
  assert.equal(retryRed(root, checks, first, { retries: 0 }), first);
});

test('g64: gate.js reports knownRed with its note', () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateCommands: [{ name: 'test', command: cargoLike(['test data_dir::c4_broad_write_acl_warns ... FAILED']) }], gateKnownRed: [acl] }));
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'gate.js'), '--project', root], { encoding: 'utf8', env: { ...process.env, NAC_GATE_WAIT_SECONDS: '0' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.knownRed, ['data_dir::c4_broad_write_acl_warns']);
  assert.match(out.knownRedNote, /environmental/);
});
