import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { projectSlug, taskFromPrompt, buildCostReport } from '../scripts/lib/cost.js';
import { buildPhaseReport } from '../scripts/lib/summary.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(pluginRoot, 'scripts', 'cost.js');

// Synthetic transcripts: only the fields the reader uses, no real conversation text.
const assistant = (id, model, usage, ts, extra = {}) => JSON.stringify({
  type: 'assistant', timestamp: ts, message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { service_tier: 'standard', ...usage }, ...extra },
});
const user = (text, ts) => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });
const u = (input, create, read, output) => ({ input_tokens: input, cache_creation_input_tokens: create, cache_read_input_tokens: read, output_tokens: output });

// A projects dir holding the slug folder of `root`: one main session and three subagents.
function fixture() {
  const root = makeProject();
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'nac projects '));
  const dir = path.join(projects, projectSlug(root));
  const sub = path.join(dir, 'sess1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const write = (file, lines) => fs.writeFileSync(file, `${lines.join('\n')}\n`);
  write(path.join(dir, 'sess1.jsonl'), [
    user('start', '2026-10-01T10:00:00Z'),
    assistant('m1', 'claude-opus-4-8', u(10, 1000, 2000, 100), '2026-10-01T10:00:01Z'),
    // the same API message written once per content block: counted once
    assistant('m1', 'claude-opus-4-8', u(10, 1000, 2000, 100), '2026-10-01T10:00:02Z'),
    'this line is not json {{{',
    assistant('m2', 'claude-opus-4-8', u(5, 0, 3000, 50), '2026-10-01T10:00:03Z'),
  ]);
  write(path.join(sub, 'agent-aaa.jsonl'), [
    user('Read team/work/packs/T-001-backend-developer.md first.', '2026-10-01T11:00:00Z'),
    assistant('a1', 'claude-sonnet-5-5', u(2, 500, 1500, 40), '2026-10-01T11:00:01Z'),
    assistant('a2', 'claude-sonnet-5-5', u(2, 100, 2500, 60), '2026-10-01T11:00:02Z'),
    '',
    '{"type":"assistant","timestamp":"2026-10-01T11:00:03Z","message":{"id":"a3","model":"claude-sonnet-5-5"}}',
  ]);
  fs.writeFileSync(path.join(sub, 'agent-aaa.meta.json'), JSON.stringify({ agentType: 'nac:backend-developer', description: 'Build T-001' }));
  write(path.join(sub, 'agent-bbb.jsonl'), [
    user('Review: team/work/packs/T-001-code-reviewer-r2.md', '2026-10-01T12:00:00Z'),
    assistant('b1', 'claude-sonnet-5-5', u(1, 200, 800, 30), '2026-10-01T12:00:01Z'),
  ]);
  fs.writeFileSync(path.join(sub, 'agent-bbb.meta.json'), JSON.stringify({ agentType: 'code-reviewer' }));
  write(path.join(sub, 'agent-ccc.jsonl'), [
    user('Explore something, no pack here.', '2026-10-02T09:00:00Z'),
    assistant('c1', 'claude-haiku-4-5', u(3, 0, 100, 10), '2026-10-02T09:00:01Z'),
  ]);
  fs.writeFileSync(path.join(sub, 'agent-ccc.meta.json'), JSON.stringify({ agentType: 'general-purpose' }));
  return { root, projects };
}

test('projectSlug replaces colon, backslash, slash and space with a dash', () => {
  assert.equal(projectSlug('D:\\Projects\\Memory Agent'), 'D--Projects-Memory-Agent');
  assert.equal(projectSlug('/home/u/My Proj'), '-home-u-My-Proj');
});

test('taskFromPrompt reads the task id from the pack path, with or without a round suffix', () => {
  assert.equal(taskFromPrompt('Read team/work/packs/T-018d-backend-developer.md first'), 'T-018d');
  assert.equal(taskFromPrompt('see D:\\p\\team\\work\\packs\\T-002-code-reviewer-r3.md'), 'T-002');
  assert.equal(taskFromPrompt('team/work/packs/T-007-security-reviewer.md'), 'T-007');
  assert.equal(taskFromPrompt('nothing here'), 'unassigned');
  assert.equal(taskFromPrompt(''), 'unassigned');
});

test('by role sums usage per role and model, counts calls once per API message and skips invalid lines', () => {
  const { root, projects } = fixture();
  const r = buildCostReport(root, { by: 'role', projectsDir: projects });
  const row = (key, model) => r.rows.find((x) => x.key === key && x.model === model);
  assert.deepEqual(row('lead', 'claude-opus-4-8'), {
    key: 'lead', model: 'claude-opus-4-8', calls: 2, inputTokens: 15, cacheCreationTokens: 1000, cacheReadTokens: 5000, outputTokens: 150, totalTokens: 6165,
  });
  // a3 has no usage: not counted
  assert.equal(row('backend-developer', 'claude-sonnet-5-5').calls, 2);
  assert.equal(row('backend-developer', 'claude-sonnet-5-5').cacheReadTokens, 4000);
  assert.equal(row('code-reviewer', 'claude-sonnet-5-5').calls, 1);
  assert.equal(row('general-purpose', 'claude-haiku-4-5').outputTokens, 10);
  assert.equal(r.totals.calls, 6);
  assert.equal(r.totals.outputTokens, 150 + 100 + 30 + 10);
  assert.equal(r.totals.totalTokens, r.rows.reduce((a, x) => a + x.totalTokens, 0));
});

