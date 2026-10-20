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

const goBrief = (cmd) => `# T-037\n- Go-path test: \`${cmd}\` (stub runner, --yes reaches the executor)\n`;
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

test('g23: refused when the named go-path command cannot run', () => {
  const r = ask(irreversibleProject({ brief: '# T-037\nGo-path test: tests/missing.rs\n' }), '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tests\/missing\.rs/);
});

test('g23: refused when the gate is red', () => {
  const r = ask(irreversibleProject({ brief: goBrief(exit(0)), gate: exit(1) }), '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /gate is not green/);
});

test('g23: refused (closed) when no gate command is configured', () => {
  const root = irreversibleProject({ brief: goBrief(exit(0)) });
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  assert.equal(ask(root, '--irreversible', '--task', 'T-037').status, 1);
});

test('g23: allowed when the brief names an existing test and the gate is green; the question carries the tag', () => {
  const root = irreversibleProject({ brief: goBrief(exit(0)) });
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
  updateEntry(p.root, e.id, { status: 'done', commits: [p.commit('work.txt')] }, { singleCommit: 'test' });
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
test('g19: board entries carry a size and it survives a write/read round trip', () => {
  const root = makeProject();
  const big = addEntry(root, { title: 'big', owner: 'backend-developer', model: 'sonnet', size: 'L' });
  assert.equal(big.size, 'L');
  assert.equal(readBoard(root).entries.find((e) => e.id === big.id).size, 'L', 'size survives a write/read round trip');
  assert.throws(() => addEntry(root, { title: 'x', owner: 'backend-developer', model: 'sonnet', size: 'XL' }), /size/);
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
  const name = writeCompactHandoff(p.root, new Date(), { trigger: 'ceiling', tokens: 301778, ceiling: 220000 });
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
  fs.writeFileSync(path.join(p2.root, 'team', 'dirty.txt'), 'x');
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
  updateEntry(p.root, going.id, { status: 'done', commits: ['abc1234'] }, { singleCommit: 'test' });
  updateEntry(p.root, todoBrief.id, { status: 'done', commits: ['abc1234'] }, { singleCommit: 'test' });
  assert.match(next(new Date(2026, 0, 1, 1, 0, 3)), new RegExp(`^${todoPlain.id}`));
});

test('g17: the pre-compact hook writes a ceiling hand-off that names the ceiling and the failed conditions', () => {
  const p = cleanGitProject();
  fs.writeFileSync(path.join(p.root, 'team', 'dirty.txt'), 'x');
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
  const r = run('update', 'T-001', '--status', 'done', '--single-commit', 'x');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(costFiles(root).length, 1);
  assert.match(costFiles(root)[0], /^cost-T-001-/);
  assert.match(JSON.parse(r.stdout).cost.file, /cost-T-001-/);
  assert.equal(run('update', 'T-001', '--status', 'done', '--single-commit', 'x').status, 0);
  assert.equal(costFiles(root).length, 1, 'a second done does not write another file');
  run('update', 'T-001', '--status', 'in-progress');
  assert.equal(costFiles(root).length, 1, 'only done triggers it');
});

test('g20: a refused done writes no cost file; a cost.js failure only warns', () => {
  const root = makeProject();
  const run = (...a) => spawnSync(process.execPath, [boardCli, ...a, '--project', root], { encoding: 'utf8' });
  run('add', '--title', 'x', '--owner', 'backend-developer', '--model', 'sonnet', '--security', 'contract');
  assert.equal(run('update', 'T-001', '--status', 'done', '--single-commit', 'x').status, 1);
  assert.equal(costFiles(root).length, 0);
  run('review', 'T-001', '--role', 'security-reviewer', '--verdict', 'pass');
  fs.writeFileSync(path.join(root, 'team', 'metrics'), 'a file where the folder should be');
  const r = run('update', 'T-001', '--status', 'done', '--single-commit', 'x');
  assert.equal(r.status, 0, 'fail-open: the board update still succeeds');
  assert.match(r.stderr, /cost file not written/i);
  assert.equal(JSON.parse(r.stdout).status, 'done');
});

// ---- C1 (g14) question lists in hand-offs come from decisions state ----
import { decide } from '../scripts/lib/decisions.js';
import { questionListsMarkdown } from '../scripts/lib/summary.js';

test('g14: a closed question is absent from the compact hand-off, an open and a parked one are listed apart', () => {
  const p = cleanGitProject();
  addQuestion(p.root, q);
  addQuestion(p.root, { ...q, title: 'Second?' });
  addQuestion(p.root, { ...q, title: 'Third?' });
  decide(p.root, 'Q-001', { answer: 'yes' });
  parkQuestion(p.root, 'Q-003', { until: 'first sale' });
  const t = handoffText(p, writeCompactHandoff(p.root, new Date(), { trigger: 'manual' }));
  assert.doesNotMatch(t, /Q-001/, 'closed question must not appear');
  assert.match(t, /Queued owner questions:[\s\S]*Q-002/);
  assert.match(t, /Parked owner questions[\s\S]*Q-003/);
});

test('g14: questionListsMarkdown is generated from state and decisions.js handoff-questions prints it', () => {
  const root = makeProject();
  addQuestion(root, q);
  addQuestion(root, { ...q, title: 'Second?' });
  decide(root, 'Q-001', { answer: 'yes' });
  const md = questionListsMarkdown(root);
  assert.match(md, /Q-002/);
  assert.doesNotMatch(md, /Q-001/);
  const r = spawnSync(process.execPath, [decisionsCli, 'handoff-questions', '--project', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Q-002/);
  assert.doesNotMatch(r.stdout, /Q-001/);
  assert.equal(questionListsMarkdown(makeProject()).trim(), 'No open owner questions.');
});

test('g14: the resume summary warns that a hand-written lead hand-off may list stale questions', () => {
  const root = makeProject();
  const dir = path.join(root, 'team', 'work', 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'lead-2026-10-19-1430.md'), 'x');
  assert.match(buildResumeSummary(root, { gitStatus: '' }), /question lists[\s\S]*stale|stale[\s\S]*decisions/i);
  assert.doesNotMatch(buildResumeSummary(makeProject(), { gitStatus: '' }), /stale/i);
});

test('g14: the rotation skill tells the lead to generate the question lists, not write them', () => {
  const s = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(s, /decisions\.js" handoff-questions/);
});

// ---- C2 (g13) owner question buried in a status report ----
import { buriedQuestionProblem } from '../scripts/lib/owner-question.js';

const REPORT = '## Done\n- T-028 merged, tests green.\n\nI recommend option a for Q-001.\n\nWhich one do you pick?';
const BLOCK = 'Source: T-028 review\nStatus: code written\nImpact: auth contract\nOptions: a) now b) later\nRecommendation: a\nQ-001: which one?';

test('g13: buriedQuestionProblem flags a question to the owner inside a status report even with a recommendation', () => {
  assert.match(buriedQuestionProblem(REPORT, ['Q-001']), /status report/i);
  assert.match(buriedQuestionProblem('**Summary**\nAll done.\n\nShall we continue? Önerim: evet.', []), /status report/i);
});

test('g13: an open Q-id mentioned without its own question block is flagged; with the block, or a closed id, it is not', () => {
  assert.match(buriedQuestionProblem('Waiting on your answer to Q-004 before the next task.', ['Q-004']), /Q-004/);
  assert.equal(buriedQuestionProblem('Waiting on your answer to Q-004.', ['Q-009']), '', 'a Q-id that is not open is history');
  assert.equal(buriedQuestionProblem(BLOCK, ['Q-001']), '');
  assert.equal(buriedQuestionProblem('A question alone? Recommendation: yes.', []), '');
  assert.equal(buriedQuestionProblem('## Done\nAll merged.', ['Q-001']), '', 'no Q-id mention, no question');
});

test('g13: fail-open on odd input', () => {
  assert.equal(buriedQuestionProblem(undefined, ['Q-001']), '');
  assert.equal(buriedQuestionProblem('Q-001 ?', null), '');
  assert.equal(buriedQuestionProblem('', []), '');
});

test('g13: the Stop hook blocks a report with a buried open question once, and passes a clean question message', () => {
  const root = makeProject();
  addQuestion(root, q);
  const stop = (msg, patch = {}) => runHookScript('stop-question', { session_id: 's', cwd: root, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg, ...patch });
  const r = stop('## Done\n- T-028 merged.\n\nQ-001 is open, I recommend yes. Agree?');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /own message|separate/i);
  assert.equal(stop('## Done\n- T-028 merged.\n\nQ-001 is open, I recommend yes. Agree?', { stop_hook_active: true }).status, 0);
  assert.equal(stop('## Done\n- T-028 merged. Tests green.').status, 0);
  assert.equal(stop(BLOCK).status, 0);
});

// ---- C3 (g15) rotation vs conditional compaction ----

function fifthDone(root) {
  const run = (...a) => spawnSync(process.execPath, [boardCli, ...a, '--project', root], { encoding: 'utf8' });
  for (let i = 1; i <= 5; i += 1) run('add', '--title', `T${i}`, '--owner', 'backend-developer', '--model', 'sonnet');
  let last;
  for (let i = 1; i <= 5; i += 1) last = run('update', `T-00${i}`, '--status', 'done', '--single-commit', 'x');
  return JSON.parse(last.stdout);
}

test('g15: the fifth done names how to rotate: autocompact when compaction is configured, /clear when it is off', () => {
  const off = fifthDone(makeProject());
  assert.equal(off.rotate, true);
  assert.equal(off.rotateBy, 'clear');
  const root = makeProject();
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 200000 }));
  const on = fifthDone(root);
  assert.equal(on.rotate, true);
  assert.equal(on.rotateBy, 'compaction');
});

test('g15: the rotation skill rotates by hand-off plus autocompact when compaction is on, /clear only when it is off', () => {
  const s = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  const section = s.split('## Session rotation')[1].split('\n## ')[0];
  assert.match(section, /rotateBy/);
  assert.match(section, /compaction[\s\S]*autocompact|autocompact[\s\S]*compaction/i);
  assert.match(section, /\/clear[^\n]*(only|off)|(only|off)[^\n]*\/clear/i);
  assert.doesNotMatch(section, /Tell the owner: run `\/clear`, then say "devam" \(or "continue"\)\.\s/, 'the unconditional /clear step is gone');
  assert.match(section, /devam/, 'the /clear path still resumes with "devam"');
});

// ---- C4 (g12) drift warning only on a real difference ----
import { pluginSourceDrift } from '../scripts/lib/drift.js';

function driftCase({ cacheVersion = '1.2.0', srcVersion = '1.2.0', cacheScript = 'export const a = 1;\n', srcScript = 'export const a = 1;\n', installPath = true } = {}) {
  const src = makeGitProject();
  const put = (dir, version, script) => {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'nac', version }));
    fs.writeFileSync(path.join(dir, 'scripts', 's.js'), script);
  };
  put(src.root, srcVersion, srcScript);
  src.git('add', '-A');
  src.git('commit', '-q', '-m', 'plugin');
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'nac cache '));
  put(cache, cacheVersion, cacheScript);
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), 'nac plugins '));
  fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'nac@nereus-agent-company': [{ ...(installPath ? { installPath: cache } : {}), version: cacheVersion, gitCommitSha: '7713ae5'.padEnd(40, '0') }] } }));
  fs.writeFileSync(path.join(plugins, 'known_marketplaces.json'), JSON.stringify({ 'nereus-agent-company': { source: { source: 'directory', path: src.root }, installLocation: src.root } }));
  return { plugins };
}

