import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { projectSlug, buildCostReport, buildMetricRows, saveMetrics } from '../scripts/lib/cost.js';
import { buildPhaseReport } from '../scripts/lib/summary.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(pluginRoot, 'scripts', 'cost.js');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');

// Synthetic transcripts only: no real conversation text.
const assistant = (id, usage, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5-5', role: 'assistant', content: [], usage } });
const user = (text, ts) => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: text } });
const u = (input, create, cacheRead, output) => ({ input_tokens: input, cache_creation_input_tokens: create, cache_read_input_tokens: cacheRead, output_tokens: output });

// Two lead sessions. s1 (Oct 1): lead 2 calls; agent aaa (backend-developer, forward slashes, pack, 3 calls);
// agent bbb (code-reviewer, backslashes, hand-off, 1 call). s2 (Oct 5): lead 1 call; agent ccc (backend-developer, no pack, 1 call).
function fixture({ callBudget = 2 } = {}) {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ callBudget }));
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'nac projects '));
  const dir = path.join(projects, projectSlug(root));
  const put = (file, lines) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
  };
  const agent = (session, id, type, prompt, calls, ts) => {
    const sub = path.join(dir, session, 'subagents');
    put(path.join(sub, `agent-${id}.jsonl`), [user(prompt, ts), ...calls.map((c, i) => assistant(`${id}${i}`, c, ts))]);
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: type }));
  };
  put(path.join(dir, 's1.jsonl'), [assistant('l1', u(10, 100, 1000, 10), '2026-10-01T10:00:00Z'), assistant('l2', u(10, 100, 1000, 10), '2026-10-01T10:00:01Z')]);
  agent('s1', 'aaa', 'nac:backend-developer', 'Read team/work/packs/T-001-backend-developer.md first.', [u(1, 10, 100, 5), u(1, 10, 100, 5), u(1, 10, 100, 5)], '2026-10-01T11:00:00Z');
  agent('s1', 'bbb', 'code-reviewer', 'Review D:\\p\\team\\work\\handoffs\\T-001.md now.', [u(2, 20, 200, 10)], '2026-10-01T12:00:00Z');
  put(path.join(dir, 's2.jsonl'), [assistant('l3', u(5, 50, 500, 5), '2026-10-05T10:00:00Z')]);
  agent('s2', 'ccc', 'nac:backend-developer', 'No pack named here.', [u(3, 30, 300, 15)], '2026-10-05T11:00:00Z');
  return { root, projects };
}

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nac home '));
const jsonl = (root) => fs.readFileSync(path.join(root, 'team', 'metrics', 'cost.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('--session keeps one lead session and its subagents', () => {
  const { root, projects } = fixture();
  assert.equal(buildCostReport(root, { projectsDir: projects, session: 's1' }).totals.calls, 6);
  assert.equal(buildCostReport(root, { projectsDir: projects, session: 's2' }).totals.calls, 2);
  assert.equal(buildCostReport(root, { projectsDir: projects, session: 'nope' }).totals.calls, 0);
});

test('--until is an inclusive upper bound next to --since; a bad value is an error', () => {
  const { root, projects } = fixture();
  assert.equal(buildCostReport(root, { projectsDir: projects, until: '2026-10-01T10:00:00Z' }).totals.calls, 1);
  assert.equal(buildCostReport(root, { projectsDir: projects, since: '2026-10-01T11:00:00Z', until: '2026-10-02T00:00:00Z' }).totals.calls, 4);
  assert.throws(() => buildCostReport(root, { projectsDir: projects, until: 'soon' }), /Invalid --until/);
});

