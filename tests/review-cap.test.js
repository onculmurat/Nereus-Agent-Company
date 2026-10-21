import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { addEntry, incrementRound, readBoard } from '../scripts/lib/board.js';
import { addQuestion, decide } from '../scripts/lib/decisions.js';
import { validateConfig } from '../scripts/lib/config.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const defaults = JSON.parse(read('defaults', 'config.json'));
const boardCli = path.join(pluginRoot, 'scripts', 'board.js');

const task = (cfg = {}) => {
  const root = makeProject();
  const e = addEntry(root, { title: 'x', owner: 'backend-developer', model: 'sonnet' });
  return { root, id: e.id, config: { ...defaults, ...cfg } };
};
const decision = (root) => {
  const q = addQuestion(root, { title: 'Approach?', source: 's', status: 'st', impact: 'i', blocking: 'yes' });
  return decide(root, q.id, { answer: 'Use the architect option B' }).id;
};

test('reviewRoundCap is 2 in the defaults and validated as a positive integer', () => {
  assert.equal(defaults.reviewRoundCap, 2);
  assert.doesNotThrow(() => validateConfig(defaults));
  for (const bad of [0, -1, 1.5, '2']) assert.throws(() => validateConfig({ ...defaults, reviewRoundCap: bad }), /reviewRoundCap/);
});

test('the third round is refused at the cap, names the next step, and leaves the board unchanged', () => {
  const { root, id, config } = task();
  incrementRound(root, id, config);
  incrementRound(root, id, config);
  assert.throws(() => incrementRound(root, id, config), (e) => /cap reached/i.test(e.message) && /architect/.test(e.message) && /owner/.test(e.message) && /--approach/.test(e.message));
  assert.equal(readBoard(root).entries[0].rounds, 2);
});

test('--approach with a recorded decision id allows the round and opens a new window of two', () => {
  const { root, id, config } = task();
  incrementRound(root, id, config);
  incrementRound(root, id, config);
  const d = decision(root);
  const r = incrementRound(root, id, config, { approach: d });
  assert.equal(r.entry.rounds, 3);
  assert.equal(readBoard(root).entries[0].approach, d);
  incrementRound(root, id, config);
  assert.equal(readBoard(root).entries[0].rounds, 4);
  assert.throws(() => incrementRound(root, id, config), /cap reached/i);
  const d2 = decision(root);
  assert.equal(incrementRound(root, id, config, { approach: d2 }).entry.rounds, 5);
});

test('an unknown decision id is refused and the round is not counted', () => {
  const { root, id, config } = task();
  incrementRound(root, id, config);
  incrementRound(root, id, config);
  assert.throws(() => incrementRound(root, id, config, { approach: 'D-999' }), /D-999/);
  assert.throws(() => incrementRound(root, id, config, { approach: 'Q-001' }), /Q-001/);
  assert.equal(readBoard(root).entries[0].rounds, 2);
});

test('the config override is honoured', () => {
  const { root, id, config } = task({ reviewRoundCap: 4 });
  for (let i = 0; i < 4; i++) incrementRound(root, id, config);
  assert.throws(() => incrementRound(root, id, config), /cap reached/i);
});

test('board.js round refuses at the cap and accepts --approach <id>; team/config.json overrides the cap', () => {
  const { root, id } = task();
  const run = (...a) => spawnSync(process.execPath, [boardCli, ...a, '--reason', 'review', '--project', root], { encoding: 'utf8' });
  assert.equal(run('round', id).status, 0);
  assert.equal(run('round', id).status, 0);
  const refused = run('round', id);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /cap reached/i);
  const d = decision(root);
  const ok = run('round', id, '--approach', d);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).entry.rounds, 3);
  const other = task();
  fs.writeFileSync(path.join(other.root, 'team', 'config.json'), JSON.stringify({ reviewRoundCap: 3 }));
  const run2 = (...a) => spawnSync(process.execPath, [boardCli, ...a, '--reason', 'review', '--project', other.root], { encoding: 'utf8' });
  for (let i = 0; i < 3; i++) assert.equal(run2('round', other.id).status, 0);
  assert.equal(run2('round', other.id).status, 1);
});

test('task-loop and escalation skills carry the rule; lead.md and the reviewers mention nothing new in lead.md', () => {
  for (const f of ['task-loop', 'escalation']) {
    const t = read('skills', f, 'SKILL.md');
    assert.match(t, /reviewRoundCap/);
    assert.match(t, /--approach/);
    assert.match(t, /architect/);
  }
  assert.doesNotMatch(read('prompts', 'lead.md'), /reviewRoundCap/);
});

test('reviewers say when a finding is the same class as one from an earlier round', () => {
  for (const r of ['code-reviewer', 'security-reviewer']) {
    assert.match(read('agents', `${r}.md`), /same class as (one|a finding)[^\n]*earlier round[^\n]*say so/i);
  }
});

test('READMEs describe the review round cap in both languages', () => {
  for (const f of ['README.md', 'README.tr.md']) {
    const t = read(f);
    assert.ok(t.includes('reviewRoundCap'), `${f} lacks reviewRoundCap`);
    assert.ok(t.includes('--approach'), `${f} lacks --approach`);
  }
});

test('board.js round needs --reason and refuses a turn-budget stop (g46)', () => {
  const { root, id } = task();
  const run = (...a) => spawnSync(process.execPath, [boardCli, 'round', id, ...a, '--project', root], { encoding: 'utf8' });
  const none = run();
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /reason/);
  const budget = run('--reason', 'budget');
  assert.notEqual(budget.status, 0);
  assert.match(budget.stderr, /not a round/);
  assert.notEqual(run('--reason', 'other').status, 0);
  assert.equal(readBoard(root).entries[0].rounds, 0);
  const ok = run('--reason', 'gate');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).entry.rounds, 1);
});
