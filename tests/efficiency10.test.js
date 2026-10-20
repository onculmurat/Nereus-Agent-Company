// Batch 10 (1.3.0) part A: g18 gateCommands, g22 pack enforcement, g23 irreversible go path, g16 parked questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { runGate, gateChecks, detectGateCommands } from '../scripts/lib/gate.js';
import { validateConfig, loadConfig } from '../scripts/lib/config.js';
import { planSetup, applySetup } from '../scripts/lib/setup.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = JSON.stringify(process.execPath);
const exit = (n) => `${node} -e "process.exit(${n})"`;
const gateCli = path.join(pluginRoot, 'scripts', 'gate.js');

function projectWith(cfg) {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify(cfg));
  return root;
}

// ---- A1 (g18) gateCommands ----
test('g18: gateChecks prefers gateCommands and falls back to testCommand as a single entry', () => {
  assert.deepEqual(gateChecks({ gateCommands: [{ name: 'a', command: 'x' }, { name: 'b', command: 'y' }], testCommand: 'z' }).map((c) => c.name), ['a', 'b']);
  assert.deepEqual(gateChecks({ testCommand: 'cargo test' }), [{ name: 'test', command: 'cargo test' }]);
  assert.deepEqual(gateChecks({}), []);
});

test('g18: runGate runs every check in order, reports each and fails on any red one', () => {
  const root = makeProject();
  const r = runGate(root, [{ name: 'test', command: exit(0) }, { name: 'clippy', command: exit(2) }, { name: 'fmt', command: exit(0) }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.checks.map((c) => [c.name, c.ok]), [['test', true], ['clippy', false], ['fmt', true]], 'a red check does not stop the later ones');
  assert.equal(r.exitCode, 2);
  assert.equal(runGate(root, [{ name: 'test', command: exit(0) }, { name: 'lint', command: exit(0) }]).ok, true);
});

test('g18: cli runs all gateCommands and exits 1 when one is red', () => {
  const green = spawnSync(process.execPath, [gateCli, '--project', projectWith({ gateCommands: [{ name: 'a', command: exit(0) }, { name: 'b', command: exit(0) }] })], { encoding: 'utf8' });
  assert.equal(green.status, 0, green.stderr);
  assert.equal(JSON.parse(green.stdout).checks.length, 2);
  const red = spawnSync(process.execPath, [gateCli, '--project', projectWith({ testCommand: exit(0), gateCommands: [{ name: 'a', command: exit(0) }, { name: 'lint', command: exit(1) }] })], { encoding: 'utf8' });
  assert.equal(red.status, 1);
  const out = JSON.parse(red.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.checks.find((c) => c.name === 'lint').ok, false);
});

test('g18: a malformed gateCommands fails closed (config error, exit 1)', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: null });
  assert.doesNotThrow(() => validateConfig({ ...base, gateCommands: [{ name: 'test', command: 'npm test' }] }));
  for (const bad of [[], 'npm test', [{ name: 'a' }], [{ name: '', command: 'x' }], [{ name: 'a', command: ' ' }], [{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }]]) {
    assert.throws(() => validateConfig({ ...base, gateCommands: bad }), /gateCommands/, JSON.stringify(bad));
  }
  const r = spawnSync(process.execPath, [gateCli, '--project', projectWith({ gateCommands: [] })], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gateCommands/);
});

test('g18: detectGateCommands per stack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac stack '));
  assert.deepEqual(detectGateCommands(dir), []);
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\n');
  assert.deepEqual(detectGateCommands(dir).map((c) => c.name), ['test', 'clippy', 'fmt']);
  assert.match(detectGateCommands(dir).find((c) => c.name === 'clippy').command, /-D warnings/);
  assert.match(detectGateCommands(dir).find((c) => c.name === 'fmt').command, /fmt --check/);
  fs.writeFileSync(path.join(dir, 'deny.toml'), '');
  assert.deepEqual(detectGateCommands(dir).map((c) => c.name), ['test', 'clippy', 'fmt', 'deny']);
  const node1 = fs.mkdtempSync(path.join(os.tmpdir(), 'nac stack '));
  fs.writeFileSync(path.join(node1, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
  assert.deepEqual(detectGateCommands(node1).map((c) => c.name), ['test']);
  fs.writeFileSync(path.join(node1, 'package.json'), JSON.stringify({ scripts: { test: 'x', lint: 'y' } }));
  assert.deepEqual(detectGateCommands(node1).map((c) => c.name), ['test', 'lint']);
  fs.writeFileSync(path.join(node1, 'package.json'), '{ broken');
  assert.deepEqual(detectGateCommands(node1), [], 'detection fails open');
});

