import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { makeGitProject, taskLoopText } from './helpers.js';
import { runHook, pluginRoot } from './hooks/run-hook.js';
import { addEntry, updateEntry, readBoard, recordReview } from '../scripts/lib/board.js';
import { addQuestion } from '../scripts/lib/decisions.js';
import { compactDecision } from '../scripts/lib/compact.js';
import { checkPrograms, busyProcesses, waitForIdle } from '../scripts/lib/gate.js';
import { rotationEvery } from '../scripts/lib/task.js';
import { planCompaction } from '../scripts/lib/setup.js';
import { validateConfig, loadConfig } from '../scripts/lib/config.js';
import { listFindings } from '../scripts/lib/findings.js';

const sid = () => `e15-${process.pid}-${Math.random().toString(36).slice(2)}`;
const commitAll = (p, msg = 'x') => { p.git('add', '-A'); p.git('commit', '-q', '-m', msg); };
const node = (script, args, root, env = {}) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
const json = (r) => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };

function transcript(tokens) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac e15 ')), 't.jsonl');
  const usage = { input_tokens: 10, cache_read_input_tokens: tokens - 30, cache_creation_input_tokens: 20, output_tokens: 1 };
  fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }], usage } }));
  return file;
}
const pre = (p, session, tokens) => runHook('pre-compact', { hook_event_name: 'PreCompact', session_id: session, cwd: p.root, trigger: 'auto', transcript_path: transcript(tokens) });
const compactHandoffs = (root) => { try { return fs.readdirSync(path.join(root, 'team', 'work', 'handoffs')).filter((f) => f.startsWith('compact-')); } catch { return []; } };

// A git project with one in-progress task that has no hand-off file: the T-037 state of g32.
function staleTaskProject() {
  const p = makeGitProject();
  p.commit('seed.txt');
  addEntry(p.root, { id: 'T-037', title: 'stale', owner: 'test-engineer', model: 'sonnet', code: 'no' });
  updateEntry(p.root, 'T-037', { status: 'in-progress' });
  commitAll(p, 'board');
  return p;
}

// g32: T-037 sat in progress without a hand-off for hours; every auto compaction was deferred until the 220K ceiling.
test('g32: a soft condition defers auto compaction only for softMargin tokens, then compaction runs and says why', () => {
  const p = staleTaskProject();
  const s = sid();
  const first = pre(p, s, 120000);
  assert.equal(first.status, 2);
  assert.match(first.stderr, /T-037/);
  assert.match(first.stderr, /runs anyway at 140000/);
  assert.equal(pre(p, s, 139000).status, 2, 'still inside the margin');
  assert.equal(pre(p, s, 140500).status, 0, 'past the margin: allowed');
  const [name] = compactHandoffs(p.root);
  const text = fs.readFileSync(path.join(p.root, 'team', 'work', 'handoffs', name), 'utf8');
  assert.match(text, /soft conditions/);
  assert.match(text, /T-037 in progress without a hand-off file/);
});

test('g32: an open owner question still blocks past the margin, up to the ceiling', () => {
  const p = staleTaskProject();
  addQuestion(p.root, { title: 'which', source: 's', status: 'st', impact: 'i', blocking: 'yes', thread: 'th' });
  commitAll(p, 'question');
  const s = sid();
  assert.equal(pre(p, s, 120000).status, 2);
  const r = pre(p, s, 200000);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /owner question/);
  assert.equal(pre(p, s, 220000).status, 0, 'the ceiling still wins');
});

test('g32: compactDecision takes softMargin, clears the deferral at a safe point and starts over', () => {
  const p = staleTaskProject();
  const s = sid();
  assert.ok(compactDecision(s, p.root, 100000, { softMargin: 5000, now: 1 }).block);
  assert.deepEqual(compactDecision(s, p.root, 105000, { softMargin: 5000, now: 2 }), { allow: 'deferral limit' });
  assert.ok(compactDecision(s, p.root, 106000, { softMargin: 5000, now: 3 }).block, 'a new deferral starts after a compaction');
  fs.mkdirSync(path.join(p.root, 'team', 'work', 'handoffs'), { recursive: true });
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'handoffs', 'T-037.md'), 'notes');
  commitAll(p, 'hand-off');
  assert.deepEqual(compactDecision(s, p.root, 107000, { softMargin: 5000, now: 100000 }), { allow: 'safe point' });
});

test('g32: the pre-compact hook reads compaction.softMargin from team/config.json', () => {
  const p = staleTaskProject();
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), JSON.stringify({ compaction: { autoCompactWindow: 100000, ceiling: 220000, softMargin: 1000 } }));
  commitAll(p, 'config');
  const s = sid();
  assert.equal(pre(p, s, 90000).status, 2);
  assert.equal(pre(p, s, 91000).status, 0);
});

