// 1.3.71: g114, the gate writes its own result file, so a check run as a background shell is never recorded by hand.
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
const gate = (root, ...args) => {
  const r = spawnSync(process.execPath, [gateCli, ...args, '--project', root], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};

// Seen live (Memory Agent T-142, 10-28 14:4x): test-feature took 739 s, past the 600 s tool timeout, so it ran as a
// background shell; its captured output came back cut off and the lead wrote "green with known reds" into the gate file
// by hand.
test('g114: every gate run writes its result to resultFile, one file per --check', () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateRetry: 0, gateCommands: [{ name: 'test', command: `${node} -e "0"` }, { name: 'test-feature', command: `${node} -e "process.exit(3)"` }] }));
  const packs = path.join(root, 'team', 'work', 'packs');

  const whole = gate(root);
  assert.equal(whole.status, 1);
  assert.equal(whole.out.resultFile, path.join(packs, 'gate-result-project.json'));
  const saved = JSON.parse(fs.readFileSync(whole.out.resultFile, 'utf8'));
  assert.equal(saved.ok, false);
  assert.deepEqual(saved.checks.map((c) => [c.name, c.ok]), [['test', true], ['test-feature', false]]);
  assert.match(saved.at, /^\d{4}-\d{2}-\d{2}T/);

  const one = gate(root, '--check', 'test');
  assert.equal(one.status, 0, one.err);
  assert.equal(one.out.resultFile, path.join(packs, 'gate-result-project-test.json'));
  assert.equal(JSON.parse(fs.readFileSync(one.out.resultFile, 'utf8')).ok, true);
  assert.equal(fs.existsSync(`${one.out.resultFile}.tmp`), false);
  // the whole-gate file is left as it was
  assert.equal(JSON.parse(fs.readFileSync(whole.out.resultFile, 'utf8')).ok, false);
});
