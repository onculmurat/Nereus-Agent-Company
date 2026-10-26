import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';
import { validateConfig, loadConfig } from '../scripts/lib/config.js';
import { buildPack } from '../scripts/lib/pack.js';
import { makeProject, taskLoopText } from './helpers.js';

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

test('turnBudget is 50 in the defaults and validated as a positive integer', () => {
  assert.equal(defaults.turnBudget, 50);
  assert.equal(defaults.callBudget, undefined);
  assert.doesNotThrow(() => validateConfig(defaults));
  for (const bad of [0, -1, 1.5, '40']) assert.throws(() => validateConfig({ ...defaults, turnBudget: bad }), /turnBudget/);
});

test('callBudget in a project config is an alias used only when turnBudget is absent', () => {
  const load = (cfg) => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify(cfg));
    return loadConfig({ pluginRoot, userConfigPath: path.join(root, 'none.json'), projectRoot: root });
  };
  assert.equal(load({ callBudget: 25 }).turnBudget, 25);
  assert.equal(load({ callBudget: 25, turnBudget: 30 }).turnBudget, 30);
  assert.equal(load({}).turnBudget, 50);
  assert.throws(() => validateConfig({ ...defaults, callBudget: 0 }), /callBudget/);
});

test('every agent file sets maxTurns to the turn budget plus 5 turns to write the report', () => {
  assert.equal(agentFiles.length, 14);
  for (const f of agentFiles) {
    const { data } = parseFrontmatter(read('agents', f));
    assert.equal(data.maxTurns, String(defaults.turnBudget + 5), `${f} maxTurns`);
  }
});

test('task-loop explains the 5-turn margin between the budget and maxTurns', () => {
  assert.match(taskLoopText(), /`maxTurns` is the budget plus 5/);
});

test('the pack header states the budget from the config', () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-001.md'), '# T-001: x\n');
  const sentence = (n) => `Budget: ${n} model turns (parallel tool calls share a turn). When you reach it, stop and report what is done, what is left and what you need.`;
  const head = buildPack(root, { id: 'T-001', role: 'backend-developer' }).text.split('\n## ')[0];
  assert.ok(head.includes(sentence(50)), head);
  const cfgFile = path.join(root, 'team', 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')), turnBudget: 25 }));
  assert.ok(buildPack(root, { id: 'T-001', role: 'backend-developer' }).text.split('\n## ')[0].includes(sentence(25)));
});

test('task-loop says what the lead does when a role reports the budget hit', () => {
  const loop = taskLoopText();
  assert.match(loop, /^## Turn budget$/m);
  assert.match(loop, /fresh pack/i);
  assert.match(loop, /same round, not a new round/i);
  assert.match(loop, /split the task/i);
  assert.match(loop, /never[^\n]*raise[^\n]*budget[^\n]*silently/i);
});

// Item 2: fix rounds and re-reviews get only the delta.
test('task-loop step 6 uses the delta pack for every role in a fix round or re-review', () => {
  const step = taskLoopText().split(/^6\. /m)[1].split(/^7\. /m)[0];
  assert.match(step, /--round <n>/);
  assert.match(step, /--findings/);
  assert.match(step, /--base/);
  assert.match(step, /delta pack/i);
  assert.match(step, /re-review/i);
  for (const who of ['developers', 'reviewers', 'security-reviewer', 'architect']) assert.match(step, new RegExp(who));
  assert.match(step, /never the full pack/i);
});

// Item 4: spec fold-in round cap.
test('foldInRounds is 2 in the defaults and validated', () => {
  assert.equal(defaults.foldInRounds, 2);
  assert.throws(() => validateConfig({ ...defaults, foldInRounds: 0 }), /foldInRounds/);
});

test('phase 3 and the architect state the fold-in cap, the batched pass and the single owner list', () => {
  const design = read('skills', 'phases', 'SKILL.md').split(/^## Phase 3\b/m)[1].split('\n## ')[0];
  const architect = read('agents', 'architect.md');
  for (const text of [design, architect]) {
    assert.match(text, /at most 2 fold-in rounds per review cycle/i);
    assert.match(text, /one batched (architect )?pass/i);
    assert.match(text, /one list/i);
  }
  assert.match(design, /board\.js" foldin/);
  assert.match(design, /--reset/);
});

// Item 5: batch owner questions.
test('question-protocol batches ready non-blocking questions into one AskUserQuestion call of up to 4', () => {
  const text = read('skills', 'question-protocol', 'SKILL.md');
  const batching = text.split(/^## Batching\b/m)[1]?.split('\n## ')[0] ?? '';
  assert.match(batching, /AskUserQuestion/);
  assert.match(batching, /non-blocking or low-impact/i);
  assert.match(batching, /up to 4 questions/i);
  assert.match(batching, /Source[^\n]*Status[^\n]*Impact/);
  assert.match(batching, /options/i);
  assert.match(batching, /one recommendation/i);
  assert.match(batching, /blocking[^\n]*(at once|immediately)/i);
  assert.match(batching, /answers every question/i);
  assert.match(batching, /nothing is decided for them/i);
  assert.match(batching, /phase 0/i);
  // the one-question-per-message rules stay
  assert.match(text, /exactly one question[^\n]*no sub-questions[^\n]*no preview/i);
  assert.match(text, /Batching/);
});

// Item 6: task batching at planning.
test('planner merges small same-kind tasks and reports task and dispatch counts', () => {
  const planner = read('agents', 'planner.md');
  assert.match(planner, /small tasks of the same kind/i);
  assert.match(planner, /same files area[^\n]*same change type[^\n]*under (about |~)?1 hour/i);
  assert.match(planner, /one task with one brief/i);
  assert.match(planner, /task count/i);
  assert.match(planner, /estimated dispatch count/i);
  assert.match(planner, /implementer[^\n]*reviewer[^\n]*expected (fix )?rounds/i);
});

test('phase 4 and the phase report ask for the task count and the estimated dispatch count', () => {
  const phase4 = read('prompts', 'lead.md').split('## Phase 4')[1].split('\n## ')[0];
  assert.match(phase4, /small same-kind tasks merged/);
  assert.match(phase4, /estimated dispatch count/);
  const report = read('skills', 'phase-report', 'SKILL.md');
  assert.match(report, /Phase 4/);
  assert.match(report, /task count/i);
  assert.match(report, /estimated dispatch count/i);
});

test('planner splits a task that needs more than one dispatch budget', () => {
  assert.match(read('agents', 'planner.md'), /more than one dispatch budget[^\n]*split[^\n]*sub-tasks/i);
});