test('metric rows: one per role, task, model and session with calls, tokens, dispatches, packed and over-budget', () => {
  const { root, projects } = fixture({ callBudget: 2 });
  const rows = buildMetricRows(root, { projectsDir: projects, now: new Date(2026, 9, 19, 14, 5) });
  const find = (role, session) => rows.find((r) => r.role === role && r.session === session);
  assert.equal(rows.length, 5);
  assert.deepEqual(
    { ...find('backend-developer', 's1') },
    { date: '2026-10-19', project: path.basename(root), session: 's1', scope: 'all', role: 'backend-developer', task: 'T-001', model: 'claude-sonnet-5-5', calls: 3, input: 3, cacheWrite: 30, cacheRead: 300, output: 15, weighted: 3 + 37.5 + 30 + 75, dispatches: 1, packed: 1, overBudget: 1 },
  );
  const rev = find('code-reviewer', 's1');
  assert.equal(rev.packed, 1, 'a hand-off path with backslashes counts as packed');
  assert.equal(rev.overBudget, 0);
  assert.equal(rev.task, 'T-001', 'a hand-off named after a task gives the task');
  const be2 = find('backend-developer', 's2');
  assert.equal(be2.packed, 0);
  assert.equal(be2.dispatches, 1);
  assert.equal(find('lead', 's1').dispatches, 0);
  assert.equal(find('lead', 's1').calls, 2);
});

test('scope names the filters of the run', () => {
  const { root, projects } = fixture();
  const rows = buildMetricRows(root, { projectsDir: projects, session: 's2', since: '2026-10-05T00:00:00Z' });
  assert.ok(rows.length > 0);
  for (const r of rows) assert.equal(r.scope, 'session s2 since 2026-10-05T00:00:00Z');
});