test('g18: setup records the detected gateCommands in team/config.json, never over an existing choice', () => {
  const config = loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac setup '));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\n');
  const plan = planSetup(dir, { pluginRoot, config });
  assert.deepEqual(plan.gateCommands.map((c) => c.name), ['test', 'clippy', 'fmt']);
  applySetup(plan);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'team', 'config.json'), 'utf8'));
  assert.deepEqual(written.gateCommands.map((c) => c.name), ['test', 'clippy', 'fmt']);
  // second run: config has gateCommands already, nothing planned
  assert.equal(planSetup(dir, { pluginRoot, config }).gateCommands, null);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nac setup '));
  fs.writeFileSync(path.join(dir2, 'Cargo.toml'), '[package]\n');
  fs.mkdirSync(path.join(dir2, 'team'));
  fs.writeFileSync(path.join(dir2, 'team', 'config.json'), JSON.stringify({ testCommand: 'cargo test' }));
  assert.equal(planSetup(dir2, { pluginRoot, config }).gateCommands, null, 'an owner-approved testCommand stays as it is');
});

test('g18: the task-loop skill states the red-check-is-a-finding rule', () => {
  const loop = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(loop, /gateCommands/);
  assert.match(loop, /red check you see is recorded as a finding/);
});

// ---- A2 (g22) pack enforcement at dispatch ----
import { runHook as runHookScript } from './hooks/run-hook.js';
import { projectSlug, saveMetrics } from '../scripts/lib/cost.js';
import { readDecisions } from '../scripts/lib/decisions.js';

const dispatch = (root, subagent_type, prompt, tool_name = 'Agent') => runHookScript('pack-guard', {
  session_id: 's', cwd: root, hook_event_name: 'PreToolUse', tool_name, tool_input: { subagent_type, description: 'd', prompt },
});

test('g22: a code-role dispatch without a context pack is refused, and the message names the pack command', () => {
  const root = makeProject();
  for (const role of ['backend-developer', 'nac:frontend-developer', 'code-reviewer', 'security-reviewer']) {
    const r = dispatch(root, role, 'Implement T-001, read the hand-off team/work/handoffs/T-000.md');
    assert.equal(r.status, 2, role);
    assert.match(r.stderr, /pack\.js/);
    assert.match(r.stderr, /--no-pack/);
  }
  assert.equal(dispatch(root, 'backend-developer', 'x', 'Task').status, 2, 'the older Task tool name is covered too');
});

test('g22: a dispatch that names a pack, a non-code role or a non-dispatch tool passes', () => {
  const root = makeProject();
  assert.equal(dispatch(root, 'backend-developer', 'Read team/work/packs/T-001-backend-developer.md first.').status, 0);
  assert.equal(dispatch(root, 'code-reviewer', 'Delta: team\\work\\packs\\T-001-code-reviewer-r2.md').status, 0);
  assert.equal(dispatch(root, 'researcher', 'no pack needed').status, 0);
  assert.equal(dispatch(root, 'planner', 'no pack needed').status, 0);
  assert.equal(dispatch(root, 'general-purpose', 'explore').status, 0);
  assert.equal(dispatch(root, 'backend-developer', 'x', 'Read').status, 0);
});