test('g12: a stale sha record with identical cache and source gives one "sha record stale" line, no drift alarm', () => {
  const w = pluginSourceDrift({ pluginsDir: driftCase().plugins });
  assert.ok(w && !w.includes('\n'), 'one line');
  assert.match(w, /sha record stale/i);
  assert.match(w, /\/plugin update/);
  assert.doesNotMatch(w, /drift/i);
});

test('g12: a version difference is a real drift and prints both versions and both shas', () => {
  const w = pluginSourceDrift({ pluginsDir: driftCase({ srcVersion: '1.3.0' }).plugins });
  assert.match(w, /NAC plugin drift/);
  assert.match(w, /1\.2\.0/);
  assert.match(w, /1\.3\.0/);
  assert.match(w, /7713ae5/);
});

test('g12: the same version with different code is a real drift', () => {
  const w = pluginSourceDrift({ pluginsDir: driftCase({ srcScript: 'export const a = 2;\n' }).plugins });
  assert.match(w, /NAC plugin drift/);
  assert.match(w, /1\.2\.0/);
});

test('g12: an unreadable cache path falls back to the sha-only warning; nothing throws', () => {
  const w = pluginSourceDrift({ pluginsDir: driftCase({ installPath: false }).plugins });
  assert.match(w, /NAC plugin drift/);
  const c = driftCase();
  const rec = JSON.parse(fs.readFileSync(path.join(c.plugins, 'installed_plugins.json'), 'utf8'));
  rec.plugins['nac@nereus-agent-company'][0].installPath = path.join(os.tmpdir(), 'nac-gone-cache');
  fs.writeFileSync(path.join(c.plugins, 'installed_plugins.json'), JSON.stringify(rec));
  assert.match(pluginSourceDrift({ pluginsDir: c.plugins }), /NAC plugin drift/);
});

