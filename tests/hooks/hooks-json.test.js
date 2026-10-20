import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from '../helpers.js';
import { pluginRoot, fixture } from './run-hook.js';

const hooksJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
const commandsFor = (event) => hooksJson.hooks[event].flatMap((m) => m.hooks.map((h) => h.command));

test('registers the research guard on every tool call', () => {
  const entry = hooksJson.hooks.PreToolUse?.[0];
  assert.ok(entry, 'no PreToolUse entry');
  assert.equal(entry.matcher, undefined, 'the guard must see every tool, so unknown tools can be closed');
  assert.match(entry.hooks[0].command, /hooks\/research-guard\.js"$/);
});

test('registers the seven events with quoted plugin-root commands', () => {
  assert.deepEqual(Object.keys(hooksJson.hooks).sort(), ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'TaskCompleted', 'TeammateIdle']);
  assert.equal(hooksJson.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(hooksJson.hooks.PostToolUse[0].matcher, 'SendMessage');
  assert.match(hooksJson.hooks.PostToolUse[1].hooks[0].command, /turn-budget.js/);
  for (const event of Object.keys(hooksJson.hooks)) {
    for (const cmd of commandsFor(event)) {
      assert.match(cmd, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.js"$/);
      const file = /hooks\/([a-z-]+\.js)/.exec(cmd)[1];
      assert.ok(fs.existsSync(path.join(pluginRoot, 'hooks', file)), file);
    }
  }
});

test('commands run when the plugin root path contains a space', async () => {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac-')), 'Plugin Root');
  for (const dir of ['hooks', 'scripts', 'defaults', 'prompts', 'agents']) {
    fs.cpSync(path.join(pluginRoot, dir), path.join(copy, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(pluginRoot, 'package.json'), path.join(copy, 'package.json'));
  const root = makeProject();
  const cmd = commandsFor('SessionStart')[0].replace('${CLAUDE_PLUGIN_ROOT}', copy.split(path.sep).join('/'));
  const r = spawnSync(cmd, { shell: true, input: JSON.stringify(await fixture('session-start-startup', { cwd: root })), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Phase: 0/);
});
