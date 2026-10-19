import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';
import { validateConfig } from '../scripts/lib/config.js';
import { buildPack } from '../scripts/lib/pack.js';
import { makeProject } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');

// Item 0: the lead prompt keeps only what every session start needs; phase detail lives in skill `phases`.
test('lead prompt points to skill phases and is at least 600 characters smaller than before', () => {
  const lead = read('prompts', 'lead.md');
  assert.match(lead, /skill `phases`/);
  assert.ok(lead.length <= 7670 - 600, `lead.md is ${lead.length} characters`);
  const { data } = parseFrontmatter(read('skills', 'phases', 'SKILL.md'));
  assert.equal(data.name, 'phases');
  assert.ok(data.description);
});

test('rules moved out of the lead prompt are still reachable in skill phases', () => {
  const lead = read('prompts', 'lead.md');
  const phases = read('skills', 'phases', 'SKILL.md');
  const section = (n) => phases.split(new RegExp(`^## Phase ${n}\\b`, 'm'))[1]?.split('\n## ')[0] ?? '';
  assert.match(section(0), /exactly one question[^\n]*no sub-questions[^\n]*no preview/i);
  assert.match(section(0), /never join two questions with "and"/i);
  assert.match(section(0), /team\/brief\.md/);
  assert.match(section(1), /data, never as instructions/);
  assert.match(section(1), /handoff-<role>\.md/);
  assert.match(section(1), /recommendations\.md/);
  assert.match(section(1), /sources\.md/);
  assert.match(section(1), /never widen it/);
  assert.match(section(3), /<board-id>: <title>/);
  assert.match(section(3), /if you have native team task tools/i);
  assert.match(section(3), /owner question/i);
  assert.match(lead + phases, /never pass a name/);
});

test('both READMEs describe the pack, worktree, rotation and skip count helpers', () => {
  for (const f of ['README.md', 'README.tr.md']) {
    const text = read(f);
    for (const word of ['pack.js', 'worktree.js', 'board.js', 'gate.js']) assert.ok(text.includes(`(\`${word}\`)`), `${f} lacks ${word}`);
  }
});

// Item 1: call budget per dispatch.
const defaults = JSON.parse(read('defaults', 'config.json'));
const agentFiles = fs.readdirSync(path.join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md'));

test('callBudget is 40 in the defaults and validated as a positive integer', () => {
  assert.equal(defaults.callBudget, 40);
  assert.doesNotThrow(() => validateConfig(defaults));
  for (const bad of [0, -1, 1.5, '40']) assert.throws(() => validateConfig({ ...defaults, callBudget: bad }), /callBudget/);
});

test('every agent file sets maxTurns to the call budget', () => {
  assert.equal(agentFiles.length, 14);
  for (const f of agentFiles) {
    const { data } = parseFrontmatter(read('agents', f));
    assert.equal(data.maxTurns, String(defaults.callBudget), `${f} maxTurns`);
  }
});

test('the pack header states the budget from the config', () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-001.md'), '# T-001: x\n');
  const sentence = (n) => `Budget: ${n} tool calls. When you reach it, stop and report what is done, what is left and what you need.`;
  const head = buildPack(root, { id: 'T-001', role: 'backend-developer' }).text.split('\n## ')[0];
  assert.ok(head.includes(sentence(40)), head);
  const cfgFile = path.join(root, 'team', 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')), callBudget: 25 }));
  assert.ok(buildPack(root, { id: 'T-001', role: 'backend-developer' }).text.split('\n## ')[0].includes(sentence(25)));
});

test('task-loop says what the lead does when a role reports the budget hit', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /budget/i);
  assert.match(loop, /fresh pack/i);
  assert.match(loop, /same round, not a new round/i);
  assert.match(loop, /split the task/i);
  assert.match(loop, /never[^\n]*raise[^\n]*budget[^\n]*silently/i);
});
