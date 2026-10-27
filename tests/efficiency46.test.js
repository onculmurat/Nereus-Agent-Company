// 1.3.60: g102, the gate names the skipped tests, not only their count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from './helpers.js';
import { runGate, skippedTests } from '../scripts/lib/gate.js';

const node = JSON.stringify(process.execPath);
// A command that prints the given lines and exits 0.
const prints = (lines) => `${node} -e "console.log(${JSON.stringify(lines.join('\n')).replace(/"/g, '\\"')})"`;

test('g102: skippedTests reads cargo, node --test and pytest skip lines', () => {
  const out = [
    'test a::slow ... ignored',
    'test b::needs_net ... ignored, needs network',
    'test c::fine ... ok',
    'test result: ok. 1 passed; 0 failed; 2 ignored; 0 measured',
    'ok 3 - reads the pack # SKIP no git',
    '﹣ writes the board (1.2ms) # TODO',
    'SKIPPED [1] tests/test_x.py:12: no docker',
    'tests/test_y.py::test_z SKIPPED (slow)',
  ].join('\n');
  assert.deepEqual(skippedTests(out), ['a::slow', 'b::needs_net', 'reads the pack', 'writes the board', 'tests/test_x.py:12: no docker', 'tests/test_y.py::test_z']);
  assert.deepEqual(skippedTests('test a ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;'), []);
});

// Seen live (Memory Agent T-082 step 1, 10-27): the gate said skipped=1, the saved tail named no test, and the lead
// had to ask the next developer to find and explain the skip for the hand-off.
test('g102: the gate result names the skipped tests, per check when there are several', () => {
  const root = makeProject();
  const cargo = prints(['test bench::live_run ... ignored', 'test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured']);
  const one = runGate(root, [{ name: 'test', command: cargo }]);
  assert.equal(one.skipped, 1);
  assert.deepEqual(one.skippedTests, ['bench::live_run']);
  const two = runGate(root, [{ name: 'test', command: cargo }, { name: 'test-feature', command: cargo }]);
  assert.deepEqual(two.skippedTests, ['test: bench::live_run', 'test-feature: bench::live_run']);
  const none = runGate(root, [{ name: 'test', command: prints(['test result: ok. 3 passed; 0 failed; 0 ignored;']) }]);
  assert.equal(none.skippedTests, undefined);
});
