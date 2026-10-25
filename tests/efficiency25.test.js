// 1.3.30: g69, the rerun of a red test check ran every test again under the same load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from './helpers.js';
import { runTestGate, isolatedCommand } from '../scripts/lib/gate.js';

const node = JSON.stringify(process.execPath);
const cargoLike = (lines) => `${node} -e "const l=${JSON.stringify(lines).replace(/"/g, '\\"')};console.log(l.join('\\n'));process.exit(l.some(x=>/FAILED/.test(x))?101:0)"`;

// Seen live (Memory Agent T-062): a masker ReDoS budget test went red under the full parallel cargo test, the rerun
// ran the whole check again under the same load and another budget test went red; both passed alone.
test('g69: the rerun of a red cargo test runs only the failed tests, one at a time', () => {
  assert.equal(isolatedCommand('cargo test --no-fail-fast', ['masker::tests::redos_a']), 'cargo test --no-fail-fast -- masker::tests::redos_a --exact --test-threads=1');
  assert.equal(isolatedCommand('cargo test -p core -- --nocapture', ['a::b', 'c']), 'cargo test -p core -- a::b c --exact --test-threads=1 --nocapture');
});

test('g69: no isolated rerun for other commands, no names or an unusual name', () => {
  assert.equal(isolatedCommand('npm test', ['a']), null);
  assert.equal(isolatedCommand('cargo test', []), null);
  assert.equal(isolatedCommand('cargo test', ['a; rm -rf x']), null);
});

test('g69: an isolated rerun is green only when every expected test ran and passed', () => {
  const root = makeProject();
  assert.equal(runTestGate(root, cargoLike(['test a::b ... ok']), { expect: ['a::b'] }).ok, true);
  const none = runTestGate(root, cargoLike(['running 0 tests']), { expect: ['a::b'] });
  assert.equal(none.ok, false);
  assert.deepEqual(none.notRun, ['a::b']);
  assert.equal(runTestGate(root, cargoLike(['test a::b ... FAILED']), { expect: ['a::b'] }).ok, false);
});
