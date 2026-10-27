// 1.3.68: g110, a time-bound full owner proxy also decides merge, spending, irreversible steps and deleting data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAskUser, proxyContext, proxyDecideProblem } from '../scripts/lib/proxy.js';
import { validateConfig, loadConfig } from '../scripts/lib/config.js';
import { pluginRoot } from '../scripts/lib/hookio.js';
import { planProxy, withProxyBlock } from '../scripts/lib/setup.js';
import { makeProject } from './helpers.js';

const today = '2026-10-28';
const plain = { ownerProxy: { session: 'agent-team-4e', until: '2026-10-28' } };
const full = { ownerProxy: { session: 'agent-team-4e', until: '2026-10-28', full: true } };
const box = (question) => ({ questions: [{ header: 'Night', question }] });

// Seen live (Memory Agent, 10-28 01:2x): the owner gave the night answers (merge, live bench) to the proxy and went to
// sleep; the lead still opened owner boxes for both, and the owner said a night box stops the work.
test('g110: a full proxy decides merge, a spending step and deleting data; push and publish stay with the owner', () => {
  const merge = { title: 'Merge build/asama-1 into main tonight?', irreversible: 'no' };
  const bench = { title: 'Run the live bench T-061 now', irreversible: 'yes' };
  const purge = { title: 'Delete the old bench data folders', irreversible: 'yes' };
  assert.match(proxyDecideProblem(plain, merge, today), /merge/);
  assert.match(proxyDecideProblem(plain, bench, today), /irreversible/);
  for (const q of [merge, bench, purge]) assert.equal(proxyDecideProblem(full, q, today), undefined, q.title);
  assert.match(proxyDecideProblem(full, { title: 'Push the tag and publish the crate' }, today), /full proxy/);
  assert.equal(checkAskUser(full, box('Shall we merge into main?'), today)?.block !== undefined, true);
  assert.equal(checkAskUser(full, box('Shall we push the branch?'), today), undefined);
  assert.equal(checkAskUser(plain, box('Shall we merge into main?'), today), undefined);
});

test('g110: a full proxy ends with its date and then acts like no proxy', () => {
  const merge = { title: 'Merge into main' };
  assert.match(proxyDecideProblem(full, merge, '2026-10-29'), /expired/);
  assert.match(proxyContext(full, today), /Full proxy until 2026-10-28/);
  assert.doesNotMatch(proxyContext(plain, today), /Full proxy/);
});

test('g110: full needs until and is true only; setup writes it and the CLAUDE.md block says so', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: 'none.json' });
  assert.throws(() => validateConfig({ ...base, ownerProxy: { session: 'x', full: true } }), /until/);
  assert.throws(() => validateConfig({ ...base, ownerProxy: { session: 'x', until: today, full: 'yes' } }), /full/);
  validateConfig({ ...base, ...full });
  const root = makeProject();
  const plan = planProxy(root, { session: 'agent-team-4e', until: today, full: true });
  assert.deepEqual(plan.after.ownerProxy, full.ownerProxy);
  assert.match(withProxyBlock('', plan.after.ownerProxy), /full proxy[\s\S]*Push, deploy and publish stay with me/);
});
