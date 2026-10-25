// 1.3.29: g68, an owner-only word used as a noun sent a planning question to the owner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerOnlyMatch, proxyDecideProblem } from '../scripts/lib/proxy.js';

const config = { ownerProxy: { session: 'agent-team-4e' } };

// Seen live (Memory Agent Q-188): "release work goes on" in a question about adding a hardening task matched
// "release"; the proxy answer was refused and the owner had to answer a planning question.
test('g68: release, publish and deploy used as a noun do not make a question owner-only', () => {
  const q188 = {
    title: 'Second cli hardening task this phase for the T-060 installer findings',
    source: 'T-060 security review; cli hit hardeningDue but T-095 is already the phase-5 cli hardening task',
    impact: 'a: one more cli hardening task now, closes the install attack before T-062..T-067. b: the findings wait for the phase-end batch; release work goes on, risk stays open until then.',
  };
  assert.equal(proxyDecideProblem(config, q188), undefined);
  for (const text of ['before the release tasks T-062 to T-067', 'a release blocker', 'before release', 'after the first release', 'the pre-release checklist', 'yayın görevleri bekler', 'yayından önce kapanmalı', 'yayına kalan iş']) {
    assert.equal(ownerOnlyMatch(text), null, text);
  }
});

test('g68: the owner-only actions still match', () => {
  for (const text of ['Shall I merge PR #12 into main?', 'publish v1.0 to crates.io', 'release v1.0 now', 'push the branch', 'deploy to production', 'sürümü yayınlayalım mı', 'delete the backup files', 'canlıya alalım mı']) {
    assert.ok(ownerOnlyMatch(text), text);
  }
  assert.match(proxyDecideProblem(config, { title: 'Merge PR #40 into main', source: '', impact: '' }), /matched "Merge"/);
});
