// 1.3.25: g63, the usage limit cut off two T-058 reviewers (Memory Agent); a role cut off after real work is
// continued with SendMessage, not re-dispatched from scratch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { agentStop, resumeAdvice, RESUME_MIN_TURNS } from '../scripts/lib/budget.js';

// The last line Claude Code writes when the limit stops a subagent (seen in T-058, agent a1e2128d0961c57f2).
const LIMIT = { type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', message: { id: 'synthetic-1', model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 9:40pm (Europe/Istanbul)" }] } };

function transcript(turns, { limit = false, role = 'nac:backend-developer', id = 'a1b2c3' } = {}) {
  const logs = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-logs-'));
  const dir = path.join(logs, 'D--proj', 'sess-1', 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const lines = Array.from({ length: turns }, (_, i) => ({ type: 'assistant', message: { id: `msg_${i}`, content: [{ type: 'text', text: 't' }] } }));
  if (limit) lines.push(LIMIT);
  const file = path.join(dir, `agent-${id}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: role }));
  return { logs, file, id };
}

test('g63: agentStop finds the limit stop and does not count it as a turn', () => {
  assert.deepEqual(agentStop(transcript(12, { limit: true }).file), { turns: 12, stoppedBy: 'limit', message: "You've hit your session limit · resets 9:40pm (Europe/Istanbul)" });
  assert.deepEqual(agentStop(transcript(12).file), { turns: 12, stoppedBy: null, message: null });
  assert.equal(agentStop('/no/such/file.jsonl'), null);
});

test('g63: resumeAdvice resumes after real work, else a fresh pack', () => {
  assert.equal(resumeAdvice({ turns: 20, stoppedBy: 'limit' }, 40).advice, 'resume');
  assert.equal(resumeAdvice({ turns: RESUME_MIN_TURNS - 1, stoppedBy: 'limit' }, 40).advice, 'fresh');
  assert.equal(resumeAdvice({ turns: RESUME_MIN_TURNS, stoppedBy: 'limit' }, 40).advice, 'resume');
  assert.match(resumeAdvice({ turns: 35, stoppedBy: 'limit' }, 40).why, /keeps its count/);
  assert.equal(resumeAdvice({ turns: 35, stoppedBy: 'limit' }, 40).advice, 'fresh');
  assert.equal(resumeAdvice({ turns: 20, stoppedBy: null }, 40).advice, 'none');
});

const cli = (root, ...args) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'agent-state.js'), ...args, '--project', root], { encoding: 'utf8' });

test('g63: agent-state.js names the role, the stop and the next step', () => {
  const root = makeProject();
  const t = transcript(20, { limit: true, role: 'nac:security-reviewer' });
  const r = cli(root, t.id, '--logs', t.logs);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.role, 'security-reviewer');
  assert.equal(out.turns, 20);
  assert.equal(out.stoppedBy, 'limit');
  assert.equal(out.advice, 'resume');
  assert.match(out.next, new RegExp(`SendMessage to "${t.id}"`));
  assert.match(out.next, /Not a round/);
  const short = transcript(3, { limit: true, id: 'a9' });
  const s = JSON.parse(cli(root, 'a9', '--logs', short.logs).stdout);
  assert.equal(s.advice, 'fresh');
  assert.match(s.next, /pack\.js <task> --role backend-developer/);
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ turnBudget: 22 }));
  assert.equal(JSON.parse(cli(root, t.id, '--logs', t.logs).stdout).advice, 'fresh', 'turnBudget comes from the project config');
});

test('g63: agent-state.js refuses a bad or unknown agent id', () => {
  const root = makeProject();
  const t = transcript(5);
  assert.equal(cli(root, '../x', '--logs', t.logs).status, 1);
  const r = cli(root, 'nope', '--logs', t.logs);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No transcript for agent nope/);
});

test('g63: the task loop says to run agent-state.js and never to count a limit stop as a round', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(skill, /agent-state\.js <agentId>/);
  assert.match(skill, /Never `board\.js round` for a limit stop \(g63\)/);
});