test('by task maps dispatches through the pack path and puts the rest under unassigned', () => {
  const { root, projects } = fixture();
  const r = buildCostReport(root, { by: 'task', projectsDir: projects });
  const keys = r.rows.map((x) => x.key).sort();
  assert.deepEqual(keys, ['T-001', 'unassigned', 'unassigned']);
  assert.equal(r.rows.find((x) => x.key === 'T-001').calls, 3);
  assert.equal(r.rows.find((x) => x.key === 'unassigned' && x.model === 'claude-opus-4-8').calls, 2);
});

test('--since keeps only messages at or after the instant', () => {
  const { root, projects } = fixture();
  const r = buildCostReport(root, { by: 'role', since: '2026-10-02T00:00:00Z', projectsDir: projects });
  assert.deepEqual(r.rows.map((x) => x.key), ['general-purpose']);
  assert.throws(() => buildCostReport(root, { since: 'yesterday-ish', projectsDir: projects }), /Invalid --since/);
  assert.throws(() => buildCostReport(root, { by: 'color', projectsDir: projects }), /--by/);
});

test('top dispatches are the most expensive subagent runs, with role, task and call count', () => {
  const { root, projects } = fixture();
  const r = buildCostReport(root, { by: 'role', projectsDir: projects });
  assert.equal(r.topDispatches[0].agentId, 'aaa');
  assert.equal(r.topDispatches[0].role, 'backend-developer');
  assert.equal(r.topDispatches[0].task, 'T-001');
  assert.equal(r.topDispatches[0].calls, 2);
  assert.equal(r.topDispatches[0].description, 'Build T-001');
  assert.ok(r.topDispatches.length <= 5);
  assert.ok(r.topDispatches[0].totalTokens >= r.topDispatches[1].totalTokens);
});

test('a project with no transcripts gives an empty report, and worktree folders are included', () => {
  const root = makeProject();
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'nac projects '));
  const empty = buildCostReport(root, { projectsDir: projects });
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.totals.calls, 0);
  const wt = path.join(projects, `${projectSlug(root)}-wt-T-009`);
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, 's.jsonl'), `${assistant('w1', 'claude-sonnet-5-5', u(1, 1, 1, 1), '2026-10-01T10:00:00Z')}\n`);
  assert.equal(buildCostReport(root, { projectsDir: projects }).totals.calls, 1);
});

test('the phase report data carries the cost tables and the top five dispatches', () => {
  const { root, projects } = fixture();
  const report = buildPhaseReport(root, { projectsDir: projects });
  assert.ok(report.cost.byRole.length >= 4);
  assert.ok(report.cost.byTask.some((x) => x.key === 'T-001'));
  assert.equal(report.cost.totals.calls, 6);
  assert.ok(report.cost.topDispatches.length <= 5);
  const none = buildPhaseReport(makeProject(), { projectsDir: projects });
  assert.equal(none.cost.totals.calls, 0);
});

test('cli prints the report as JSON', () => {
  const { root, projects } = fixture();
  const r = spawnSync(process.execPath, [cli, '--by', 'task', '--since', '2026-10-01T00:00:00Z', '--transcripts', projects, '--project', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.by, 'task');
  assert.equal(out.totals.calls, 6);
  const bad = spawnSync(process.execPath, [cli, '--by', 'color', '--transcripts', projects, '--project', root], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

test('skill phase-report puts the cost table in the report and cost.js is documented', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'phase-report', 'SKILL.md'), 'utf8');
  assert.match(skill, /cost/i);
  assert.match(skill, /top 5/i);
  assert.match(skill, /per role and per task/i);
  assert.match(skill, /`cost`/);
});

test('the phase report cost can be limited to the phase with since, also from the cli', () => {
  const { root, projects } = fixture();
  assert.equal(buildPhaseReport(root, { projectsDir: projects, since: '2026-10-02T00:00:00Z' }).cost.totals.calls, 1);
  const summaryCli = path.join(pluginRoot, 'scripts', 'summary.js');
  const r = spawnSync(process.execPath, [summaryCli, '--phase-report', '--since', '2026-10-02T00:00:00Z', '--project', root], { encoding: 'utf8', env: { ...process.env, USERPROFILE: path.dirname(projects), HOME: path.dirname(projects) } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).cost);
});