test('save writes team/metrics/cost-<date>-<HHMM>.md, appends cost.jsonl and keeps appending', () => {
  const { root, projects } = fixture();
  const h = home();
  const r = saveMetrics(root, { projectsDir: projects, home: h, now: new Date(2026, 9, 19, 14, 5) });
  assert.equal(path.basename(r.md), 'cost-2026-10-19-1405.md');
  const md = fs.readFileSync(r.md, 'utf8');
  assert.match(md, /^# Cost 2026-10-19 14:05/m);
  assert.match(md, /\| backend-developer \| T-001 \| claude-sonnet-5-5 \|/);
  assert.equal(jsonl(root).length, 5);
  saveMetrics(root, { projectsDir: projects, home: h, now: new Date(2026, 9, 19, 14, 6) });
  assert.equal(jsonl(root).length, 10);
  assert.ok(fs.existsSync(path.join(root, 'team', 'metrics', 'cost-2026-10-19-1406.md')));
});

test('baseline writes baseline-<name>.md and rows with scope baseline', () => {
  const { root, projects } = fixture();
  const r = saveMetrics(root, { projectsDir: projects, home: home(), baseline: 'before-batch5', session: 's1', now: new Date(2026, 9, 19, 14, 5) });
  assert.equal(path.basename(r.md), 'baseline-before-batch5.md');
  assert.ok(!fs.readdirSync(path.join(root, 'team', 'metrics')).some((f) => f.startsWith('cost-') && f.endsWith('.md')));
  const rows = jsonl(root);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal(row.scope, 'baseline');
  assert.throws(() => saveMetrics(root, { projectsDir: projects, home: home(), baseline: '../x' }), /Invalid baseline name/);
});

test('shared summary: one line per run in ~/.claude/nac/metrics.md', () => {
  const { root, projects } = fixture({ callBudget: 2 });
  const h = home();
  const now = new Date(2026, 9, 19, 14, 5);
  saveMetrics(root, { projectsDir: projects, home: h, now });
  saveMetrics(root, { projectsDir: projects, home: h, now, session: 's2' });
  const lines = fs.readFileSync(path.join(h, '.claude', 'nac', 'metrics.md'), 'utf8').trim().split('\n');
  assert.match(lines[0], /^# /);
  const data = lines.filter((l) => l.startsWith('| 2026'));
  assert.equal(data.length, 2);
  // date | project | scope | calls | tokens | weighted | dispatches | packed share | over budget
  const cells = data[0].split('|').slice(1, -1).map((c) => c.trim());
  assert.equal(cells.length, 9);
  assert.equal(cells[0], '2026-10-19');
  assert.equal(cells[1], path.basename(root));
  assert.equal(cells[2], 'all');
  assert.equal(cells[3], '8');
  assert.equal(cells[6], '3');
  assert.equal(cells[7], '67%');
  assert.equal(cells[8], '1');
});

test('cli --save and --baseline write the files and print them; the real home is not touched', () => {
  const { root, projects } = fixture();
  const h = home();
  const env = { ...process.env, HOME: h, USERPROFILE: h };
  const run = (...a) => spawnSync(process.execPath, [cli, '--transcripts', projects, '--project', root, ...a], { encoding: 'utf8', env });
  const s = run('--save', '--session', 's1', '--until', '2026-12-31T00:00:00Z');
  assert.equal(s.status, 0, s.stderr);
  const out = JSON.parse(s.stdout);
  assert.equal(out.totals.calls, 6);
  assert.match(out.saved.md, /team[\\/]metrics[\\/]cost-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  const b = run('--baseline', 'old');
  assert.equal(b.status, 0, b.stderr);
  assert.ok(fs.existsSync(path.join(root, 'team', 'metrics', 'baseline-old.md')));
  assert.ok(fs.existsSync(path.join(h, '.claude', 'nac', 'metrics.md')));
  assert.equal(run('--until', 'soon').status, 1);
  assert.equal(run('--baseline', 'a b').status, 1);
});

test('a plain run without --save writes nothing', () => {
  const { root, projects } = fixture();
  const h = home();
  const r = spawnSync(process.execPath, [cli, '--transcripts', projects, '--project', root], { encoding: 'utf8', env: { ...process.env, HOME: h, USERPROFILE: h } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(root, 'team', 'metrics')));
  assert.ok(!fs.existsSync(path.join(h, '.claude')));
});

test('phase report compares per-role averages per dispatch with the latest baseline', () => {
  const { root, projects } = fixture();
  saveMetrics(root, { projectsDir: projects, home: home(), baseline: 'old', until: '2026-10-02T00:00:00Z' });
  const cost = buildPhaseReport(root, { projectsDir: projects, since: '2026-10-05T00:00:00Z' }).cost;
  assert.equal(cost.vsBaseline.name, 'old');
  const be = cost.vsBaseline.roles.find((r) => r.role === 'backend-developer');
  // baseline: 1 dispatch, 3 calls, 3+30+300+15 = 348 tokens; now: 1 dispatch, 1 call, 3+30+300+15 = 348 tokens
  assert.deepEqual(be.baseline, { dispatches: 1, avgCalls: 3, avgTokens: 348 });
  assert.deepEqual(be.current, { dispatches: 1, avgCalls: 1, avgTokens: 348 });
  assert.equal(be.callsRatio, 0.33);
  assert.equal(be.tokensRatio, 1);
  assert.ok(!cost.vsBaseline.roles.some((r) => r.role === 'lead'));
  const none = buildPhaseReport(makeProject(), { projectsDir: projects }).cost;
  assert.equal(none.vsBaseline, null);
});

test('team/metrics/ is committed: setup does not ignore it', () => {
  assert.doesNotMatch(read('scripts', 'lib', 'setup.js'), /metrics/);
});

test('task-loop saves the cost after each done task; phase-report compares with the baseline', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /cost.js" --save --task <id>/);
  assert.match(loop, /chore\(team\)/);
  const report = read('skills', 'phase-report', 'SKILL.md');
  assert.match(report, /baseline/i);
  assert.match(report, /vsBaseline/);
  assert.match(report, /ratio/i);
});

test('READMEs describe saved metrics in both languages', () => {
  for (const f of ['README.md', 'README.tr.md']) {
    const t = read(f);
    for (const w of ['cost.js --save', '--baseline', 'team/metrics/', 'metrics.md', '--session']) assert.ok(t.includes(w), `${f} lacks ${w}`);
  }
});

// One session, lead messages around two dispatches: before the first (unassigned), then after T-001, after T-002.
function leadFixture() {
  const root = makeProject();
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'nac projects '));
  const dir = path.join(projects, projectSlug(root));
  const sub = path.join(dir, 's1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), `${[
    assistant('l0', u(1, 0, 0, 0), '2026-10-01T10:00:00Z'),
    assistant('l1', u(10, 0, 0, 0), '2026-10-01T11:30:00Z'),
    assistant('l2', u(100, 0, 0, 0), '2026-10-01T12:30:00Z'),
    assistant('l3', u(1000, 0, 0, 0), '2026-10-01T13:30:00Z'),
  ].join('\n')}\n`);
  const agent = (id, prompt, ts) => {
    fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), `${[user(prompt, ts), assistant(`${id}0`, u(1, 0, 0, 0), ts)].join('\n')}\n`);
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'nac:backend-developer' }));
  };
  agent('aaa', 'Work on team/work/tasks/T-001.md', '2026-10-01T11:00:00Z');
  agent('bbb', 'Work on team/work/tasks/T-002.md', '2026-10-01T12:00:00Z');
  return { root, projects };
}

test('lead messages go to the task of the latest dispatch at or before them; earlier ones stay unassigned', () => {
  const { root, projects } = leadFixture();
  const lead = buildMetricRows(root, { projectsDir: projects }).filter((r) => r.role === 'lead');
  const byTask = Object.fromEntries(lead.map((r) => [r.task, r.input]));
  assert.deepEqual(byTask, { unassigned: 1, 'T-001': 10, 'T-002': 1100 });
  const report = buildCostReport(root, { by: 'task', projectsDir: projects });
  assert.equal(report.rows.find((r) => r.key === 'T-002').inputTokens, 1101);
});

test('a dispatch before --since still sets the task of later lead messages', () => {
  const { root, projects } = leadFixture();
  const lead = buildMetricRows(root, { projectsDir: projects, since: '2026-10-01T12:15:00Z' }).filter((r) => r.role === 'lead');
  assert.deepEqual(lead.map((r) => [r.task, r.input]), [['T-002', 1100]]);
});

test('packed ignores a hand-off that belongs to another task', () => {
  const { root, projects } = fixture();
  const sub = path.join(projects, projectSlug(root), 's1', 'subagents');
  fs.writeFileSync(path.join(sub, 'agent-ddd.jsonl'), `${[user('Work on team/work/tasks/T-005.md, context in team/work/handoffs/T-004.md', '2026-10-01T13:00:00Z'), assistant('d0', u(1, 0, 0, 1), '2026-10-01T13:00:01Z')].join('\n')}\n`);
  fs.writeFileSync(path.join(sub, 'agent-ddd.meta.json'), JSON.stringify({ agentType: 'nac:backend-developer' }));
  const row = buildMetricRows(root, { projectsDir: projects }).find((r) => r.task === 'T-005');
  assert.equal(row.dispatches, 1);
  assert.equal(row.packed, 0);
});

test('--task keeps only that task rows (lead included); the printed report is filtered the same way', () => {
  const { root, projects } = leadFixture();
  const rows = buildMetricRows(root, { projectsDir: projects, task: 'T-002' });
  assert.deepEqual(rows.map((r) => [r.role, r.task]).sort(), [['backend-developer', 'T-002'], ['lead', 'T-002']]);
  for (const r of rows) assert.equal(r.scope, 'task T-002');
  const report = buildCostReport(root, { by: 'task', projectsDir: projects, task: 'T-002' });
  assert.deepEqual(report.rows.map((r) => r.key), ['T-002']);
});

test('save --task writes cost-<id>-<date>-<HHMM>.md, rows with scope task <id> and a shared line with that scope', () => {
  const { root, projects } = leadFixture();
  const h = home();
  const r = saveMetrics(root, { projectsDir: projects, home: h, task: 'T-001', now: new Date(2026, 9, 19, 14, 5) });
  assert.equal(path.basename(r.md), 'cost-T-001-2026-10-19-1405.md');
  assert.match(fs.readFileSync(r.md, 'utf8'), /^Scope: task T-001\./m);
  const saved = jsonl(root);
  assert.ok(saved.length > 0);
  for (const row of saved) {
    assert.equal(row.scope, 'task T-001');
    assert.equal(row.task, 'T-001');
  }
  const line = fs.readFileSync(path.join(h, '.claude', 'nac', 'metrics.md'), 'utf8').trim().split('\n').pop();
  assert.equal(line.split('|').slice(1, -1)[2].trim(), 'task T-001');
});

test('cli --save --task writes only that task', () => {
  const { root, projects } = leadFixture();
  const h = home();
  const out = spawnSync(process.execPath, [cli, '--transcripts', projects, '--project', root, '--save', '--task', 'T-002'], { encoding: 'utf8', env: { ...process.env, HOME: h, USERPROFILE: h } });
  assert.equal(out.status, 0, out.stderr);
  const saved = JSON.parse(out.stdout).saved;
  assert.match(path.basename(saved.md), /^cost-T-002-/);
  for (const row of jsonl(root)) assert.equal(row.task, 'T-002');
});
