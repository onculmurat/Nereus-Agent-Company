// 1.3.42: g83, releasing a handle or a lock is not the owner's release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerOnlyMatch, proxyDecideProblem } from '../scripts/lib/proxy.js';

const config = { ownerProxy: { session: 'agent-team-4e' } };

// Seen live (Memory Agent Q-198, 10-26): a question about freeing index.db and its lock when mcp serve returns was
// refused as a release; the lead opened a box for the owner.
test('g83: releasing a handle, a lock, a file or memory does not make a question owner-only', () => {
  const q198 = {
    title: 'T-106: wire evict_all at the end of mcp serve?',
    source: 'planner, T-106 brief (F-739, D-330)',
    impact: 'A: graceful mcp shutdown gets up to ~2 s longer, production path runs the same release code the tests prove. B: only evict_root for tests, shutdown caller named in D-330 stays unwired',
  };
  assert.equal(proxyDecideProblem(config, q198), undefined);
  for (const text of ['the watcher releases index.db and index.lock', 'release the file handles before the dir goes', 'it releases its locks on drop', 'release memory early', 'the release path of the guard']) {
    assert.equal(ownerOnlyMatch(text), null, text);
  }
});

test('g83: the owner release still matches', () => {
  for (const text of ['release v1.0 now', 'release the code to users', 'shall we release?', 'release 0.2.0 to crates.io']) {
    assert.ok(ownerOnlyMatch(text), text);
  }
});