// ---- D1 (g24) parallel developers need their own worktree ----
import { worktreePath } from '../scripts/lib/worktree.js';

const code2 = (root) => {
  addEntry(root, { id: 'T-1', title: 'refs', owner: 'backend-developer', model: 'sonnet' });
  addEntry(root, { id: 'T-2', title: 'parse', owner: 'backend-developer', model: 'sonnet' });
};

test('g24: a second in-progress code task in the same tree is refused and names worktree.js', () => {
  const root = makeProject();
  code2(root);
  updateEntry(root, 'T-1', { status: 'in-progress' });
  assert.throws(() => updateEntry(root, 'T-2', { status: 'in-progress' }), /T-1.*worktree\.js/s);
  assert.equal(readBoard(root).entries.find((e) => e.id === 'T-2').status, 'todo', 'the refused task is unchanged');
});

test('g24: distinct worktrees are allowed; the same worktree twice is refused', () => {
  const root = makeProject();
  code2(root);
  updateEntry(root, 'T-1', { status: 'in-progress', worktree: '/wt/T-1' });
  assert.doesNotThrow(() => updateEntry(root, 'T-2', { status: 'in-progress', worktree: '/wt/T-2' }));
  assert.equal(readBoard(root).entries[1].worktree, '/wt/T-2');
  addEntry(root, { id: 'T-3', title: 'x', owner: 'backend-developer', model: 'sonnet' });
  assert.doesNotThrow(() => updateEntry(root, 'T-3', { status: 'in-progress' }), 'the main tree is free');
  addEntry(root, { id: 'T-4', title: 'y', owner: 'backend-developer', model: 'sonnet' });
  assert.throws(() => updateEntry(root, 'T-4', { status: 'in-progress', worktree: '/wt/T-2' }), /T-2/);
});