test('g22: --no-pack <reason> lets the dispatch through and records the reason in the decisions log', () => {
  const root = makeProject();
  const r = dispatch(root, 'backend-developer', 'T-070 quick fix. --no-pack the change is one line in a config file');
  assert.equal(r.status, 0, r.stderr);
  const logged = readDecisions(root).decided;
  assert.equal(logged.length, 1);
  assert.match(logged[0].answer, /backend-developer/);
  assert.match(logged[0].answer, /one line in a config file/);
  assert.equal(dispatch(root, 'backend-developer', 'T-070 --no-pack').status, 2, 'a bare --no-pack without a reason is not an escape hatch');
});

test('g22: outside a NAC project and on a malformed payload the hook stays out of the way', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nac outside '));
  assert.equal(dispatch(outside, 'backend-developer', 'x').status, 0);
  assert.equal(runHookScript('pack-guard', 'not json').status, 0);
  assert.equal(runHookScript('pack-guard', { cwd: makeProject(), tool_name: 'Agent', tool_input: null }).status, 0);
});

test('g22: hooks.json registers pack-guard on the dispatch tools', () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  const entry = hooksJson.hooks.PreToolUse.find((e) => /pack-guard\.js"$/.test(e.hooks[0].command));
  assert.ok(entry);
  assert.match(entry.matcher, /Agent/);
  assert.match(entry.matcher, /Task/);
});

test('g22: cost.js --save --task warns when part of the task dispatches had no pack', () => {
  const root = makeProject();
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'nac projects '));
  const sub = path.join(projects, projectSlug(root), 's1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const line = (type, body) => JSON.stringify({ type, timestamp: '2026-10-01T10:00:00Z', message: body });
  const mk = (name, prompt) => {
    fs.writeFileSync(path.join(sub, `agent-${name}.jsonl`), `${[
      line('user', { role: 'user', content: prompt }),
      line('assistant', { id: `m-${name}`, model: 'claude-sonnet-5-5', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
    ].join('\n')}\n`);
    fs.writeFileSync(path.join(sub, `agent-${name}.meta.json`), JSON.stringify({ agentType: 'backend-developer' }));
  };
  mk('a', 'Read team/work/packs/T-009-backend-developer.md first.');
  mk('b', 'Do T-009 from the hand-off.');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nac home '));
  const r = saveMetrics(root, { task: 'T-009', projectsDir: projects, home });
  assert.equal(r.totals.packedShare, 50);
  assert.match(r.warnings[0], /packed 50%/);
  assert.match(r.warnings[0], /T-009/);
});

// ---- A3 (g23) irreversible / spending go path ----
import { execFileSync } from 'node:child_process';

const decisionsCli = path.join(pluginRoot, 'scripts', 'decisions.js');
const ask = (root, ...extra) => spawnSync(process.execPath, [decisionsCli, 'ask', '--title', 'Run the paid bench?', '--source', 's', '--status', 'st', '--impact', 'i', '--blocking', 'yes', '--thread', 'bench', '--options', 'go|no', '--recommend', 'go', '--project', root, ...extra], { encoding: 'utf8' });

function irreversibleProject({ brief, gate = exit(0), testFile = true } = {}) {
  const root = projectWith({ gateCommands: [{ name: 'test', command: gate }] });
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  if (brief !== undefined) fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-037.md'), brief);
  if (testFile) { fs.mkdirSync(path.join(root, 'tests')); fs.writeFileSync(path.join(root, 'tests', 'go_path.rs'), '// stub runner'); }
  return root;
}

test('g23: an --irreversible go question needs --task', () => {
  const r = ask(irreversibleProject(), '--irreversible');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--irreversible needs --task/);
});

