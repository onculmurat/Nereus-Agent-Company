// 1.3.8: g36, a role ran past its turn budget into the maxTurns hard stop with no report and no commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject, makeGitProject } from './helpers.js';
import { runHook, pluginRoot } from './hooks/run-hook.js';
import { countTurns, budgetNotice, readBudgetStops, recordBudgetStop } from '../scripts/lib/budget.js';
import { addEntry, readBoard } from '../scripts/lib/board.js';
import { writePack } from '../scripts/lib/pack.js';

// Seen live (T-081): backend-developer used all 45 turns (budget 40 + 5 for the report), stopped by maxTurns
// with three new files uncommitted and no report; the pack's "Budget: 40 model turns" line was the only signal.
// A role cannot count its own turns, so the hook counts them from the role's transcript and tells it.
function session(turns) {
  const root = makeProject();
  const projects = fs.mkdtempSync(path.join(path.dirname(root), 'nac-logs-'));
  const sessionId = 'sess-1';
  const agentId = 'a1b2c3';
  const lead = path.join(projects, `${sessionId}.jsonl`);
  fs.writeFileSync(lead, '');
  fs.mkdirSync(path.join(projects, sessionId, 'subagents'), { recursive: true });
  // Two lines per turn share one message id (text + tool_use), as Claude Code writes them.
  const lines = Array.from({ length: turns }, (_, i) => [
    { type: 'assistant', message: { id: `msg_${i}`, content: [{ type: 'text', text: 't' }] } },
    { type: 'assistant', message: { id: `msg_${i}`, content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'Read', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `toolu_${i}` }] } },
  ]).flat();
  const log = path.join(projects, sessionId, 'subagents', `agent-${agentId}.jsonl`);
  fs.writeFileSync(log, lines.map((l) => JSON.stringify(l)).join('\n'));
  const payload = { hook_event_name: 'PostToolUse', cwd: root, session_id: sessionId, transcript_path: lead, agent_id: agentId, agent_type: 'nac:backend-developer', tool_name: 'Read', tool_input: {}, tool_response: {} };
  return { root, log, payload };
}
const context = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '');

test('g36: countTurns counts distinct assistant message ids', () => {
  assert.equal(countTurns(session(7).log), 7);
  assert.equal(countTurns('/no/such/file.jsonl'), 0);
});

test('g36: budgetNotice is silent early, warns in the last 5 turns, and says stop at the budget', () => {
  assert.equal(budgetNotice(34, 40), null);
  assert.match(budgetNotice(35, 40), /35 of 40 turns; 5 left/);
  assert.match(budgetNotice(35, 40), /finish the step you are on/);
  assert.match(budgetNotice(40, 40), /reached your budget of 40 turns/);
  assert.match(budgetNotice(42, 40), /Stop now/);
  assert.match(budgetNotice(42, 40), /do not commit \(g61\)/);
  assert.match(budgetNotice(42, 40), /what is done, what is left/);
});

test('g36: the hook tells a NAC role its budget from its own transcript', () => {
  const { root, payload } = session(40);
  const r = runHook('turn-budget', payload);
  assert.equal(r.status, 0, r.stderr);
  assert.match(context(r), /NAC turn budget/);
  assert.match(context(r), /reached your budget of 40 turns/);
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ turnBudget: 60 }));
  assert.equal(runHook('turn-budget', payload).stdout, '', 'turnBudget comes from the project config');
});

test('g36: the hook says nothing to the lead, to a non-NAC agent, or below the warning line', () => {
  const { payload } = session(40);
  assert.equal(runHook('turn-budget', { ...payload, agent_id: undefined, agent_type: undefined }).stdout, '');
  assert.equal(runHook('turn-budget', { ...payload, agent_type: 'general-purpose' }).stdout, '');
  assert.equal(runHook('turn-budget', session(10).payload).stdout, '');
});

test('g36: the hook is registered after SendMessage for every tool', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks.PostToolUse;
  const entry = hooks.find((m) => m.hooks.some((h) => /turn-budget\.js/.test(h.command)));
  assert.ok(entry);
  assert.equal(entry.matcher, undefined);
});

// 1.3.23: g60, Memory Agent counted three budget stops as `board.js round --reason stuck` (T-053 twice, T-054b).
test('g60: the hook records a budget stop per role, and only at the budget', () => {
  const below = session(39);
  runHook('turn-budget', below.payload);
  assert.deepEqual(readBudgetStops(below.root), {});
  const { root, payload } = session(40);
  runHook('turn-budget', payload);
  const stop = readBudgetStops(root)['backend-developer'];
  assert.equal(stop.agentId, 'a1b2c3');
  assert.equal(stop.turns, 40);
});

test('g60: round --reason stuck is refused after a budget stop until a fresh pack for the role', () => {
  const { root, payload } = session(40);
  const e = addEntry(root, { title: 'x', owner: 'backend-developer', model: 'sonnet' });
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', `${e.id}.md`), `# ${e.id}: x
`);
  runHook('turn-budget', payload);
  const round = (reason) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'board.js'), 'round', e.id, '--reason', reason, '--project', root], { encoding: 'utf8' });
  const stuck = round('stuck');
  assert.notEqual(stuck.status, 0);
  assert.match(stuck.stderr, /turn budget .*not a stuck round \(g60/);
  assert.match(stuck.stderr, /pack\.js T-\d+ --role backend-developer/);
  assert.equal(readBoard(root).entries[0].rounds, 0);
  assert.equal(round('gate').status, 0, 'a red gate still counts');
  writePack(root, { id: e.id, role: 'code-reviewer' });
  assert.ok(readBudgetStops(root)['backend-developer'], 'another role\'s pack leaves the record');
  writePack(root, { id: e.id, role: 'backend-developer' });
  assert.deepEqual(readBudgetStops(root), {});
  const ok = round('stuck');
  assert.equal(ok.status, 0, ok.stderr);
});

test('g60: a role in a worktree records its stop in the main tree', () => {
  const { root, git } = makeGitProject();
  git('add', 'team/config.json');
  git('commit', '-q', '-m', 'team');
  const wt = path.join(path.dirname(root), `${path.basename(root)}-wt`);
  git('worktree', 'add', '-q', '-b', 'wt', wt);
  recordBudgetStop(wt, { role: 'backend-developer', agentId: 'a1', turns: 40 });
  assert.ok(readBudgetStops(root)['backend-developer']);
  assert.ok(!fs.existsSync(path.join(wt, 'team', 'work', 'budget-stops.json')));
});