test('g24: code: no tasks and tasks in review do not count as occupying the tree', () => {
  const root = makeProject();
  code2(root);
  addEntry(root, { id: 'T-9', title: 'spike', owner: 'researcher', model: 'sonnet', code: 'no' });
  updateEntry(root, 'T-9', { status: 'in-progress' });
  updateEntry(root, 'T-1', { status: 'in-progress' });
  updateEntry(root, 'T-1', { status: 'review' });
  assert.doesNotThrow(() => updateEntry(root, 'T-2', { status: 'in-progress' }));
});

test('g24: re-marking the same task in-progress is not a conflict with itself', () => {
  const root = makeProject();
  code2(root);
  updateEntry(root, 'T-1', { status: 'in-progress' });
  assert.doesNotThrow(() => updateEntry(root, 'T-1', { status: 'in-progress', handoff: 'team/work/handoffs/T-1.md' }));
});

test('g24: worktreePath honours a base directory (config worktreeRoot)', () => {
  const root = path.join(os.tmpdir(), 'proj');
  assert.equal(worktreePath(root, 'T-7'), path.join(`${root}-wt`, 'T-7'));
  assert.equal(worktreePath(root, 'T-7', { worktreeRoot: path.join(os.tmpdir(), 'bigdrive') }), path.join(os.tmpdir(), 'bigdrive', 'proj-wt', 'T-7'));
});

test('g24: worktreeRoot must be a non-empty string', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: null });
  assert.doesNotThrow(() => validateConfig({ ...base, worktreeRoot: '/big' }));
  for (const bad of ['', ' ', 5, []]) assert.throws(() => validateConfig({ ...base, worktreeRoot: bad }), /worktreeRoot/);
});

test('g24: board.js update --worktree is recorded and the CLI refuses a second tree user', () => {
  const root = makeProject();
  code2(root);
  const run = (...a) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'board.js'), ...a, '--project', root], { encoding: 'utf8' });
  assert.equal(run('update', 'T-1', '--status', 'in-progress').status, 0);
  const r = run('update', 'T-2', '--status', 'in-progress');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /worktree.js" add T-2/);
  assert.equal(run('update', 'T-2', '--status', 'in-progress', '--worktree', '/wt/T-2').status, 0);
});

test('g24: the task-loop skill says parallel code tasks always get their own worktree', () => {
  const t = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(t, /parallel code tasks always get their own worktree/i);
  assert.match(t, /--worktree/);
  assert.match(t, /worktreeRoot/);
});

// ---- E1 (g25) compaction when the lead's own state is safe, ceiling 220K ----
import { DEFAULT_CEILING } from '../scripts/lib/compact.js';

const trOf = (tokens) => {
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac tr ')), 't.jsonl');
  fs.writeFileSync(tr, `${JSON.stringify({ type: 'assistant', message: { content: [], usage: { input_tokens: 10, cache_read_input_tokens: tokens, cache_creation_input_tokens: 20 } } })}\n`);
  return tr;
};
const autoPre = (p, tokens) => runHookNamed('pre-compact', { hook_event_name: 'PreCompact', session_id: `g25-${process.pid}-${Date.now()}-${Math.random()}`, cwd: p.root, trigger: 'auto', transcript_path: trOf(tokens) });
function inFlight(p, { handoff = true, worktree, agent } = {}) {
  const e = addEntry(p.root, { title: 'running', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, e.id, { status: 'in-progress', ...(worktree ? { worktree } : {}), ...(agent ? { agent } : {}), ...(handoff ? { handoff: `team/work/handoffs/${e.id}.md` } : {}) });
  if (handoff) {
    fs.mkdirSync(path.join(p.root, 'team', 'work', 'handoffs'), { recursive: true });
    fs.writeFileSync(path.join(p.root, 'team', 'work', 'handoffs', `${e.id}.md`), '# steps so far');
  }
  commitAll(p);
  return e;
}

test('g25: the default ceiling is 220000 in code and in the shipped config', () => {
  assert.equal(DEFAULT_CEILING, 220000);
  assert.equal(loadConfig({ pluginRoot, userConfigPath: null }).compaction.ceiling, 220000);
});

test('g25: tasks in flight with a committed team/ state and hand-offs no longer block compaction', () => {
  const p = cleanGitProject();
  inFlight(p);
  inFlight(p, { worktree: '/wt/x' });
  assert.deepEqual(compactBlockers(p.root), []);
  assert.equal(autoPre(p, 150000).status, 0);
});

test('g25: an in-progress task without a hand-off file blocks, naming the task', () => {
  const p = cleanGitProject();
  const e = inFlight(p, { handoff: false });
  assert.match(compactBlockers(p.root).join('\n'), new RegExp(`${e.id}.*hand-off`));
  assert.equal(autoPre(p, 150000).status, 2);
});

test('g25: an uncommitted team/ change blocks, a developer file elsewhere does not', () => {
  const p = cleanGitProject();
  inFlight(p);
  fs.writeFileSync(path.join(p.root, 'src.rs'), 'fn main() {}');
  fs.writeFileSync(path.join(p.root, 'work.txt'), 'edited by a developer');
  assert.deepEqual(compactBlockers(p.root), []);
  fs.appendFileSync(path.join(p.root, 'team', 'work', 'board.md'), '\n');
  const r = autoPre(p, 150000);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /uncommitted/);
});

