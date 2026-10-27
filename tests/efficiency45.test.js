// 1.3.59: g101, a recursive delete inside Claude Code's own temp folder (CLAUDE_CODE_TMPDIR) passes the guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { makeProject } from './helpers.js';
import { runHook, fixture } from './hooks/run-hook.js';

// Seen live (Memory Agent T-117, 10-27): the round 1 developer's rm -rf "D:/Claude Sessions/_tmp/demo-r1" was blocked
// as "outside the project and the temp folders"; that folder is the CLAUDE_CODE_TMPDIR the scratchpad lives in.
test('g101: a delete inside CLAUDE_CODE_TMPDIR passes; the folder itself and beside it are blocked', async () => {
  const root = makeProject();
  const claudeTmp = path.join(path.parse(os.tmpdir()).root, 'nac-g101-claude-tmp');
  const call = async (command, env) => (await runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Bash', tool_input: { command } }), { env })).status;
  const set = { CLAUDE_CODE_TMPDIR: claudeTmp };
  assert.equal(await call(`rm -rf "${path.join(claudeTmp, 'demo-r1')}"`, set), 0);
  assert.equal(await call(`rm -rf "${claudeTmp}"`, set), 2);
  assert.equal(await call(`rm -rf "${path.join(path.dirname(claudeTmp), 'other')}"`, set), 2);
  assert.equal(await call(`rm -rf "${path.join(claudeTmp, 'demo-r1')}"`, { CLAUDE_CODE_TMPDIR: '' }), 2);
});