test('g23: refused when the brief names no go-path test', () => {
  const r = ask(irreversibleProject({ brief: '# T-037\nRun bench with --yes.\n' }), '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Go-path test/);
});

test('g23: refused when the named test file does not exist', () => {
  const r = ask(irreversibleProject({ brief: '# T-037\nGo-path test: tests/missing.rs\n' }), '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tests\/missing\.rs/);
});

test('g23: refused when the gate is red', () => {
  const r = ask(irreversibleProject({ brief: '# T-037\nGo-path test: tests/go_path.rs\n', gate: exit(1) }), '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gate is not green/);
});

test('g23: refused (closed) when no gate command is configured', () => {
  const root = irreversibleProject({ brief: '# T-037\nGo-path test: tests/go_path.rs\n' });
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  assert.equal(ask(root, '--irreversible', '--task', 'T-037').status, 1);
});

test('g23: allowed when the brief names an existing test and the gate is green; the question carries the tag', () => {
  const root = irreversibleProject({ brief: '# T-037\n- Go-path test: `tests/go_path.rs` (stub runner, --yes reaches the executor)\n' });
  const r = ask(root, '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).irreversible, 'yes');
  assert.equal(readDecisions(root).open[0].irreversible, 'yes');
});

test('g23: a question without --irreversible is untouched', () => {
  assert.equal(ask(irreversibleProject()).status, 0);
});

test('g23: planner and question-protocol text carry the rule', () => {
  const planner = fs.readFileSync(path.join(pluginRoot, 'agents', 'planner.md'), 'utf8');
  assert.match(planner, /Go-path test/);
  assert.match(planner, /stub runner/);
  const qp = fs.readFileSync(path.join(pluginRoot, 'skills', 'question-protocol', 'SKILL.md'), 'utf8');
  assert.match(qp, /--irreversible/);
});

// ---- A4 (g16) parked owner questions ----
import { makeGitProject } from './helpers.js';
import { runHook as runHookNamed } from './hooks/run-hook.js';
import { addEntry, updateEntry } from '../scripts/lib/board.js';
import { addQuestion, parkQuestion, unparkQuestion } from '../scripts/lib/decisions.js';
import { compactBlocker } from '../scripts/lib/compact.js';
import { buildResumeSummary } from '../scripts/lib/summary.js';

function cleanGitProject() {
  const p = makeGitProject();
  p.commit('seed.txt');
  const e = addEntry(p.root, { title: 'done task', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, e.id, { status: 'done', commits: [p.commit('work.txt')] });
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'board');
  return p;
}
const q = { title: 'License?', source: 's', status: 'st', impact: 'i', blocking: 'no' };
const commitAll = (p) => { p.git('add', '-A'); p.git('commit', '-q', '-m', 'x'); };

test('g16: a parked question does not block compaction; an open one still does', () => {
  const p = cleanGitProject();
  const a = addQuestion(p.root, q);
  commitAll(p);
  assert.match(compactBlocker(p.root), /Q-001/);
  parkQuestion(p.root, a.id, { until: 'first sale' });
  commitAll(p);
  assert.equal(compactBlocker(p.root), null);
  const b = addQuestion(p.root, { ...q, title: 'Other?' });
  commitAll(p);
  assert.match(compactBlocker(p.root), new RegExp(b.id));
  assert.doesNotMatch(compactBlocker(p.root), /Q-001/, 'only the unparked question is named');
});

test('g16: the pre-compact hook allows an auto compaction with only a parked question open', () => {
  const p = cleanGitProject();
  const a = addQuestion(p.root, q);
  parkQuestion(p.root, a.id, { until: 'first sale' });
  commitAll(p);
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac tr ')), 't.jsonl');
  fs.writeFileSync(tr, `${JSON.stringify({ type: 'assistant', message: { content: [], usage: { input_tokens: 10, cache_read_input_tokens: 150000, cache_creation_input_tokens: 20 } } })}\n`);
  const r = runHookNamed('pre-compact', { hook_event_name: 'PreCompact', session_id: `g16-${process.pid}-${Date.now()}`, cwd: p.root, trigger: 'auto', transcript_path: tr });
  assert.equal(r.status, 0, r.stderr);
});

test('g16: parked state keeps its reason, survives a round trip, and unpark reopens the question', () => {
  const root = makeProject();
  const a = addQuestion(root, q);
  const parked = parkQuestion(root, a.id, { until: 'first sale; owner decides then' });
  assert.equal(parked.state, 'parked');
  assert.equal(parked['parked-until'], 'first sale; owner decides then');
  assert.equal(readDecisions(root).open[0].state, 'parked');
  unparkQuestion(root, a.id);
  assert.equal(readDecisions(root).open[0].state, undefined);
  assert.equal(readDecisions(root).open[0]['parked-until'], undefined);
  assert.throws(() => parkQuestion(root, 'Q-099', { until: 'x' }), /No open question/);
  assert.throws(() => parkQuestion(root, a.id, { until: '  ' }), /until/);
});

test('g16: a deferred question cannot be parked (flush it first)', () => {
  const root = makeProject();
  const a = addQuestion(root, { ...q, defer: true });
  assert.throws(() => parkQuestion(root, a.id, { until: 'x' }), /deferred/);
});

test('g16: the hand-off and resume summary list parked questions separately from queued ones', () => {
  const root = makeProject();
  const a = addQuestion(root, q);
  addQuestion(root, { ...q, title: 'Live one?' });
  parkQuestion(root, a.id, { until: 'first sale' });
  const text = buildResumeSummary(root, { gitStatus: '' });
  const queued = text.slice(text.indexOf('Queued owner questions:'), text.indexOf('Parked owner questions'));
  assert.match(queued, /Q-002/);
  assert.doesNotMatch(queued, /Q-001/);
  assert.match(text, /Parked owner questions[^\n]*:\n- Q-001: License\? \(until first sale\)/);
});

test('g16: decisions.js park and unpark on the command line; open lists only unparked ones', () => {
  const root = makeProject();
  const run = (...args) => spawnSync(process.execPath, [decisionsCli, ...args, '--project', root], { encoding: 'utf8' });
  assert.equal(ask(root).status, 0);
  assert.equal(run('park', 'Q-001').status, 1, 'park needs --until');
  const r = run('park', 'Q-001', '--until', 'first sale');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(run('open').stdout), []);
  assert.equal(JSON.parse(run('parked').stdout)[0].id, 'Q-001');
  assert.equal(run('unpark', 'Q-001').status, 0);
  assert.equal(JSON.parse(run('open').stdout).length, 1);
});

// ---- Part B ----
import { readBoard } from '../scripts/lib/board.js';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';

const agentBody = (role) => parseFrontmatter(fs.readFileSync(path.join(pluginRoot, 'agents', `${role}.md`), 'utf8')).body;
const rulesOf = (role) => agentBody(role).split('## Working rules')[1].split('\n## ')[0];
const DEV_ROLES = ['backend-developer', 'frontend-developer', 'database-engineer', 'test-engineer'];

// ---- B1 (g19) intermediate commits ----
test('g19: board entries carry a size and done warns on a single code commit for M/L tasks', () => {
  const root = makeProject();
  const big = addEntry(root, { title: 'big', owner: 'backend-developer', model: 'sonnet', size: 'L' });
  assert.equal(big.size, 'L');
  assert.equal(readBoard(root).entries.find((e) => e.id === big.id).size, 'L', 'size survives a write/read round trip');
  assert.throws(() => addEntry(root, { title: 'x', owner: 'backend-developer', model: 'sonnet', size: 'XL' }), /size/);
  updateEntry(root, big.id, { status: 'in-progress', commits: ['abc1234'] });
  const one = updateEntry(root, big.id, { status: 'done' });
  assert.match(String(one.warnings), /single code commit/, 'one commit on an L task warns');
  const many = addEntry(root, { title: 'big2', owner: 'backend-developer', model: 'sonnet', size: 'M' });
  const ok = updateEntry(root, many.id, { status: 'done', commits: ['abc1234', 'def5678'] });
  assert.equal(ok.warnings, undefined, 'two commits do not warn');
  const small = addEntry(root, { title: 'small', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  assert.equal(updateEntry(root, small.id, { status: 'done', commits: ['abc1234'] }).warnings, undefined);
  const none = addEntry(root, { title: 'nosize', owner: 'backend-developer', model: 'sonnet' });
  assert.equal(updateEntry(root, none.id, { status: 'done', commits: ['abc1234'] }).warnings, undefined);
});

test('g19: developer roles commit each green step and keep the hand-off current; task-loop reads the hand-off on resume', () => {
  for (const role of DEV_ROLES) {
    assert.match(rulesOf(role), /commit each green step/i, role);
    assert.match(rulesOf(role), /wip/i, role);
    assert.match(rulesOf(role), /hand-off.*every commit/i, role);
  }
  assert.match(fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8'), /resum\w+[^\n]*hand-off first/i);
});

// ---- B2 (g21) out-of-brief behaviour ----
test('g21: developers add no behaviour beyond the brief; the code reviewer reports it as out-of-brief', () => {
  for (const role of DEV_ROLES) {
    assert.match(rulesOf(role), /no behaviour beyond the brief/i, role);
    assert.match(rulesOf(role), /idea goes back to the lead as a question/i, role);
  }
  const rev = agentBody('code-reviewer');
  assert.match(rev, /`out-of-brief`/);
  assert.match(rev, /out-of-brief[^\n]*blocker/i, 'out-of-brief that changes behaviour is a blocker');
  assert.match(rev, /traceable to a (brief )?(acceptance )?criterion/i);
});

// ---- B3 (g11) setup --compaction: keep line endings and indentation, commit its own change ----
import { formatLike } from '../scripts/lib/setup.js';

const setupCli = path.join(pluginRoot, 'scripts', 'setup.js');
const runSetup = (dir, ...a) => spawnSync(process.execPath, [setupCli, '--project', dir, ...a], { encoding: 'utf8' });

test('g11: formatLike keeps CRLF, indentation and the trailing-newline habit of the original file', () => {
  const crlf4 = '{\r\n    "a": 1\r\n}\r\n';
  assert.equal(formatLike({ a: 1, b: 2 }, crlf4), '{\r\n    "a": 1,\r\n    "b": 2\r\n}\r\n');
  assert.equal(formatLike({ a: 1, b: 2 }, '{\n\t"a": 1\n}'), '{\n\t"a": 1,\n\t"b": 2\n}', 'tab indent, no trailing newline');
  assert.equal(formatLike({ a: 1 }, null), '{\n  "a": 1\n}\n', 'no original: 2 spaces, LF');
});

test('g11: --compaction on a CRLF settings file changes only the two keys and commits them as chore(nac)', () => {
  const { root, git } = makeGitProject();
  fs.mkdirSync(path.join(root, '.claude'));
  const file = path.join(root, '.claude', 'settings.json');
  fs.writeFileSync(file, '{\r\n    "env": {\r\n        "X": "1"\r\n    }\r\n}\r\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  const r = runSetup(root, '--compaction');
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!/[^\r]\n/.test(text), 'every line ending is still CRLF');
  assert.match(text, /\r\n    "autoCompactWindow": 200000/, 'indentation kept');
  assert.equal(git('status', '--porcelain'), '', 'tree is clean: the change was committed');
  assert.match(git('log', '-1', '--format=%s'), /^chore\(nac\): /);
  assert.equal(git('show', '--stat', '--format=', 'HEAD').split('\n').length, 2, 'the commit touches only settings.json');
  assert.match(git('diff', 'HEAD~1', 'HEAD', '--numstat'), /^3\t1\t\.claude\/settings\.json/, 'two keys added (the comma line changes), nothing rewritten');
});

test('g11: --compaction outside git, or with settings the owner already edited, writes but does not commit (warns)', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'nac nogit '));
  assert.equal(runSetup(plain, '--compaction').status, 0);
  assert.ok(fs.existsSync(path.join(plain, '.claude', 'settings.json')));
  const { root, git } = makeGitProject();
  fs.mkdirSync(path.join(root, '.claude'));
  const file = path.join(root, '.claude', 'settings.json');
  fs.writeFileSync(file, '{\n  "a": 1\n}\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(file, '{\n  "a": 2\n}\n'); // owner edit, uncommitted
  const r = runSetup(root, '--compaction');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr + r.stdout, /not committed/i);
  assert.equal(git('log', '-1', '--format=%s'), 'init');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).autoCompactWindow, 200000);
});

// ---- B4 (g17) honest compact hand-off ----
import { writeCompactHandoff, compactBlockers } from '../scripts/lib/compact.js';

const handoffText = (p, name) => fs.readFileSync(path.join(p.root, 'team', 'work', 'handoffs', name), 'utf8');

test('g17: compactBlockers lists every failed condition, not just the first', () => {
  const p = cleanGitProject();
  const e = addEntry(p.root, { title: 'in flight', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, e.id, { status: 'in-progress' });
  addQuestion(p.root, q);
  fs.writeFileSync(path.join(p.root, 'dirty.txt'), 'x');
  const list = compactBlockers(p.root);
  assert.equal(list.length, 3);
  assert.match(list.join('\n'), /in flight|T-002/);
  assert.match(list.join('\n'), /uncommitted/);
  assert.match(list.join('\n'), /Q-001/);
  assert.equal(compactBlocker(p.root), list[0], 'compactBlocker keeps returning the first one');
  assert.deepEqual(compactBlockers(cleanGitProject().root), []);
});

test('g17: a ceiling hand-off says it is not a clean point and lists what failed', () => {
  const p = cleanGitProject();
  const e = addEntry(p.root, { title: 'still going', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, e.id, { status: 'in-progress' });
  addQuestion(p.root, q);
  const name = writeCompactHandoff(p.root, new Date(), { trigger: 'ceiling', tokens: 301778, ceiling: 300000 });
  const t = handoffText(p, name);
  assert.doesNotMatch(t, /clean point: nothing in flight|at a clean point/i, 'no false clean-point claim');
  assert.match(t, /ceiling/i);
  assert.match(t, /301778/);
  assert.match(t, /Conditions not met/);
  assert.match(t, /T-002/);
  assert.match(t, /Q-001/);
});

test('g17: a safe-point hand-off keeps the clean-point claim; a manual one says manual', () => {
  const p = cleanGitProject();
  const safe = handoffText(p, writeCompactHandoff(p.root, new Date(), { trigger: 'safe point' }));
  assert.match(safe, /safe point/i);
  assert.match(safe, /no pending owner question/);
  const p2 = cleanGitProject();
  fs.writeFileSync(path.join(p2.root, 'dirty.txt'), 'x');
  const manual = handoffText(p2, writeCompactHandoff(p2.root, new Date(), { trigger: 'manual' }));
  assert.match(manual, /manual/i);
  assert.match(manual, /Conditions not met[\s\S]*uncommitted/);
});

test('g17: next task is the in-progress one first, then a brief-ready todo, then any todo', () => {
  const p = cleanGitProject();
  const todoPlain = addEntry(p.root, { title: 'plain todo', owner: 'backend-developer', model: 'sonnet' });
  const todoBrief = addEntry(p.root, { title: 'brief-ready todo', owner: 'backend-developer', model: 'sonnet' });
  fs.mkdirSync(path.join(p.root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'tasks', `${todoBrief.id}.md`), '# brief');
  const next = (t) => handoffText(p, writeCompactHandoff(p.root, t, { trigger: 'safe point' })).match(/^Next task: (.*)$/m)[1];
  assert.match(next(new Date(2026, 0, 1, 1, 0, 1)), new RegExp(`^${todoBrief.id}`), 'brief-ready beats a plain todo that comes earlier');
  const going = addEntry(p.root, { title: 'going', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, going.id, { status: 'in-progress' });
  assert.match(next(new Date(2026, 0, 1, 1, 0, 2)), new RegExp(`^${going.id}`), 'in-progress wins');
  updateEntry(p.root, going.id, { status: 'done', commits: ['abc1234'] });
  updateEntry(p.root, todoBrief.id, { status: 'done', commits: ['abc1234'] });
  assert.match(next(new Date(2026, 0, 1, 1, 0, 3)), new RegExp(`^${todoPlain.id}`));
});

test('g17: the pre-compact hook writes a ceiling hand-off that names the ceiling and the failed conditions', () => {
  const p = cleanGitProject();
  fs.writeFileSync(path.join(p.root, 'dirty.txt'), 'x');
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac tr ')), 't.jsonl');
  fs.writeFileSync(tr, `${JSON.stringify({ type: 'assistant', message: { content: [], usage: { input_tokens: 10, cache_read_input_tokens: 310000, cache_creation_input_tokens: 20 } } })}\n`);
  const r = runHookNamed('pre-compact', { hook_event_name: 'PreCompact', session_id: `g17-${process.pid}-${Date.now()}`, cwd: p.root, trigger: 'auto', transcript_path: tr });
  assert.equal(r.status, 0, r.stderr);
  const names = fs.readdirSync(path.join(p.root, 'team', 'work', 'handoffs')).filter((n) => n.startsWith('compact-'));
  assert.equal(names.length, 1);
  const t = handoffText(p, names[0]);
  assert.match(t, /ceiling/i);
  assert.match(t, /uncommitted/);
  const m = runHookNamed('pre-compact', { hook_event_name: 'PreCompact', session_id: `g17m-${process.pid}-${Date.now()}`, cwd: p.root, trigger: 'manual', transcript_path: tr });
  assert.equal(m.status, 0, m.stderr);
  assert.ok(fs.readdirSync(path.join(p.root, 'team', 'work', 'handoffs')).some((n) => /^compact-.*\.md$/.test(n) && /manual/i.test(handoffText(p, n))), 'a manual compaction also leaves an honest hand-off');
});

// ---- B5 (g20) a task does not close without a cost file ----
import { ensureCostFile } from '../scripts/lib/cost.js';

const boardCli = path.join(pluginRoot, 'scripts', 'board.js');
const costFiles = (root) => { try { return fs.readdirSync(path.join(root, 'team', 'metrics')).filter((f) => /^cost-.*\.md$/.test(f)); } catch { return []; } };

test('g20: ensureCostFile finds an existing task cost file and does not mistake a longer id for it', () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, 'team', 'metrics'));
  fs.writeFileSync(path.join(root, 'team', 'metrics', 'cost-T-010-2026-10-01-1200.md'), 'x');
  const miss = ensureCostFile(root, 'T-01', { home: os.tmpdir() });
  assert.equal(miss.created, true, 'cost-T-010-... is not the cost file of T-01');
  assert.match(path.basename(miss.file), /^cost-T-01-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  const hit = ensureCostFile(root, 'T-010', { home: os.tmpdir() });
  assert.equal(hit.created, false);
  assert.equal(path.basename(hit.file), 'cost-T-010-2026-10-01-1200.md');
});

test('g20: board.js update --status done writes the cost file itself when it is missing, once', () => {
  const root = makeProject();
  const run = (...a) => spawnSync(process.execPath, [boardCli, ...a, '--project', root], { encoding: 'utf8' });
  assert.equal(run('add', '--title', 'x', '--owner', 'backend-developer', '--model', 'sonnet').status, 0);
  assert.equal(costFiles(root).length, 0);
  const r = run('update', 'T-001', '--status', 'done');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(costFiles(root).length, 1);
  assert.match(costFiles(root)[0], /^cost-T-001-/);
  assert.match(JSON.parse(r.stdout).cost.file, /cost-T-001-/);
  assert.equal(run('update', 'T-001', '--status', 'done').status, 0);
  assert.equal(costFiles(root).length, 1, 'a second done does not write another file');
  run('update', 'T-001', '--status', 'in-progress');
  assert.equal(costFiles(root).length, 1, 'only done triggers it');
});

test('g20: a refused done writes no cost file; a cost.js failure only warns', () => {
  const root = makeProject();
  const run = (...a) => spawnSync(process.execPath, [boardCli, ...a, '--project', root], { encoding: 'utf8' });
  run('add', '--title', 'x', '--owner', 'backend-developer', '--model', 'sonnet', '--security', 'contract');
  assert.equal(run('update', 'T-001', '--status', 'done').status, 1);
  assert.equal(costFiles(root).length, 0);
  run('review', 'T-001', '--role', 'security-reviewer', '--verdict', 'pass');
  fs.writeFileSync(path.join(root, 'team', 'metrics'), 'a file where the folder should be');
  const r = run('update', 'T-001', '--status', 'done');
  assert.equal(r.status, 0, 'fail-open: the board update still succeeds');
  assert.match(r.stderr, /cost file not written/i);
  assert.equal(JSON.parse(r.stdout).status, 'done');
});