test('g25: parked and deferred questions do not block; a pending one does', () => {
  const p = cleanGitProject();
  inFlight(p);
  const a = addQuestion(p.root, q);
  parkQuestion(p.root, a.id, { until: 'first sale' });
  addQuestion(p.root, { ...q, title: 'later?', defer: true });
  commitAll(p);
  assert.deepEqual(compactBlockers(p.root), []);
  addQuestion(p.root, { ...q, title: 'now?' });
  commitAll(p);
  assert.match(compactBlockers(p.root).join('\n'), /not answered/);
});

test('g25: the hand-off lists every in-flight task with role, agent, worktree and hand-off file', () => {
  const p = cleanGitProject();
  const a = inFlight(p, { worktree: '/wt/refs', agent: 'dev-1' });
  const b = inFlight(p);
  const t = handoffText(p, writeCompactHandoff(p.root, new Date(), { trigger: 'safe point' }));
  const line = (id) => t.split('\n').find((l) => l.includes(`${id}:`) && /owner/.test(l));
  assert.match(line(a.id), /owner backend-developer/);
  assert.match(line(a.id), /agent dev-1/);
  assert.match(line(a.id), /worktree \/wt\/refs/);
  assert.match(line(a.id), new RegExp(`team/work/handoffs/${a.id}\.md`));
  assert.match(line(b.id), /owner backend-developer/);
  assert.doesNotMatch(line(b.id), /agent|worktree/);
  assert.match(t, /In flight/);
});

test('g25: a project with nothing in flight has no In flight section', () => {
  const p = cleanGitProject();
  assert.doesNotMatch(handoffText(p, writeCompactHandoff(p.root, new Date(), { trigger: 'safe point' })), /In flight/);
});

test('g25: a ceiling-path compaction is never blocked, even with a pending question and a dirty team/', () => {
  const p = cleanGitProject();
  addQuestion(p.root, q);
  fs.writeFileSync(path.join(p.root, 'team', 'dirty.txt'), 'x');
  assert.equal(autoPre(p, 230000).status, 0);
});

test('g25: board.js update --agent records the agent on the entry', () => {
  const root = makeProject();
  addEntry(root, { id: 'T-1', title: 'x', owner: 'backend-developer', model: 'sonnet' });
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'board.js'), 'update', 'T-1', '--status', 'in-progress', '--agent', 'dev-1', '--project', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readBoard(root).entries[0].agent, 'dev-1');
});

// ---- F1 (g19 hard) single-commit M/L tasks are refused at done ----
test('g19 hard: a task without a size counts as M; done with at most one code commit is refused', () => {
  const root = makeProject();
  const t = addEntry(root, { title: 'nosize', owner: 'backend-developer', model: 'sonnet' });
  assert.throws(() => updateEntry(root, t.id, { status: 'done', commits: ['abc1234'] }), /at most one code commit.*--single-commit/s);
  assert.equal(readBoard(root).entries[0].status, 'todo', 'the refusal leaves the entry untouched');
  const l = addEntry(root, { title: 'big', owner: 'backend-developer', model: 'sonnet', size: 'L' });
  assert.throws(() => updateEntry(root, l.id, { status: 'done' }), /at most one code commit/);
  assert.equal(updateEntry(root, t.id, { status: 'done', commits: ['abc1234', 'def5678'] }).status, 'done');
});

