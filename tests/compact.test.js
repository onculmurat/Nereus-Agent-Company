import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeGitProject } from './helpers.js';
import { runHook, pluginRoot } from './hooks/run-hook.js';
import { addEntry, updateEntry, readBoard } from '../scripts/lib/board.js';
import { addQuestion } from '../scripts/lib/decisions.js';
import { contextTokens, compactConditions } from '../scripts/lib/compact.js';
import { planSetup } from '../scripts/lib/setup.js';
import { loadConfig, validateConfig } from '../scripts/lib/config.js';
const SC = { singleCommit: 'test fixture' };

let n = 0;
const NO_PLUGINS = { NAC_PLUGINS_DIR: path.join(os.tmpdir(), 'nac-no-plugins') };

// A clean NAC git project whose one task is done with a real commit.
function cleanProject() {
  const p = makeGitProject();
  p.commit('seed.txt');
  const e = addEntry(p.root, { title: 'done task', owner: 'backend-developer', model: 'sonnet' });
  const sha = p.commit('work.txt');
  updateEntry(p.root, e.id, { status: 'done', commits: [sha] }, SC);
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'board');
  return p;
}
const commitAll = (p, msg = 'x') => { p.git('add', '-A'); p.git('commit', '-q', '-m', msg); };

function transcript(tokens) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac tr ')), 't.jsonl');
  const usage = { input_tokens: 10, cache_read_input_tokens: tokens - 30, cache_creation_input_tokens: 20, output_tokens: 99 };
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }], usage } }),
    JSON.stringify({ type: 'user', message: { content: 'next' } }),
  ].join('\n'));
  return file;
}
const pre = (p, tokens, extra = {}) => runHook('pre-compact', { hook_event_name: 'PreCompact', session_id: `s${++n}-${process.pid}-${Date.now()}`, cwd: p.root, trigger: 'auto', transcript_path: transcript(tokens), ...extra });
const handoffs = (root) => { try { return fs.readdirSync(path.join(root, 'team', 'work', 'handoffs')).filter((f) => f.startsWith('compact-')); } catch { return []; } };

test('contextTokens sums input, cache read and cache creation of the last assistant message', () => {
  assert.equal(contextTokens(transcript(123456)), 123456);
  assert.equal(contextTokens('/no/such/file'), null);
});

test('all conditions met: auto compaction is allowed and a handoff is written', () => {
  const p = cleanProject();
  const r = pre(p, 150000);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(handoffs(p.root).length, 1);
  const text = fs.readFileSync(path.join(p.root, 'team', 'work', 'handoffs', handoffs(p.root)[0]), 'utf8');
  assert.match(text, /Phase: 0/);
  assert.match(text, /decisions\.md/);
});

test('the handoff itself does not make the next check block', () => {
  const p = cleanProject();
  assert.equal(pre(p, 150000).status, 0);
  assert.equal(pre(p, 150000).status, 0);
});

test('an in-flight task without a hand-off file blocks (g25)', () => {
  const p = cleanProject();
  const e = addEntry(p.root, { title: 'wip', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, e.id, { status: 'in-progress' });
  commitAll(p);
  const r = pre(p, 150000);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(e.id));
  assert.match(r.stderr, /hand-off/);
  assert.equal(handoffs(p.root).length, 0);
});

test('a dirty team/ state blocks; an ignored file and a developer file elsewhere do not', () => {
  const p = cleanProject();
  fs.writeFileSync(path.join(p.root, '.gitignore'), 'junk.txt\n');
  commitAll(p);
  fs.writeFileSync(path.join(p.root, 'junk.txt'), 'x');
  fs.writeFileSync(path.join(p.root, 'work.txt'), 'changed by a developer');
  assert.equal(pre(p, 150000).status, 0);
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'note.md'), 'x');
  const r = pre(p, 150000);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /uncommitted/);
});

test('the last done task without a reachable commit blocks', () => {
  const p = cleanProject();
  const e = addEntry(p.root, { title: 'nocommit', owner: 'backend-developer', model: 'sonnet' });
  updateEntry(p.root, e.id, { status: 'done' }, SC);
  commitAll(p);
  const r = pre(p, 150000);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /commit/);
});

test('a pending owner question blocks; a deferred one does not (g25)', () => {
  const p = cleanProject();
  addQuestion(p.root, { title: 'q?', source: 's', status: 'st', impact: 'i', blocking: 'no', defer: true });
  commitAll(p);
  assert.equal(pre(p, 150000).status, 0);
  const p2 = cleanProject();
  addQuestion(p2.root, { title: 'q?', source: 's', status: 'st', impact: 'i', blocking: 'no' });
  commitAll(p2);
  const r = pre(p2, 150000);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /question/);
});