// g31: a developer's cargo test, left in the background at its turn budget, made two gate runs of the lead red.
test('g31: checkPrograms takes program and subcommand, or the whole command when the first argument is a flag', () => {
  const programs = checkPrograms([
    { name: 'test', command: 'cargo test --workspace' },
    { name: 'clippy', command: 'RUSTFLAGS=-Dwarnings cargo clippy -- -D warnings' },
    { name: 'web', command: 'cd web && npm test' },
    { name: 'node', command: 'node --test' },
  ]);
  assert.deepEqual(programs, [
    { program: 'cargo', args: ['test'] },
    { program: 'cargo', args: ['clippy'] },
    { program: 'npm', args: ['test'] },
    { program: 'node', args: ['--test'] },
  ]);
});

test('g31: busyProcesses matches a Windows cargo test, never an unrelated run of the same program or an excluded pid', () => {
  const programs = checkPrograms([{ name: 'test', command: 'cargo test --workspace' }, { name: 'node', command: 'node --test' }]);
  const procs = [
    { pid: 1, ppid: 0, cmd: '"C:\\Users\\x\\.cargo\\bin\\cargo.exe" test --no-fail-fast' },
    { pid: 2, ppid: 0, cmd: 'cargo build --release' },
    { pid: 3, ppid: 0, cmd: '"C:\\Program Files\\nodejs\\node.exe" server.js --test' },
    { pid: 4, ppid: 0, cmd: '/usr/bin/cargo test' },
    { pid: 5, ppid: 0, cmd: '' },
  ];
  assert.deepEqual(busyProcesses(programs, procs, [4]).map((p) => p.pid), [1]);
});

test('g31: waitForIdle waits until the run ends, and reports it when it outlasts the wait', () => {
  const checks = [{ name: 'test', command: 'cargo test' }];
  const run = { pid: 99, ppid: 0, cmd: 'cargo test' };
  let t = 0;
  const lists = [[run], [run], []];
  const ended = waitForIdle(checks, { seconds: 60, pollMs: 5000, list: () => lists.shift() ?? [], sleep: (ms) => { t += ms; }, clock: () => t });
  assert.deepEqual(ended, { waited: 10, busy: [] });
  t = 0;
  const stuck = waitForIdle(checks, { seconds: 12, pollMs: 5000, list: () => [run], sleep: (ms) => { t += ms; }, clock: () => t });
  assert.equal(stuck.waited, 15);
  assert.deepEqual(stuck.busy, [{ pid: 99, cmd: 'cargo test' }]);
  assert.deepEqual(waitForIdle(checks, { seconds: 0, list: () => { throw new Error('not called'); } }), { waited: 0, busy: [] });
});

test('g31: gate.js reports a run of its check program that is still going after the wait', async () => {
  const p = makeGitProject();
  fs.writeFileSync(path.join(p.root, 'busy.js'), "if (process.argv[2] === 'hold') setTimeout(() => {}, 60000);\n");
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), JSON.stringify({ gateCommands: [{ name: 'test', command: 'node busy.js' }] }));
  const child = spawn(process.execPath, ['busy.js', 'hold'], { cwd: p.root, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    const out = json(node('gate.js', [], p.root, { NAC_GATE_WAIT_SECONDS: '1' }));
    assert.equal(out.ok, true);
    assert.ok(out.busy.some((b) => b.pid === child.pid), JSON.stringify(out.busy));
    assert.match(out.note, /may come from the load/);
  } finally {
    child.kill();
  }
  const quiet = json(node('gate.js', [], p.root, { NAC_GATE_WAIT_SECONDS: '1' }));
  assert.equal(quiet.busy, undefined);
});

test('g31/g32/g34: config checks softMargin, rotateEvery and gateWaitSeconds', () => {
  const base = loadConfig({ pluginRoot, projectRoot: makeGitProject().root });
  assert.throws(() => validateConfig({ ...base, compaction: { autoCompactWindow: 100000, ceiling: 1, softMargin: 0 } }), /softMargin/);
  assert.throws(() => validateConfig({ ...base, rotateEvery: 0 }), /rotateEvery/);
  assert.throws(() => validateConfig({ ...base, gateWaitSeconds: -1 }), /gateWaitSeconds/);
  validateConfig({ ...base, rotateEvery: 1, gateWaitSeconds: 0, compaction: { autoCompactWindow: 100000, ceiling: 1, softMargin: 1 } });
});

test('g31: every agent file says tests and builds run in the foreground', () => {
  for (const f of fs.readdirSync(path.join(pluginRoot, 'agents'))) {
    assert.match(fs.readFileSync(path.join(pluginRoot, 'agents', f), 'utf8'), /never leave one running in the background/, f);
  }
});

