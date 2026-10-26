// 1.3.43: g84, the destructive guard lets a role remove the tests' leftovers inside gateTmp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProject } from './helpers.js';
import { runHook, fixture } from './hooks/run-hook.js';

async function call(root, command) {
  return runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Bash', tool_input: { command } }));
}
function setConfig(root, patch) {
  const file = path.join(root, 'team', 'config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...config, ...patch }));
}

// Seen live (Memory Agent T-106, 10-26): the developer's rm -rf D:/nac-tmp/t032b-fi-docs-* (gateTmp: D:/nac-tmp) was
// blocked as outside the project and the temp folder.
// The gate folder sits outside the project and outside os.tmpdir(), at the top of the temp folder's drive like D:/nac-tmp.
const gateTmp = path.join(path.parse(os.tmpdir()).root, 'nac-g84-gate-tmp');

test('g84: a recursive delete inside gateTmp is allowed, gateTmp itself and beside it are not', async () => {
  const root = makeProject();
  const leftover = `rm -rf "${path.join(gateTmp, 't032b-fi-docs-2824')}"`;
  assert.equal((await call(root, leftover)).status, 2, 'blocked without gateTmp in the config');
  setConfig(root, { gateTmp });
  assert.equal((await call(root, leftover)).status, 0);
  for (const c of [`rm -rf "${gateTmp}"`, `rm -rf "${gateTmp}-other/x"`, `rm -rf "${path.join(gateTmp, '..', 'x')}"`]) {
    assert.equal((await call(root, c)).status, 2, c);
  }
});

test('g84: a gateTmp that is a drive root or the home folder adds nothing, and deleteRoots still count', async () => {
  const root = makeProject();
  const keep = path.join(path.parse(os.tmpdir()).root, 'nac-g84-keep');
  for (const bad of [path.parse(os.homedir()).root, os.homedir()]) {
    setConfig(root, { gateTmp: bad, deleteRoots: [keep] });
    assert.equal((await call(root, `rm -rf "${path.join(bad, 'x', 'y')}"`)).status, 2, bad);
    assert.equal((await call(root, `rm -rf "${path.join(keep, 'x')}"`)).status, 0, bad);
  }
});
