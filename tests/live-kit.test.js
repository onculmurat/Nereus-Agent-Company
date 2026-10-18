// The live test kit: hook recording (NAC_HOOK_LOG), the project preparer and the checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeProject } from './helpers.js';
import { pluginRoot, runHook, fixture } from './hooks/run-hook.js';
import { readBoard } from '../scripts/lib/board.js';
import { writeMessage } from '../scripts/lib/mailbox.js';

const live = (name, args) => spawnSync(process.execPath, [path.join(pluginRoot, 'tests', 'live', `${name}.js`), ...args], { encoding: 'utf8' });
const readLog = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('NAC_HOOK_LOG records each hook call with its outcome', async () => {
  const root = makeProject();
  const log = path.join(root, 'hooks.jsonl');
  runHook('session-start', await fixture('session-start-startup', { cwd: root }), { env: { NAC_HOOK_LOG: log } });
  runHook('session-start', await fixture('session-start-startup', { cwd: root, agent_id: 'a1', agent_type: 'architect' }), { env: { NAC_HOOK_LOG: log } });
  const [lead, mate] = readLog(log);
  assert.equal(lead.event, 'SessionStart');
  assert.equal(lead.payload.cwd, root);
  assert.equal(lead.outcome, 'output');
  assert.match(lead.excerpt, /^# NAC lead instructions/);
  assert.match(mate.excerpt, /not the team lead/);
});

test('without NAC_HOOK_LOG nothing is recorded', async () => {
  const root = makeProject();
  runHook('session-start', await fixture('session-start-startup', { cwd: root }), { env: { NAC_HOOK_LOG: '' } });
  assert.deepEqual(fs.readdirSync(root).sort(), ['team']);
});

test('prepare builds a set-up project with recording on and board entry T-001', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac live ')), 'project');
  const r = live('prepare', [dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'team', 'config.json')));
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.env.NAC_HOOK_LOG, path.join(dir, 'team', 'work', 'hook-log.jsonl'));
  assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  assert.equal(readBoard(dir).entries[0].id, 'T-001');
  assert.match(r.stdout, /--plugin-dir/);
  assert.equal(live('prepare', [dir]).status, 1, 'refuses a folder that already exists');
});

function recordedProject({ leadAnswer = 'no', teammateContext = 'You are architect on a NAC team, not the team lead.' } = {}) {
  const root = makeProject();
  const log = path.join(root, 'team', 'work', 'hook-log.jsonl');
  const rec = (event, payload, outcome, excerpt = '') => fs.appendFileSync(log, `${JSON.stringify({ event, payload: { hook_event_name: event, ...payload }, outcome, excerpt })}\n`);
  rec('SessionStart', { session_id: 's-lead', source: 'startup' }, 'output', '# NAC lead instructions');
  rec('SessionStart', { session_id: 's-mate', source: 'startup', agent_id: 'a1', agent_type: 'architect' }, 'output', teammateContext);
  rec('PostToolUse', { tool_name: 'SendMessage', agent_id: 'a1', tool_input: { to: 'main', message: 'x' } }, 'none');
  rec('TaskCompleted', { task_subject: 'T-001: Live check', teammate_name: 'architect' }, 'block', 'T-001 is not complete');
  rec('TeammateIdle', { teammate_name: 'architect' }, 'none');
  writeMessage(root, { from: 'architect', to: 'team-lead', thread: 'live-check', body: `ROLE=architect LEAD=${leadAnswer} INBOX=ok` });
  return root;
}

test('check passes a healthy recorded session', () => {
  const r = live('check', [recordedProject()]);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /FAIL/);
  assert.match(r.stdout, /L3 .*PASS/);
});

test('check fails when the teammate believes it is the lead', () => {
  const r = live('check', [recordedProject({ leadAnswer: 'yes' })]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /L3 .*FAIL/);
});

test('check fails when a teammate session received the lead prompt', () => {
  const r = live('check', [recordedProject({ teammateContext: '# NAC lead instructions' })]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /L2 .*FAIL/);
});

test('check reports missing evidence instead of passing', () => {
  const r = live('check', [makeProject()]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MISSING/);
});
