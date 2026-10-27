// 1.3.65: g107, release named as a module (its hardening task, scan or gate) is not the owner's release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerOnlyMatch, proxyDecideProblem } from '../scripts/lib/proxy.js';

const config = { ownerProxy: { session: 'agent-team-4e' } };

// Seen live (Memory Agent Q-234, 10-27): the phase 6 plan asked for a second hardening task on the release module; the
// proxy decide was refused as a release and the lead opened a box for the owner.
test('g107: release named as a module does not make a question owner-only', () => {
  const q234 = {
    title: 'Second release hardening task in phase 6 (H-13 after H-12)',
    source: 'hardening-plan-phase6.md H-13; board.js refused: release already has T-134 (H-12)',
    impact: 'Without approval the release secret scan misses UTF-16 files and common key shapes in the free release; these 4 go on the known-limit list',
  };
  assert.equal(proxyDecideProblem(config, q234), undefined);
  for (const text of ['the release module gets a second task', 'release workflow tests', 'release gate is red', 'a gap in the release']) {
    assert.equal(ownerOnlyMatch(text), null, text);
  }
});

test('g107: the owner release still matches', () => {
  for (const text of ['release v1.0 now?', 'shall we release it?', 'cut the release and publish the crate', 'deploy to production']) {
    assert.ok(ownerOnlyMatch(text), text);
  }
});