test('g19 hard: S tasks and code: no tasks are unaffected', () => {
  const root = makeProject();
  const s = addEntry(root, { title: 's', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  assert.equal(updateEntry(root, s.id, { status: 'done', commits: ['abc1234'] }).status, 'done');
  const d = addEntry(root, { title: 'docs', owner: 'planner', model: 'sonnet', code: 'no' });
  assert.equal(updateEntry(root, d.id, { status: 'done' }).status, 'done');
});

test('g19 hard: --single-commit <reason> lets done through and records the reason in the decisions log', () => {
  const root = makeProject();
  const t = addEntry(root, { title: 'one-shot', owner: 'backend-developer', model: 'sonnet', size: 'M' });
  const r = updateEntry(root, t.id, { status: 'done', commits: ['abc1234'] }, { singleCommit: 'one-line config fix' });
  assert.equal(r.status, 'done');
  assert.match(fs.readFileSync(path.join(root, 'team', 'decisions.md'), 'utf8'), /one-line config fix/);
});

test('g19 hard: board.js update --single-commit works on the command line and an empty reason is refused', () => {
  const { root, commit } = makeGitProject();
  const sha = commit('a.txt');
  const boardCli = path.join(pluginRoot, 'scripts', 'board.js');
  const run = (...a) => spawnSync(process.execPath, [boardCli, ...a, '--project', root], { encoding: 'utf8' });
  addEntry(root, { id: 'T-1', title: 'x', owner: 'backend-developer', model: 'sonnet' });
  const refused = run('update', 'T-1', '--status', 'done', '--commit', sha);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--single-commit/);
  assert.equal(run('update', 'T-1', '--status', 'done', '--commit', sha, '--single-commit', '').status, 1);
  const ok = run('update', 'T-1', '--status', 'done', '--commit', sha, '--single-commit', 'tiny change');
  assert.equal(ok.status, 0, ok.stderr);
});

// ---- F2 (g22 wider) pack guard covers test-engineer and final-reviewer ----
test('g22 wider: test-engineer and final-reviewer dispatches without a pack are refused, with or without the nac: prefix', () => {
  const root = makeProject();
  for (const role of ['test-engineer', 'nac:test-engineer', 'final-reviewer', 'nac:final-reviewer']) {
    const r = dispatch(root, role, 'Verify T-001');
    assert.equal(r.status, 2, role);
    assert.match(r.stderr, /pack\.js/);
  }
  assert.equal(dispatch(root, 'test-engineer', 'Read team/work/packs/T-001-test-engineer.md first.').status, 0);
  assert.equal(dispatch(root, 'final-reviewer', 'x --no-pack whole-project review').status, 0, 'the escape hatch is unchanged');
  assert.equal(dispatch(root, 'my-test-engineer-helper', 'x').status, 0, 'only the exact role names are covered');
});

// ---- F3 (g26) unregistered Q-ids and unread D-ids ----
import { unknownIdsProblem } from '../scripts/lib/owner-question.js';
import { decide as decideQuestion } from '../scripts/lib/decisions.js';

test('g26: unknownIdsProblem names Q-ids and D-ids that are not in decisions.md', () => {
  const root = makeProject();
  addQuestion(root, q);
  decideQuestion(root, 'Q-001', { answer: 'yes' });
  addQuestion(root, { ...q, title: 'second?' });
  assert.equal(unknownIdsProblem(root, 'Q-001 was decided as D-001; Q-002 is open.'), '', 'registered ids pass');
  assert.match(unknownIdsProblem(root, 'Sent Q-123 to the proxy.'), /Q-123/);
  assert.match(unknownIdsProblem(root, 'Recorded as D-225.'), /D-225/);
  const both = unknownIdsProblem(root, 'Q-123 answered, recorded as D-225, also D-001.');
  assert.match(both, /Q-123/);
  assert.match(both, /D-225/);
  assert.doesNotMatch(both, /D-001/);
  assert.equal(unknownIdsProblem(root, 'No ids here, only T-001 and F-12.'), '');
});

test('g26: unknownIdsProblem fails open on odd input and on an unreadable log', () => {
  const root = makeProject();
  assert.equal(unknownIdsProblem(root, undefined), '');
  assert.equal(unknownIdsProblem(root, ''), '');
  assert.equal(unknownIdsProblem(null, 'Q-9'), '');
  assert.equal(unknownIdsProblem(path.join(root, 'nope'), 'Q-9'), '', 'a project without a decisions log has nothing to compare with');
});

test('g26: the Stop hook sends the lead back once for an unregistered Q-id or an unread D-id', () => {
  const root = makeProject();
  addQuestion(root, q);
  const stop = (msg, patch = {}) => runHookScript('stop-question', { session_id: 's', cwd: root, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg, ...patch });
  const r = stop('Sent Q-123 to the proxy. Recorded as D-225.');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Q-123/);
  assert.match(r.stderr, /D-225/);
  assert.match(r.stderr, /decisions\.js ask/);
  assert.equal(stop('Sent Q-123 to the proxy.', { stop_hook_active: true }).status, 0, 'only once');
  assert.equal(stop('Q-001 is open.\nSource: x').status, 0, 'a registered id passes');
});

test('g26: question-protocol says register first, quote the Q-id from ask, report D-ids from decide', () => {
  const qp = fs.readFileSync(path.join(pluginRoot, 'skills', 'question-protocol', 'SKILL.md'), 'utf8');
  assert.match(qp, /register[^\n]*before[^\n]*(proxy|owner)/i);
  assert.match(qp, /Q-id[^\n]*`ask`|`ask`[^\n]*Q-id/);
  assert.match(qp, /D-id[^\n]*`decide`|`decide`[^\n]*D-id/);
});

