// 1.3.46: g87, a module whose findings are due for hardening is named after every close and in the next-task line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeProject, makeGitProject } from './helpers.js';
import { addFinding, hardeningDueModules } from '../scripts/lib/findings.js';
import { addEntry, updateEntry } from '../scripts/lib/board.js';
import { writeCompactHandoff } from '../scripts/lib/compact.js';
import { pluginRoot } from '../scripts/lib/hookio.js';

// Seen live (Memory Agent Q-204, 10-26): the lead told the owner every development task was done; memory had 14
// counted hardening findings and no hardening task in the phase. hardeningDue had shown once, on the add that crossed 8.
function seed(root, module, n, extra = {}) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.rs'), 'fn a() {}\n');
  for (let i = 0; i < n; i++) addFinding(root, { pluginRoot, module, file: 'src/a.rs', line: 1, severity: 'hardening', class: 'observed', task: 'T-001', text: `f${i}`, ...extra });
}

test('g87: modules at the batch with no open hardening task are due, largest first', () => {
  const root = makeProject();
  seed(root, 'memory', 9);
  seed(root, 'core', 12);
  seed(root, 'mcp', 3);
  seed(root, 'cli', 9, { origin: 'hardening' });
  seed(root, 'store', 9, { severity: 'minor' });
  assert.deepEqual(hardeningDueModules(root, [], 8), [{ module: 'core', counted: 12 }, { module: 'memory', counted: 9 }]);
  const entries = [{ id: 'T-9', module: 'core', hardening: 'yes', status: 'todo' }, { id: 'T-8', module: 'memory', hardening: 'yes', status: 'done' }];
  assert.deepEqual(hardeningDueModules(root, entries, 8), [{ module: 'memory', counted: 9 }], 'an open hardening task covers its module; a done one does not');
});

test('g87: the next-task line puts due hardening before the rest of the board', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  seed(p.root, 'memory', 8);
  const todo = addEntry(p.root, { title: 'fuzz run', owner: 'test-engineer', model: 'sonnet' });
  const e = addEntry(p.root, { title: 'done task', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, e.id, { status: 'done', commits: [p.commit('work.txt')] }, { singleCommit: 'test' });
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'board');
  const name = writeCompactHandoff(p.root, new Date(2026, 0, 1, 1, 0, 1), { trigger: 'manual' });
  const next = fs.readFileSync(path.join(p.root, 'team', 'work', 'handoffs', name), 'utf8').match(/^Next task: (.*)$/m)[1];
  assert.match(next, new RegExp(`^hardening due first: memory 8; ask the planner.*\\. Then ${todo.id}: fuzz run`));
});