test('an open question whose task is done is soft, not hard (g95)', () => {
  const p = cleanProject();
  const done = readBoard(p.root).entries.find((e) => e.status === 'done').id;
  addQuestion(p.root, { title: 'q?', source: 's', status: 'st', impact: 'i', blocking: 'yes', task: done });
  commitAll(p);
  const c = compactConditions(p.root);
  assert.deepEqual(c.hard, []);
  assert.match(c.soft.join(' '), new RegExp(`${done} is done`));
  const p2 = cleanProject();
  const open = addEntry(p2.root, { title: 'open task', owner: 'backend-developer', model: 'sonnet' });
  addQuestion(p2.root, { title: 'q?', source: 's', status: 'st', impact: 'i', blocking: 'yes', task: open.id });
  commitAll(p2);
  assert.match(compactConditions(p2.root).hard.join(' '), /not answered yet/);
});

test('at or above the ceiling compaction is allowed even when conditions fail', () => {
  const p = cleanProject();
  fs.writeFileSync(path.join(p.root, 'team', 'dirty.txt'), 'x');
  assert.equal(pre(p, 150000).status, 2);
  assert.equal(pre(p, 220000).status, 0);
});

test('the ceiling comes from team/config.json compaction.ceiling', () => {
  const p = cleanProject();
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), JSON.stringify({ compaction: { ceiling: 200000 } }));
  commitAll(p);
  fs.writeFileSync(path.join(p.root, 'team', 'dirty.txt'), 'x');
  assert.equal(pre(p, 190000).status, 2);
  assert.equal(pre(p, 210000).status, 0);
});

test('manual compaction is always allowed', () => {
  const p = cleanProject();
  fs.writeFileSync(path.join(p.root, 'team', 'dirty.txt'), 'x');
  assert.equal(pre(p, 150000, { trigger: 'manual' }).status, 0);
});

test('a teammate session and a non-NAC folder are not touched', () => {
  const p = cleanProject();
  fs.writeFileSync(path.join(p.root, 'dirty.txt'), 'x');
  assert.equal(pre(p, 150000, { agent_id: 'a1' }).status, 0);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain '));
  assert.equal(runHook('pre-compact', { trigger: 'auto', cwd: plain, session_id: 'x' }).status, 0);
});

test('any error allows: unreadable transcript, garbage input, broken config', () => {
  const p = cleanProject();
  fs.writeFileSync(path.join(p.root, 'dirty.txt'), 'x');
  assert.equal(pre(p, 1, { transcript_path: '/no/such/file' }).status, 0);
  assert.equal(runHook('pre-compact', 'not json').status, 0);
  assert.equal(runHook('pre-compact', '').status, 0);
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), '{ broken');
  assert.equal(pre(p, 150000).status, 0);
});

test('setup writes autoCompactWindow and idleCompaction false without clobbering existing keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac set '));
  const config = loadConfig({ pluginRoot, userConfigPath: path.join(dir, 'none.json') });
  let plan = planSetup(dir, { pluginRoot, config });
  assert.equal(plan.settings.after.autoCompactWindow, 200000);
  assert.equal(plan.settings.after.idleCompaction, false);
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 150000, idleCompaction: true, other: 1 }));
  plan = planSetup(dir, { pluginRoot, config });
  assert.equal(plan.settings.after.autoCompactWindow, 150000);
  assert.equal(plan.settings.after.idleCompaction, true);
  assert.equal(plan.settings.after.other, 1);
  assert.deepEqual(plan.settings.conflicts, []);
});

test('setup.js --compaction writes only those two keys; --dry-run writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac cmp '));
  const run = (...a) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'setup.js'), '--project', dir, ...a], { encoding: 'utf8' });
  assert.match(run('--compaction', '--dry-run').stdout, /autoCompactWindow/);
  assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
  assert.equal(run('--compaction').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')), { autoCompactWindow: 200000, idleCompaction: false });
});

test('config validates compaction values', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: path.join(os.tmpdir(), 'none.json') });
  validateConfig(base);
  assert.throws(() => validateConfig({ ...base, compaction: { autoCompactWindow: 50000, ceiling: 300000 } }), /autoCompactWindow/);
  assert.throws(() => validateConfig({ ...base, compaction: { autoCompactWindow: 200000, ceiling: 'x' } }), /ceiling/);
});

test('session-start after compaction points to the latest compact handoff; a plain startup does not', () => {
  const p = cleanProject();
  pre(p, 150000);
  const name = handoffs(p.root)[0];
  const ctxOf = (source) => JSON.parse(runHook('session-start', { hook_event_name: 'SessionStart', source, session_id: 'c', cwd: p.root }, { env: NO_PLUGINS }).stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctxOf('compact').includes(`team/work/handoffs/${name}`));
  assert.ok(!ctxOf('startup').includes('Compact hand-off'));
});

test('session-start hints --compaction only once the guard block is there and the setting is missing', () => {
  const p = cleanProject();
  const ctxOf = () => JSON.parse(runHook('session-start', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'h', cwd: p.root }, { env: NO_PLUGINS }).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctxOf(), /--compaction/);
  fs.writeFileSync(path.join(p.root, 'CLAUDE.md'), '<!-- nac:guard:start -->\nx\n<!-- nac:guard:end -->\n');
  assert.match(ctxOf(), /! node .*--compaction/);
  fs.mkdirSync(path.join(p.root, '.claude'));
  fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), '{"autoCompactWindow":200000}');
  assert.doesNotMatch(ctxOf(), /--compaction/);
});