// ---- F4 (D-227) team commits use a team/-only pathspec ----
import { commitPaths } from '../scripts/lib/commit.js';

function stagedDeveloperProject() {
  const p = makeGitProject();
  p.commit('seed.txt');
  fs.mkdirSync(path.join(p.root, 'src'));
  fs.writeFileSync(path.join(p.root, 'src', 'refs.rs'), 'fn staged() {}');
  p.git('add', 'src/refs.rs');
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'board.md'), '# Board\nphase: 1\n');
  return p;
}

test('D-227: commitPaths commits only the given paths; a staged developer file stays staged and uncommitted', () => {
  const p = stagedDeveloperProject();
  const r = commitPaths(p.root, ['team'], 'chore(team): T-001 done');
  assert.equal(r.committed, true, r.warning);
  const files = p.git('show', '--name-only', '--format=', 'HEAD').split(String.fromCharCode(10));
  assert.ok(files.includes('team/work/board.md') && files.every((f) => f.startsWith('team/')), `the commit holds team/ files only: ${files}`);
  assert.equal(p.git('diff', '--cached', '--name-only'), 'src/refs.rs', 'the developer file is still staged');
  assert.equal(p.git('log', '-1', '--format=%s'), 'chore(team): T-001 done');
});

test('D-227: commitPaths with nothing changed in the paths commits nothing; outside git it warns instead of throwing', () => {
  const p = stagedDeveloperProject();
  commitPaths(p.root, ['team'], 'first');
  const again = commitPaths(p.root, ['team'], 'second');
  assert.equal(again.committed, false);
  assert.equal(p.git('log', '-1', '--format=%s'), 'first');
  const plain = makeProject();
  const r = commitPaths(plain, ['team'], 'x');
  assert.equal(r.committed, false);
  assert.match(r.warning, /not a git repository/);
});

test('D-227: team-commit.js commits team/ with a pathspec and leaves a staged developer file alone', () => {
  const p = stagedDeveloperProject();
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'team-commit.js'), '--message', 'chore(team): lead hand-off', '--project', p.root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).committed, true);
  assert.equal(p.git('diff', '--cached', '--name-only'), 'src/refs.rs');
  assert.equal(spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'team-commit.js'), '--project', p.root], { encoding: 'utf8' }).status, 1, 'a message is required');
});

test('D-227: the lead skill says team commits use the team/ pathspec', () => {
  const s = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(s, /team-commit\.js/);
  assert.match(s, /git commit[^\n]*-- team\//);
});

// ---- F5 (g11 follow-up) setup --apply commits what it creates ----
function gitProjectForSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac setup git '));
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  git('add', 'seed.txt');
  git('commit', '-q', '-m', 'seed');
  return { dir, git };
}
const setupPlan = (dir) => planSetup(dir, { pluginRoot, config: loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null }) });

test('g11: setup --apply commits exactly the files it created or changed, as chore(nac), and leaves staged developer code alone', () => {
  const { dir, git } = gitProjectForSetup();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.rs'), 'fn a() {}');
  git('add', 'src/a.rs');
  const r = applySetup(setupPlan(dir));
  assert.equal(r.committed, true, r.warning);
  assert.match(git('log', '-1', '--format=%s'), /^chore\(nac\): /);
  const files = git('show', '--name-only', '--format=', 'HEAD').split(/\r?\n/);
  assert.ok(files.includes('team/config.json') && files.includes('.claude/settings.json') && files.includes('CLAUDE.md') && files.includes('.gitignore'), files.join(','));
  assert.ok(!files.includes('src/a.rs'));
  assert.equal(git('diff', '--cached', '--name-only'), 'src/a.rs', 'the staged developer file is still staged');
  assert.equal(git('status', '--porcelain', '--', 'team', '.claude', 'CLAUDE.md', '.gitignore'), '', 'nothing NAC wrote is left uncommitted');
});

test('g11: a second setup run changes nothing and commits nothing', () => {
  const { dir, git } = gitProjectForSetup();
  applySetup(setupPlan(dir));
  const head = git('rev-parse', 'HEAD');
  const r = applySetup(setupPlan(dir));
  assert.equal(r.committed, false);
  assert.equal(git('rev-parse', 'HEAD'), head);
});

test('g11: a file with earlier uncommitted edits is written but not committed, with a warning; the rest is committed', () => {
  const { dir, git } = gitProjectForSetup();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'ignore');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ndist/\n');
  const r = applySetup(setupPlan(dir));
  assert.equal(r.committed, true, r.warning);
  assert.match(r.warning, /\.gitignore/);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /team\/work\/packs\//, 'the line is still written');
  const files = git('show', '--name-only', '--format=', 'HEAD').split(/\r?\n/);
  assert.ok(!files.includes('.gitignore'));
  assert.match(git('status', '--porcelain', '--', '.gitignore'), /\.gitignore/, 'the owner edit stays pending');
});

