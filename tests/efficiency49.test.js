// 1.3.63: g105, a merge named as needing a separate owner OK is not the owner's merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownerOnlyMatch, proxyDecideProblem } from '../scripts/lib/proxy.js';

const config = { ownerProxy: { session: 'agent-team-4e' } };

// Seen live (Memory Agent Q-223, 10-27): the phase 6 plan question listed the merge to main as an item it leaves with the
// owner; the proxy decide was refused as a merge and the lead opened a box for the owner.
test('g105: a merge that needs a separate owner OK does not make a question owner-only', () => {
  const q223 = {
    title: 'Faz 5 kapanisi ve faz 6 plani onayi',
    source: 'Faz 5 raporu; 148 gorev done, blocker 0, masker guvenlik PASS 504513b',
    impact: "Onayla board.js phase 6 calisir; plan: 1) bench hardening, 4) bekletmeler surer (T-037, T-103), 5) main'e merge ayri owner onayi (D-034)",
  };
  assert.equal(proxyDecideProblem(config, q223), undefined);
  for (const text of ['merge to main needs a separate owner OK', 'the merge stays with the owner', 'merge into main requires owner approval', "main'e merge ayrı kullanıcı onayıyla"]) {
    assert.equal(ownerOnlyMatch(text), null, text);
  }
});

test('g105: the owner merge still matches', () => {
  for (const text of ['merge build/asama-1 into main now?', 'shall we merge to main?', "main'e merge edelim mi", 'merge the PR and push']) {
    assert.ok(ownerOnlyMatch(text), text);
  }
});
