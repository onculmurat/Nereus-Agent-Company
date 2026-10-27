// 1.3.62: g104, a gate whose checks took longer than gateSplitSeconds asks for one --check per call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';

const gateCli = path.join(pluginRoot, 'scripts', 'gate.js');
const env = { ...process.env, NAC_GATE_WAIT_SECONDS: '0', NAC_GATE_MIN_FREE_GB: '0' };
const node = JSON.stringify(process.execPath);
const slow = (ms) => `${node} -e "setTimeout(() => {}, ${ms})"`;
const gate = (root, ...args) => {
  const r = spawnSync(process.execPath, [gateCli, ...args, '--project', root], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};

// Seen live (Memory Agent T-117 r2 and T-092 step A, 10-27): test-feature doubled the cargo test time, the whole gate
// passed the 600 s tool timeout and moved to the background, and the lead waited on a result it might lose.
test('g104: past gateSplitSeconds the next whole gate runs nothing and gives one --check command per check', () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateRetry: 0, gateSplitSeconds: 2, gateCommands: [{ name: 'test', command: slow(1600) }, { name: 'test-feature', command: slow(1700) }] }));
  const first = gate(root);
  assert.equal(first.status, 0, first.err);
  assert.ok(first.out.tookSeconds >= 3);
  assert.match(first.out.splitNote, /gateSplitSeconds 2/);
  const times = JSON.parse(fs.readFileSync(path.join(root, 'team', 'work', 'packs', 'gate-times.json'), 'utf8'));
  assert.equal(Object.keys(times).length, 2);

  const second = gate(root);
  assert.equal(second.status, 1);
  assert.equal(second.out.splitRequired, true);
  assert.equal(second.out.checks, undefined);
  assert.deepEqual(second.out.checkSeconds.map((c) => c.name), ['test', 'test-feature']);
  assert.equal(second.out.commands.length, 2);
  assert.match(second.out.commands[1], /--check test-feature$/);

  const one = gate(root, '--check', 'test-feature');
  assert.equal(one.status, 0, one.err);
  assert.deepEqual(one.out.only, ['test-feature']);
  assert.deepEqual(one.out.checks.map((c) => c.name), ['test-feature']);
  assert.equal(one.out.splitNote, undefined);

  assert.equal(gate(root, '--no-split').out.checks.length, 2);
});

test('g104: --check with an unknown name is refused and names the checks; gateSplitSeconds is validated', () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateCommands: [{ name: 'test', command: `${node} -e "0"` }] }));
  const r = gate(root, '--check', 'clippy');
  assert.equal(r.status, 1);
  assert.match(r.err, /No gate check named clippy; the checks are: test/);
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateSplitSeconds: -1, gateCommands: [{ name: 'test', command: `${node} -e "0"` }] }));
  assert.match(gate(root).err, /gateSplitSeconds must be a whole number/);
});
