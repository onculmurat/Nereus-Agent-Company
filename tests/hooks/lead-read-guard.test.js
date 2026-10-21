import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeProject } from '../helpers.js';
import { runHook, fixture } from './run-hook.js';

async function read(root, tool_input, extra = {}) {
  return runHook('lead-read-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Read', tool_input, agent_id: undefined, agent_type: undefined, ...extra }));
}
const project = () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'main.rs'), 'fn main() {}\n');
  fs.writeFileSync(path.join(root, 'team', 'big.log'), 'x'.repeat(50000));
  fs.writeFileSync(path.join(root, 'team', 'brief.md'), '# Brief\n');
  return root;
};

test('the lead may not read a source file or a large file whole (g48)', async () => {
  const root = project();
  const src = await read(root, { file_path: path.join(root, 'src', 'main.rs') });
  assert.equal(src.status, 2);
  assert.match(src.stderr, /source code/);
  const big = await read(root, { file_path: 'team/big.log' });
  assert.equal(big.status, 2);
  assert.match(big.stderr, /50 KB/);
  assert.equal((await read(root, { file_path: 'src/main.rs', limit: 500 })).status, 2);
});

test('a short slice, a small document and a role read pass', async () => {
  const root = project();
  assert.equal((await read(root, { file_path: 'src/main.rs', offset: 10, limit: 40 })).status, 0);
  assert.equal((await read(root, { file_path: 'team/big.log', limit: 100 })).status, 0);
  assert.equal((await read(root, { file_path: 'team/brief.md' })).status, 0);
  assert.equal((await read(root, { file_path: 'src/main.rs' }, { agent_id: 'a1', agent_type: 'backend-developer' })).status, 0);
});