// g33: about a third of the lead's calls were bookkeeping. task.js start and close do each step's bookkeeping in one call.
function taskProject({ compaction = false, review = true } = {}) {
  const p = makeGitProject();
  p.commit('seed.txt');
  if (compaction) {
    fs.mkdirSync(path.join(p.root, '.claude'));
    fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 100000 }));
  }
  addEntry(p.root, { id: 'T-001', title: 'first', owner: 'backend-developer', model: 'sonnet', size: 'S', module: 'core' });
  addEntry(p.root, { id: 'T-002', title: 'second', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  if (review) for (const id of ['T-001', 'T-002']) recordReview(p.root, id, { role: 'code-reviewer', verdict: 'pass' });
  commitAll(p, 'board');
  return p;
}

test('g33: task.js start sets in-progress, writes the hand-off skeleton with the base and commits team/', () => {
  const p = taskProject();
  const base = p.git('rev-parse', '--short', 'HEAD');
  const out = json(node('task.js', ['start', 'T-001'], p.root));
  assert.equal(out.status, 'in-progress');
  assert.equal(out.title, 'first');
  assert.equal(out.base, base);
  assert.equal(out.handoff, 'team/work/handoffs/T-001.md');
  assert.match(fs.readFileSync(path.join(p.root, out.handoff), 'utf8'), new RegExp(`Base: ${base}`));
  assert.equal(readBoard(p.root).entries.find((e) => e.id === 'T-001').handoff, out.handoff);
  assert.equal(out.commit.committed, true);
  assert.equal(p.git('log', '-1', '--format=%s'), 'chore(team): T-001 start');
  assert.equal(p.git('status', '--porcelain', '--', 'team'), '');
});

test('g33: a refused start leaves no hand-off file behind', () => {
  const p = taskProject();
  json(node('task.js', ['start', 'T-001'], p.root));
  const r = node('task.js', ['start', 'T-002'], p.root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /worktree/);
  assert.equal(fs.existsSync(path.join(p.root, 'team', 'work', 'handoffs', 'T-002.md')), false);
});

test('g33: task.js note appends a section to the hand-off', () => {
  const p = taskProject();
  json(node('task.js', ['start', 'T-001'], p.root));
  json(node('task.js', ['note', 'T-001', '--heading', 'Gate', '--text', 'green, 12 passed'], p.root));
  assert.match(fs.readFileSync(path.join(p.root, 'team', 'work', 'handoffs', 'T-001.md'), 'utf8'), /### Gate\n\ngreen, 12 passed\n$/);
});

test('g33: task.js close records findings, done, cost and commits team/ in one call; no rotation with /clear before 5', () => {
  const p = taskProject();
  json(node('task.js', ['start', 'T-001'], p.root));
  const sha = p.commit('code.txt');
  fs.writeFileSync(path.join(p.root, 'f.json'), JSON.stringify([{ module: 'core', file: 'code.txt', line: 1, severity: 'hardening', class: 'observed', text: 'one' }]));
  const out = json(node('task.js', ['close', 'T-001', '--commit', sha, '--findings', 'f.json'], p.root));
  assert.equal(out.status, 'done');
  assert.deepEqual(out.commits, [sha]);
  assert.equal(out.findings.length, 1);
  assert.equal(listFindings(p.root, { open: true })[0].task, 'T-001');
  assert.equal(out.rotate, false);
  assert.equal(p.git('log', '-1', '--format=%s'), 'chore(team): T-001 done');
  assert.equal(p.git('status', '--porcelain', '--', 'team'), '');
});

// g59: T-051 closed with its code review passed but never recorded; a review asking for changes would close the same way.
test('g59: close refuses a code task without a code-reviewer pass and names the command; a fail is not a pass', () => {
  const p = taskProject({ review: false });
  json(node('task.js', ['start', 'T-001'], p.root));
  const sha = p.commit('code.txt');
  const r = node('task.js', ['close', 'T-001', '--commit', sha], p.root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /T-001 is a code task and has no code-reviewer pass. .*board.js review T-001 --role code-reviewer --verdict pass/);
  assert.equal(readBoard(p.root).entries.find((e) => e.id === 'T-001').status, 'in-progress');
  recordReview(p.root, 'T-001', { role: 'code-reviewer', verdict: 'fail' });
  assert.match(node('task.js', ['close', 'T-001', '--commit', sha], p.root).stderr, /(latest verdict: fail)/);
  recordReview(p.root, 'T-001', { role: 'code-reviewer', verdict: 'pass' });
  assert.equal(json(node('task.js', ['close', 'T-001', '--commit', sha], p.root)).status, 'done');
});

test('g59: a code: no task and a task owned by a non-code role close without a code review', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  addEntry(p.root, { id: 'T-001', title: 'spike', owner: 'backend-developer', model: 'sonnet', size: 'S', code: 'no' });
  addEntry(p.root, { id: 'T-002', title: 'plan', owner: 'planner', model: 'sonnet', size: 'S' });
  commitAll(p, 'board');
  for (const id of ['T-001', 'T-002']) {
    json(node('task.js', ['start', id], p.root));
    const sha = p.commit(`${id}.txt`);
    assert.equal(json(node('task.js', ['close', id, '--commit', sha], p.root)).status, 'done', id);
  }
});

test('g33: a malformed finding stops close before anything is recorded', () => {
  const p = taskProject();
  json(node('task.js', ['start', 'T-001'], p.root));
  const sha = p.commit('code.txt');
  fs.writeFileSync(path.join(p.root, 'f.json'), JSON.stringify([{ module: 'core', text: 'no file' }]));
  const r = node('task.js', ['close', 'T-001', '--commit', sha, '--findings', 'f.json'], p.root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lacks file, line, severity, class/);
  assert.equal(readBoard(p.root).entries.find((e) => e.id === 'T-001').status, 'in-progress');
  assert.deepEqual(listFindings(p.root), []);
});

test('g35: a finding with a bad value (a directory address) also stops close before done', () => {
  const p = taskProject();
  json(node('task.js', ['start', 'T-001'], p.root));
  const sha = p.commit('code.txt');
  fs.mkdirSync(path.join(p.root, 'src'));
  fs.writeFileSync(path.join(p.root, 'f.json'), JSON.stringify([{ module: 'core', file: 'src', line: 1, severity: 'hardening', class: 'observed', text: 'dir' }]));
  const r = node('task.js', ['close', 'T-001', '--commit', sha, '--findings', 'f.json'], p.root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /finding 1 in --findings: --file "src" is a directory/);
  assert.equal(readBoard(p.root).entries.find((e) => e.id === 'T-001').status, 'in-progress');
  assert.deepEqual(listFindings(p.root), []);
});

// g34: with compaction the lead rotates after every task: close writes the lead hand-off and resets the counter.
test('g34: with compaction, close writes the lead hand-off with the lead note and resets the counter', () => {
  const p = taskProject({ compaction: true });
  json(node('task.js', ['start', 'T-001'], p.root));
  const sha = p.commit('code.txt');
  const out = json(node('task.js', ['close', 'T-001', '--commit', sha, '--lead-note', 'risk: flaky timing test F-260'], p.root));
  assert.equal(out.rotate, true);
  assert.equal(out.rotateBy, 'compaction');
  const text = fs.readFileSync(path.join(p.root, out.leadHandoff), 'utf8');
  assert.match(text, /after T-001/);
  assert.match(text, /risk: flaky timing test F-260/);
  assert.match(text, /T-002/);
  assert.equal(readBoard(p.root).doneSinceRotation, undefined);
  assert.equal(p.git('log', '-1', '--format=%s'), 'chore(team): T-001 done, lead hand-off');
  assert.equal(p.git('status', '--porcelain', '--', 'team'), '');
});

test('g34: rotationEvery is 1 with compaction, 5 with /clear, and rotateEvery in the config wins', () => {
  const clear = taskProject();
  const comp = taskProject({ compaction: true });
  assert.equal(rotationEvery(clear.root, {}), 5);
  assert.equal(rotationEvery(comp.root, {}), 1);
  assert.equal(rotationEvery(comp.root, { rotateEvery: 3 }), 3);
  updateEntry(comp.root, 'T-002', { status: 'in-progress' });
  const r = json(node('board.js', ['update', 'T-002', '--status', 'done'], comp.root));
  assert.equal(r.rotate, true);
});

test('g34: setup --compaction --window replaces autoCompactWindow and refuses less than 100000', () => {
  const p = taskProject();
  fs.mkdirSync(path.join(p.root, '.claude'));
  fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 200000 }));
  assert.equal(planCompaction(p.root, { window: 100000 }).after.autoCompactWindow, 100000);
  assert.equal(planCompaction(p.root, {}).after.autoCompactWindow, 200000);
  assert.throws(() => planCompaction(p.root, { window: 50000 }), /at least 100000/);
});

test('g33/g34: the task-loop skill uses task.js start and close and rotates every task with compaction', () => {
  const skill = taskLoopText();
  assert.match(skill, /task\.js" start <id>/);
  assert.match(skill, /task\.js" close <id>/);
  assert.match(skill, /task\.js" note <id>/);
  assert.match(skill, /every task/);
});
