// 1.3.24: g61, a role at its turn budget committed red work (T-058 0ea2311, 7 of 12 pre_tool_use tests red);
// g62, the destructive guard refused the owner's own scratch folder (D:/Claude Sessions/<project>/tmp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProject, makeGitProject } from './helpers.js';
import { runHook, pluginRoot } from './hooks/run-hook.js';
import { isGitCommit, budgetCommitBlock } from '../scripts/lib/budget.js';
import { checkDestructive } from '../scripts/lib/destructive.js';
import { checkDeleteRoots, validateConfig, loadConfig } from '../scripts/lib/config.js';
import { addEntry } from '../scripts/lib/board.js';
import { buildPack } from '../scripts/lib/pack.js';

// A role transcript with `turns` model turns, and a PreToolUse payload for one command.
function session(turns, command, root = makeProject()) {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-logs-'));
  const sessionId = 'sess-1';
  const agentId = 'a1b2c3';
  const lead = path.join(projects, `${sessionId}.jsonl`);
  fs.writeFileSync(lead, '');
  fs.mkdirSync(path.join(projects, sessionId, 'subagents'), { recursive: true });
  const lines = Array.from({ length: turns }, (_, i) => ({ type: 'assistant', message: { id: `msg_${i}`, content: [{ type: 'text', text: 't' }] } }));
  fs.writeFileSync(path.join(projects, sessionId, 'subagents', `agent-${agentId}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
  const payload = { hook_event_name: 'PreToolUse', cwd: root, session_id: sessionId, transcript_path: lead, agent_id: agentId, agent_type: 'nac:backend-developer', tool_name: 'Bash', tool_input: { command } };
  return { root, payload };
}

test('g61: isGitCommit finds git commit in its usual spellings and nothing else', () => {
  for (const c of ['git commit -m x', 'git add -A && git commit -q -m "wip: x"', 'cd "D:/p" ; git -C "D:/a b" commit -m x', 'git -c user.name=x commit', 'git.exe commit --amend', 'git --no-pager commit']) {
    assert.ok(isGitCommit(c), c);
  }
  for (const c of ['git status', 'git log --grep commit', 'git commit-tree HEAD^{tree}', 'cargo test', 'node team-commit.js', 'gitcommit']) {
    assert.ok(!isGitCommit(c), c);
  }
});

test('g61: budgetCommitBlock blocks only at the budget', () => {
  assert.equal(budgetCommitBlock(39, 40), null);
  assert.match(budgetCommitBlock(40, 40), /at your budget \(40 of 40 turns\)/);
  assert.match(budgetCommitBlock(41, 40), /Leave the changes uncommitted/);
});

test('g61: the hook refuses git commit from a NAC role at its budget, and only then', () => {
  const at = session(50, 'git add -A && git commit -m "wip"');
  const r = runHook('budget-commit-guard', at.payload);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /do not commit now \(g61\)/);
  assert.equal(runHook('budget-commit-guard', { ...at.payload, tool_input: { command: 'cargo test' } }).status, 0, 'other commands pass');
  assert.equal(runHook('budget-commit-guard', session(49, 'git commit -m x').payload).status, 0, 'below the budget a commit passes');
  assert.equal(runHook('budget-commit-guard', { ...at.payload, agent_id: undefined, agent_type: undefined }).status, 0, 'the lead is not checked');
  assert.equal(runHook('budget-commit-guard', { ...at.payload, agent_type: 'general-purpose' }).status, 0, 'a non-NAC agent is not checked');
  fs.writeFileSync(path.join(at.root, 'team', 'config.json'), JSON.stringify({ turnBudget: 60 }));
  assert.equal(runHook('budget-commit-guard', at.payload).status, 0, 'turnBudget comes from the project config');
});

test('g61: the hook is registered for Bash and PowerShell', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const entry = hooks.find((m) => m.hooks.some((h) => /budget-commit-guard\.js/.test(h.command)));
  assert.equal(entry?.matcher, 'Bash|PowerShell');
});

test('g61: a pack names the uncommitted changed and new files, with or without a base', () => {
  const p = makeGitProject();
  fs.mkdirSync(path.join(p.root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'tasks', 'T-1.md'), '# T-1: x\n');
  fs.writeFileSync(path.join(p.root, 'a.txt'), 'one\n');
  addEntry(p.root, { id: 'T-1', title: 'x', owner: 'backend-developer', model: 'sonnet' });
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'seed');
  assert.ok(!buildPack(p.root, { id: 'T-1', role: 'backend-developer' }).text.includes('## Uncommitted work'), 'a clean tree has no section');
  fs.writeFileSync(path.join(p.root, 'a.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(p.root, 'b.txt'), 'new\n');
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'note.md'), 'state\n');
  const { text } = buildPack(p.root, { id: 'T-1', role: 'backend-developer' });
  const section = text.split('## Uncommitted work in the tree')[1];
  assert.ok(section, text);
  assert.match(section, /- a\.txt \(changed\)/);
  assert.match(section, /- b\.txt \(new\)/);
  assert.ok(!section.includes('note.md'), 'team/ is state, not code');
});

// g62: unit level on a fixed fake Windows machine, like tests/hooks/destructive-guard.test.js.
const WIN = { platform: 'win32', root: 'D:\\Projects\\Memory Agent', cwd: 'D:\\Projects\\Memory Agent', home: 'C:\\Users\\u', tmpDirs: ['C:\\Users\\u\\AppData\\Local\\Temp'], canonicalize: false };
const ROOTS = ['D:\\Claude Sessions\\Memory Agent\\tmp', 'D:\\Claude Sessions\\Memory Agent\\build'];

test('g62: deleteRoots let a recursive delete inside them, never the folder itself or beside it', () => {
  const seen = 'rm -rf "D:/Claude Sessions/Memory Agent/tmp/x1"';
  assert.match(checkDestructive(seen, { ...WIN, toolName: 'Bash' }), /outside the project and the temp folder\b/);
  assert.equal(checkDestructive(seen, { ...WIN, deleteRoots: ROOTS, toolName: 'Bash' }), null);
  assert.equal(checkDestructive('Remove-Item -Recurse -Force "D:\\Claude Sessions\\Memory Agent\\build\\debug"', { ...WIN, deleteRoots: ROOTS, toolName: 'PowerShell' }), null);
  for (const c of ['rm -rf "D:/Claude Sessions/Memory Agent/tmp"', 'rm -rf "D:/Claude Sessions/Memory Agent/notlar"', 'rm -rf "D:/Claude Sessions/Memory Agent/tmp/../notlar"', 'rm -rf "D:/Claude Sessions"']) {
    const r = checkDestructive(c, { ...WIN, deleteRoots: ROOTS, toolName: 'Bash' });
    assert.ok(r, `should be blocked: ${c}`);
    assert.match(r, /the temp folder and deleteRoots in team\/config\.json/);
  }
});

test('g62: checkDeleteRoots refuses relative paths, drive roots, home and folders above home', () => {
  const home = os.homedir();
  assert.deepEqual(checkDeleteRoots(undefined), []);
  assert.deepEqual(checkDeleteRoots([path.join(home, 'scratch')]), [path.join(home, 'scratch')]);
  for (const bad of ['tmp', path.parse(home).root, home, path.dirname(home), 'x'.repeat(0)]) {
    assert.throws(() => checkDeleteRoots([bad]), /deleteRoots entries must be absolute folders/, JSON.stringify(bad));
  }
  assert.throws(() => checkDeleteRoots('D:/x'), /must be a list/);
  const cfg = loadConfig({ pluginRoot, projectRoot: makeProject() });
  assert.throws(() => validateConfig({ ...cfg, deleteRoots: [home] }), /deleteRoots/);
  validateConfig({ ...cfg, deleteRoots: [path.join(home, 'scratch')] });
});

test('g62: the guard hook reads deleteRoots from the project config, and ignores a bad list', () => {
  const root = makeProject();
  const scratch = fs.mkdtempSync(path.join(path.dirname(root), 'nac-scratch-'));
  fs.mkdirSync(path.join(scratch, 'x1'));
  const payload = { hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Bash', tool_input: { command: `rm -rf "${path.join(scratch, 'x1').split(path.sep).join('/')}"` } };
  const outside = fs.mkdtempSync(path.join(os.homedir(), '.nac-g62-'));
  try {
    const away = { ...payload, tool_input: { command: `rm -rf "${path.join(outside, 'x').split(path.sep).join('/')}"` } };
    assert.equal(runHook('destructive-guard', away).status, 2, 'outside the project and temp is blocked');
    fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ deleteRoots: [outside] }));
    assert.equal(runHook('destructive-guard', away).status, 0, 'a deleteRoots folder is allowed');
    fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ deleteRoots: [outside, path.parse(outside).root] }));
    assert.equal(runHook('destructive-guard', away).status, 2, 'a list with a drive root is ignored as a whole');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
  assert.equal(runHook('destructive-guard', payload).status, 0, 'the temp folder still works');
});