test('g11: outside a git repository setup applies and only warns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac setup plain '));
  const r = applySetup(setupPlan(dir));
  assert.equal(r.committed, false);
  assert.match(r.warning, /not a git repository/);
  assert.ok(fs.existsSync(path.join(dir, 'team', 'config.json')));
});

// ---- F6 (g23 follow-up) the go-path command is run ----
import { irreversibleProblems } from '../scripts/lib/irreversible.js';

const markerCommand = `${node} -e "require('fs').writeFileSync('go-ran.txt', process.cwd())"`;

test('g23 run: the Go-path command is executed in the project and the question is allowed on exit 0', () => {
  const root = irreversibleProject({ brief: goBrief(markerCommand) });
  const r = ask(root, '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(root, 'go-ran.txt')), 'the command ran');
  assert.equal(fs.realpathSync(fs.readFileSync(path.join(root, 'go-ran.txt'), 'utf8')), fs.realpathSync(root), 'it ran inside the project');
});

test('g23 run: a Go-path command that exits non-zero refuses the question and shows its output', () => {
  const failing = `${node} -e "console.log('stub runner never saw --yes'); process.exit(3)"`;
  const root = irreversibleProject({ brief: goBrief(failing) });
  const r = ask(root, '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /exited with code 3/);
  assert.match(r.stderr, /stub runner never saw --yes/);
  assert.equal(readDecisions(root).open.length, 0);
});

test('g23 run: a Go-path command that outlives the timeout refuses the question', () => {
  const root = irreversibleProject({ brief: goBrief(`${node} -e "setTimeout(() => {}, 20000)"`) });
  const problems = irreversibleProblems(root, 'T-037', { pluginRoot, timeoutMs: 500 });
  assert.match(problems.join(' '), /timed out/i);
});

test('g23 run: the old file form is refused with a message that asks for a command', () => {
  const root = irreversibleProject({ brief: '# T-037\nGo-path test: tests/go_path.rs\n' });
  const r = ask(root, '--irreversible', '--task', 'T-037');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /command/i);
  assert.match(r.stderr, /tests\/go_path\.rs/);
  assert.equal(readDecisions(root).open.length, 0);
});

test('g23 run: planner and question-protocol say Go-path test takes a command that is run', () => {
  const planner = fs.readFileSync(path.join(pluginRoot, 'agents', 'planner.md'), 'utf8');
  assert.match(planner, /Go-path test: <command>/);
  const qp = fs.readFileSync(path.join(pluginRoot, 'skills', 'question-protocol', 'SKILL.md'), 'utf8');
  assert.match(qp, /Go-path test: <command>/);
  assert.match(qp, /exits? 0/);
});

// ---- F7 deterministic git timing in the suite ----
import { cachedBlocker } from '../scripts/lib/compact.js';

test('F7: the test helpers pin git dates, identity and background maintenance, and commits get strictly increasing explicit dates', () => {
  const p = makeGitProject();
  const a = p.commit('one.txt');
  const b = p.commit('two.txt');
  const times = p.git('log', '--format=%at %ct', '--reverse').split('\n').map((l) => l.split(' ').map(Number));
  assert.equal(times.length, 2);
  assert.ok(times[1][1] > times[0][1] && times[1][0] > times[0][0], 'later commit has a later explicit date');
  assert.ok(times[0][0] < Date.UTC(2027, 0, 1) / 1000, 'dates come from the helper, not from the wall clock');
  assert.notEqual(a, b);
  assert.equal(p.git('config', 'gc.auto'), '0');
  assert.equal(p.git('config', 'maintenance.auto'), 'false');
  assert.ok(process.env.GIT_AUTHOR_DATE && process.env.GIT_COMMITTER_DATE && process.env.GIT_AUTHOR_NAME, 'child git processes of the suite inherit pinned dates and identity');
});

test('F7: every test file that runs git imports the helpers that pin the git environment', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'live' || e.name === 'fixtures' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  const missing = walk(path.join(pluginRoot, 'tests')).filter((f) => f.endsWith('.test.js'))
    .filter((f) => { const t = fs.readFileSync(f, 'utf8'); return /['"]git['"]/.test(t) && !/helpers\.js['"]/.test(t); })
    .map((f) => path.relative(pluginRoot, f));
  assert.deepEqual(missing, []);
});

test('F7: the pre-compact block cache is tested with an explicit clock, not the wall clock', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  p.git('add', 'team');
  p.git('commit', '-q', '-m', 'team');
  fs.writeFileSync(path.join(p.root, 'team', 'dirty.txt'), 'x');
  const sid = `f7-cache-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const first = cachedBlocker(sid, p.root, 1_000_000);
  assert.ok(first, 'a dirty team/ blocks');
  fs.rmSync(path.join(p.root, 'team', 'dirty.txt'));
  assert.equal(cachedBlocker(sid, p.root, 1_000_000 + 9_999), first, 'served from the cache inside the window');
  assert.equal(cachedBlocker(sid, p.root, 1_000_000 + 10_001), null, 'looked up again once the window has passed');
});
