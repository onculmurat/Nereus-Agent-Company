// 1.3.69: g112, release named as a smoke check, a test or the product a test would fail is not the owner's action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyDecideProblem, ownerOnlyMatch } from '../scripts/lib/proxy.js';

const today = '2026-10-28';
const plain = { ownerProxy: { session: 'agent-team-4e', until: '2026-10-28' } };

// Seen live (Memory Agent, 10-28 05:4x): Q-243 asked where a key-list assertion lives; decisions.js refused the proxy
// answer as a release, the lead left it open for the owner and part of T-133 waited for the morning.
test('g112: Q-243 (a release smoke assertion that would fail the free release) is a proxy question', () => {
  const q243 = {
    title: 'F-423: release smoke assertion on the empty embedded public-key list',
    source: 'F-423, T-133 step 2, crates/core/src/license/mod.rs:43 (planner)',
    impact: 'A non-empty assertion in the release smoke would fail the free release; without it a paid build with an empty key list is not caught',
  };
  assert.equal(proxyDecideProblem(plain, q243, today), undefined);
  for (const t of ['release smoke check', 'release smoke tests', 'run it before a paid release', 'this breaks the pro release', 'the free release ships it empty']) {
    assert.equal(ownerOnlyMatch(t), null, t);
  }
});

test('g112: releasing and publishing are still the owner\'s action', () => {
  for (const t of ['Release the free version tonight?', 'Shall we release v0.1.0?', 'Publish the free release', 'push the tag']) {
    assert.ok(ownerOnlyMatch(t), t);
  }
});
