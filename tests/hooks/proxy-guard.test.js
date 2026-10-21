import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeProject } from '../helpers.js';
import { runHook, fixture } from './run-hook.js';

const ask = (question) => ({ questions: [{ header: 'T-085', question, options: [{ label: 'a', description: 'a' }, { label: 'b', description: 'b' }], multiSelect: false }] });
async function call(root, tool_input, extra = {}) {
  return runHook('proxy-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'AskUserQuestion', tool_input, agent_id: undefined, agent_type: undefined, ...extra }));
}
const withProxy = (proxy) => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify(proxy ? { ownerProxy: proxy } : {}));
  return root;
};

test('with an active owner proxy the lead may not open an AskUserQuestion box (g47)', async () => {
  const root = withProxy({ session: 'vault-77' });
  const r = await call(root, ask('Which module should sh_quote move to?'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /vault-77/);
  assert.match(r.stderr, /SendMessage/);
});

test('owner-only actions and an unreachable proxy still use the box', async () => {
  const root = withProxy({ session: 'vault-77' });
  assert.equal((await call(root, ask('May I push the branch and merge PR #12?'))).status, 0);
  assert.equal((await call(root, ask('Deploy to production now?'))).status, 0);
  assert.equal((await call(root, ask('Owner direct: vault-77 is not in ListAgents. Which module?'))).status, 0);
});

test('no proxy, an expired proxy or a subagent call is not touched', async () => {
  assert.equal((await call(withProxy(null), ask('Which module?'))).status, 0);
  assert.equal((await call(withProxy({ session: 'vault-77', until: '2020-01-01' }), ask('Which module?'))).status, 0);
  assert.equal((await call(withProxy({ session: 'vault-77' }), ask('Which module?'), { agent_id: 'a1', agent_type: 'planner' })).status, 0);
});
