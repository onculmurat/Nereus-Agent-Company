import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { runTestGate, parseSkipped } from '../scripts/lib/gate.js';
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

// Seen live: a test printed "skip" and passed. The gate counts what the runners themselves report as skipped.
const SAMPLES = {
  cargo: [
    'running 3 tests', 'test result: ok. 1 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s',
    'running 4 tests', 'test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s',
    'Doc-tests x', 'test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
  ].join('\n'),
  node: ['ℹ tests 10', 'ℹ pass 7', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 2', 'ℹ todo 1', 'ℹ duration_ms 12.5'].join('\n'),
  nodeTap: ['1..4', '# tests 4', '# pass 2', '# fail 0', '# cancelled 0', '# skipped 1', '# todo 1', '# duration_ms 3'].join('\n'),
  pytest: ['collected 6 items', '================ 1 failed, 3 passed, 2 skipped in 0.12s ================'].join('\n'),
  pytestQuiet: '3 passed, 4 skipped, 1 warning in 0.05s',
  jest: ['Test Suites: 1 skipped, 2 passed, 3 total', 'Tests:       2 skipped, 5 passed, 1 todo, 8 total', 'Time: 1.2 s'].join('\n'),
  vitest: [' Test Files  1 skipped | 2 passed (3)', '      Tests  3 skipped | 5 passed (8)', '   Duration  1.2s'].join('\n'),
  clean: ['ℹ tests 10', 'ℹ pass 10', 'ℹ skipped 0', 'ℹ todo 0'].join('\n'),
  none: 'all green',
  ansi: '\u001b[32m3 passed\u001b[39m, \u001b[33m2 skipped\u001b[39m in 0.1s',
};

for (const [runner, expected] of [['cargo', 3], ['node', 3], ['nodeTap', 2], ['pytest', 2], ['pytestQuiet', 4], ['jest', 3], ['vitest', 3], ['clean', 0], ['none', 0], ['ansi', 2]]) {
  test(`parseSkipped reads ${runner} output`, () => {
    assert.equal(parseSkipped(SAMPLES[runner]), expected);
  });
}

test('the gate result carries skipped, counted from the whole output and not only its tail', () => {
  const body = `${SAMPLES.cargo.replace(/'/g, '')}\n${Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')}`;
  const root = project();
  fs.writeFileSync(path.join(root, 'out.txt'), body);
  const r = runTestGate(root, `${node} -e "process.stdout.write(require('fs').readFileSync('out.txt', 'utf8'))"`);
  assert.equal(r.ok, true);
  assert.equal(r.skipped, 3);
  assert.doesNotMatch(r.output, /ignored/, 'the tail no longer shows the skip lines');
  assert.equal(runTestGate(project(), `${node} -e "console.log('fine')"`).skipped, 0);
  assert.equal(runTestGate(project(), 'definitely-not-a-command-xyz').skipped, 0);
});

test('cli prints skipped', () => {
  const r = runCli(project(`${node} -e "console.log('1 passed, 2 skipped in 0.1s')"`));
  assert.equal(JSON.parse(r.stdout).skipped, 2);
});

// g54: a hung core test (CPU 0) held T-046's gate for 35 minutes and the lead waited on a result that never came.
test('a check past its deadline is stopped and reported red with timedOut and its last lines', () => {
  const started = Date.now();
  const r = runTestGate(project(), `${node} -e "console.log('test hangs_here ...'); setTimeout(() => {}, 60000)"`, { seconds: 1 });
  assert.ok(Date.now() - started < 20000, `${Date.now() - started}ms`);
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.exitCode, null);
  assert.match(r.output, /hangs_here/);
  assert.match(r.output, /no result after 1s/);
});

test('the deadline kills the whole tree: a grandchild holding the pipes does not keep the gate waiting', () => {
  const grandchild = `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit' }); console.log('spawned')`;
  const started = Date.now();
  const r = runTestGate(project(), `${node} -e "${grandchild.replace(/"/g, '\\"')}"`, { seconds: 1 });
  assert.ok(Date.now() - started < 20000, `${Date.now() - started}ms`);
  assert.equal(r.timedOut, true);
  assert.match(r.output, /spawned/);
});

test('gateCheckSeconds must be a whole number of seconds, 0 or more', () => {
  assert.throws(() => validateConfig({ ...loadConfig({ pluginRoot, projectRoot: project() }), gateCheckSeconds: -1 }), /gateCheckSeconds/);
  assert.doesNotThrow(() => validateConfig({ ...loadConfig({ pluginRoot, projectRoot: project() }), gateCheckSeconds: 0 }));
});

test('the gate CLI reports a hung check with hung and hangNote', () => {
  const root = project(`${node} -e "setTimeout(() => {}, 60000)"`);
  const r = spawnSync(process.execPath, [cli, '--project', root], { encoding: 'utf8', env: { ...process.env, NAC_GATE_WAIT_SECONDS: '0', NAC_GATE_CHECK_SECONDS: '1' } });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.hung, ['test']);
  assert.match(out.hangNote, /hang/);
});
