// Batch 9: hardening loop, findings threshold, proportionality, security auto-tag, pack size, guard block, owner questions, source drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const cli = (script, root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const find = (root, ...a) => cli('findings.js', root, ...a);
const add = (root, text, o = {}) => find(root, 'add', '--module', o.module ?? 'auth', '--file', 'src/a.js', '--line', '3',
  '--severity', o.severity ?? 'hardening', '--class', o.cls ?? 'observed', '--task', 'T-001', '--text', text, ...(o.extra ?? []));
const withBatch = (root, n) => fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ findingsBatch: n }));

// ---- A2: findings threshold counting ----

test('A2 minor findings do not count toward the hardening threshold', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one', { severity: 'minor' });
  const r = add(root, 'two', { severity: 'minor' }).out;
  assert.equal(r.open, 2);
  assert.equal(r.counted, 0);
  assert.equal(r.hardeningDue, false);
});

test('A2 migrated findings do not count; they stay in the ledger', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one', { extra: ['--migrated'] });
  const r = add(root, 'two', { extra: ['--migrated'] }).out;
  assert.equal(r.counted, 0);
  assert.equal(r.hardeningDue, false);
  assert.equal(find(root, 'list', '--open').out.length, 2);
});

test('A2 findings from a hardening task do not count (--origin hardening)', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one', { extra: ['--origin', 'hardening'] });
  const r = add(root, 'two', { extra: ['--origin', 'hardening'] }).out;
  assert.equal(r.counted, 0);
  assert.equal(r.hardeningDue, false);
  assert.equal(find(root, 'list').out[0].origin, 'hardening');
});

test('A2 counted findings (hardening and blocker, not migrated) still trip the threshold', () => {
  const root = makeProject();
  withBatch(root, 2);
  add(root, 'one');
  const r = add(root, 'two', { severity: 'blocker' }).out;
  assert.equal(r.counted, 2);
  assert.equal(r.hardeningDue, true);
});

test('A2 --origin accepts only hardening', () => {
  const root = makeProject();
  assert.equal(add(root, 'x', { extra: ['--origin', 'other'] }).status, 1);
});

test('A2 the phase gate still lists ALL deferred findings (minor, migrated, hardening-origin included)', () => {
  const root = makeProject();
  add(root, 'm', { severity: 'minor' });
  add(root, 'g', { extra: ['--migrated'] });
  add(root, 'h', { extra: ['--origin', 'hardening'] });
  const r = cli('board.js', root, 'phase', '4');
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.deferredFindings.map((f) => f.id), ['F-001', 'F-002', 'F-003']);
});

// ---- A1: hardening loop ----

import { readBoard } from '../scripts/lib/board.js';
import { teamPaths } from '../scripts/lib/paths.js';

const board = (root, ...a) => cli('board.js', root, ...a);
const addHard = (root, module, ...extra) => board(root, 'add', '--title', `Harden ${module}`, '--owner', 'backend-developer', '--model', 'sonnet', '--module', module, '--hardening', 'yes', ...extra);

test('A1 a hardening task is stored with its phase', () => {
  const root = makeProject();
  const r = addHard(root, 'auth');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.hardening, 'yes');
  assert.equal(readBoard(root).entries[0].hardening, 'yes');
});

test('A1 --hardening needs a module', () => {
  const root = makeProject();
  const r = board(root, 'add', '--title', 't', '--owner', 'backend-developer', '--model', 'sonnet', '--hardening', 'yes');
  assert.equal(r.status, 1);
  assert.match(r.err, /--module/);
});

test('A1 a second hardening task for the same module in the same phase is refused without a recorded decision', () => {
  const root = makeProject();
  assert.equal(addHard(root, 'auth').status, 0);
  const second = addHard(root, 'auth');
  assert.equal(second.status, 1);
  assert.match(second.err, /--decision D-xxx/);
  assert.equal(addHard(root, 'db').status, 0, 'another module is fine');
  const bad = addHard(root, 'auth', '--decision', 'D-001');
  assert.equal(bad.status, 1);
  assert.match(bad.err, /no decision/i);
});

test('A1 with a recorded decision the second hardening task is allowed; a new phase resets the limit', () => {
  const root = makeProject();
  addHard(root, 'auth');
  const d = cli('decisions.js', root, 'record', '--outcome', 'Second hardening for auth approved');
  assert.equal(d.status, 0, d.err);
  const ok = addHard(root, 'auth', '--decision', d.out.id);
  assert.equal(ok.status, 0, ok.err);
  assert.equal(ok.out.hdecision, d.out.id);
  assert.equal(board(root, 'phase', '5').status, 0);
  assert.equal(addHard(root, 'auth').status, 0, 'new phase: first hardening of the module again');
});

test('A1 the pack of a hardening task states the review scope and the blocker/defer rule', () => {
  const root = makeProject();
  addHard(root, 'auth', '--id', 'T-070');
  fs.mkdirSync(teamPaths(root).tasks, { recursive: true });
  fs.writeFileSync(path.join(teamPaths(root).tasks, 'T-070.md'), '# T-070\n\nHarden auth.\n');
  const r = cli('pack.js', root, 'T-070', '--role', 'code-reviewer');
  assert.equal(r.status, 0, r.err);
  const pack = fs.readFileSync(r.out.path, 'utf8');
  assert.match(pack, /Hardening task/);
  assert.match(pack, /changed lines and their direct impact sites only/);
  assert.match(pack, /--origin hardening/);
});

test('A1 a normal task pack has no hardening note', () => {
  const root = makeProject();
  board(root, 'add', '--title', 't', '--owner', 'backend-developer', '--model', 'sonnet', '--id', 'T-001');
  fs.mkdirSync(teamPaths(root).tasks, { recursive: true });
  fs.writeFileSync(path.join(teamPaths(root).tasks, 'T-001.md'), '# T-001\n');
  const r = cli('pack.js', root, 'T-001', '--role', 'code-reviewer');
  assert.doesNotMatch(fs.readFileSync(r.out.path, 'utf8'), /Hardening task/);
});

test('A1 guidance lives in skills and agents: invariant brief, blocker rule, review scope, no lead growth', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /violated invariant/);
  assert.match(loop, /every route/);
  assert.match(loop, /--decision/);
  assert.match(loop, /--origin hardening/);
  assert.match(read('agents', 'planner.md'), /violated invariant/);
  assert.match(read('agents', 'code-reviewer.md'), /changed lines and their direct impact sites only/);
});

// ---- A3: proportionality on new-task proposals ----

const ask = (root, ...extra) => cli('decisions.js', root, 'ask', '--title', 'Add a hardening task?', '--source', 's', '--status', 'st', '--impact', 'i', '--blocking', 'no', '--thread', 'th', '--options', 'now|phase end', ...extra);

test('A3 a theoretical-only proposal with a "now" recommendation is refused', () => {
  const root = makeProject();
  const r = ask(root, '--recommend', 'now', '--finding-class', 'theoretical');
  assert.equal(r.status, 1);
  assert.match(r.err, /theoretical/);
  assert.match(r.err, /phase end/);
  assert.equal(cli('decisions.js', root, 'open').out.length, 0);
});

test('A3 a theoretical proposal recommending the phase end is accepted and stores the class', () => {
  const root = makeProject();
  const r = ask(root, '--recommend', 'phase end', '--finding-class', 'theoretical');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out['finding-class'], 'theoretical');
});

test('A3 observed and known proposals may recommend now', () => {
  const root = makeProject();
  assert.equal(ask(root, '--recommend', 'now', '--finding-class', 'observed').status, 0);
  assert.equal(ask(root, '--recommend', 'now', '--finding-class', 'known').status, 0);
});

test('A3 --finding-class must be observed, known or theoretical', () => {
  const root = makeProject();
  assert.equal(ask(root, '--recommend', 'now', '--finding-class', 'maybe').status, 1);
});

test('A3 the question-protocol skill requires the finding class on new-task questions', () => {
  const t = read('skills', 'question-protocol', 'SKILL.md');
  assert.match(t, /--finding-class/);
  assert.match(t, /theoretical/);
});

// ---- A4: security tag from threat-model references ----

const briefFor = (root, id, text) => {
  fs.mkdirSync(teamPaths(root).tasks, { recursive: true });
  fs.writeFileSync(path.join(teamPaths(root).tasks, `${id}.md`), text);
};
const addTask = (root, id, ...extra) => board(root, 'add', '--title', 't', '--owner', 'backend-developer', '--model', 'sonnet', '--id', id, ...extra);

test('A4 starting a task whose brief cites threat-model IDs tags it security: yes', () => {
  const root = makeProject();
  addTask(root, 'T-021');
  briefFor(root, 'T-021', '# T-021\n\nSpec: **5.4**; threat-model T12, M2, M6.\n');
  const r = board(root, 'update', 'T-021', '--status', 'in-progress');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.security, 'yes');
  assert.match(r.out.securityNote, /T12, M2, M6/);
  assert.equal(readBoard(root).entries[0].security, 'yes');
});

test('A4 add tags at once when the brief already exists', () => {
  const root = makeProject();
  briefFor(root, 'T-022', 'Spec: **1**; threat-model T5.\n');
  assert.equal(addTask(root, 'T-022').out.security, 'yes');
});

test('A4 a brief without threat-model IDs is left alone; an explicit tag is kept', () => {
  const root = makeProject();
  addTask(root, 'T-001');
  briefFor(root, 'T-001', '# T-001\n\nNo threats here, mentions T12 in prose only.\n');
  assert.equal(board(root, 'update', 'T-001', '--status', 'in-progress').out.security, undefined);
  addTask(root, 'T-002', '--security', 'contract');
  briefFor(root, 'T-002', 'threat-model T5\n');
  assert.equal(board(root, 'update', 'T-002', '--status', 'in-progress').out.security, 'contract');
});

test('A4 --security no in the same call is respected', () => {
  const root = makeProject();
  addTask(root, 'T-003');
  briefFor(root, 'T-003', 'threat-model T5\n');
  assert.equal(board(root, 'update', 'T-003', '--status', 'in-progress', '--security', 'no').out.security, undefined);
});

// ---- A5: pack size tolerance ----

import { makeGitProject } from './helpers.js';

function packRepo(files) {
  const { root, git } = makeGitProject();
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-1.md'), '# T-1\n\nBrief.\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const [name, size] of Object.entries(files)) fs.writeFileSync(path.join(root, name), `${'z'.repeat(size)}\n`);
  git('add', '.');
  git('commit', '-q', '-m', 'work');
  return { root, base };
}
const runPack = (root, base, limit, ...extra) => {
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ packMaxChars: limit }));
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'pack.js'), 'T-1', '--role', 'code-reviewer', '--base', base, '--project', root, ...extra], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const sizeOf = (files) => {
  const { root, base } = packRepo(files);
  return runPack(root, base, 1000000).out.chars;
};

test('A5 a pack up to 25% over packMaxChars is accepted automatically with a note', () => {
  const files = { 'src/b.js': 3000 };
  const chars = sizeOf(files);
  const limit = Math.floor(chars / 1.1);
  const { root, base } = packRepo(files);
  const r = runPack(root, base, limit);
  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /over packMaxChars by \d+%.*accepted/);
  assert.match(r.out.note, /accepted/);
});

test('A5 a pack more than 25% over first leaves test files out and names them', () => {
  const files = { 'src/b.js': 1500, 'tests/b.test.js': 6000 };
  const { root, base } = packRepo(files);
  const noTests = sizeOf({ 'src/b.js': 1500 });
  const r = runPack(root, base, Math.floor(noTests / 1.1));
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.testsLeftOut, ['tests/b.test.js']);
  const pack = fs.readFileSync(r.out.path, 'utf8');
  assert.doesNotMatch(pack, /diff --git a\/tests\/b\.test\.js/);
  assert.match(pack, /Test files left out of this pack/);
  assert.match(pack, /tests\/b\.test\.js/);
  assert.match(r.err, /left out/);
});

test('A5 still too large after leaving tests out (or no tests): stop with exit 3 as before', () => {
  const { root, base } = packRepo({ 'src/b.js': 6000, 'tests/b.test.js': 100 });
  const r = runPack(root, base, 1000);
  assert.equal(r.status, 3);
  assert.match(r.err, /over the limit of 1000/);
  const { root: r2, base: b2 } = packRepo({ 'src/b.js': 6000 });
  assert.equal(runPack(r2, b2, 1000).status, 3);
});

test('A5 task-loop documents the tolerance and the test-file step', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /25%/);
  assert.match(loop, /test files/);
});

// ---- A6: setup.js --guard-block --dry-run and the owner-run hint ----

import os from 'node:os';
import { runHook as runHookScript, fixture } from './hooks/run-hook.js';

const setupCli = (...args) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'setup.js'), ...args], { encoding: 'utf8' });

test('A6 --guard-block --dry-run prints the resulting block and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac guard '));
  const r = setupCli('--guard-block', '--dry-run', '--project', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NAC-LEAD-ACTIVE/);
  assert.match(r.stdout, /nac:guard:start/);
  assert.match(r.stdout, /would create/i);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('A6 --guard-block --dry-run on a CLAUDE.md that already has the block says nothing changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac guard '));
  setupCli('--guard-block', '--project', dir);
  const before = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  const r = setupCli('--guard-block', '--dry-run', '--project', dir);
  assert.match(r.stdout, /already up to date/i);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), before);
});

test('A6 the session-start hint tells the OWNER to run setup.js --guard-block with the ! prefix and the full path', async () => {
  const root = makeProject();
  const ctx = JSON.parse(runHookScript('session-start', await fixture('session-start-startup', { cwd: root })).stdout).hookSpecificOutput.additionalContext;
  const hint = ctx.split('\n').find((l) => l.includes('--guard-block'));
  assert.match(hint, /Owner/);
  assert.ok(hint.includes(`! node "${path.join(pluginRoot, 'scripts', 'setup.js')}" --guard-block`), hint);
});

// ---- A8: plugin source drift ----

import { pluginSourceDrift } from '../scripts/lib/drift.js';

function driftSetup({ installedSha, writeInstalled = true, git = true } = {}) {
  const src = git ? makeGitProject() : null;
  const folder = git ? src.root : fs.mkdtempSync(path.join(os.tmpdir(), 'nac src '));
  const head = git ? src.commit('f1') : null;
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), 'nac plugins '));
  if (writeInstalled) {
    fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'nac@nereus-agent-company': [{ gitCommitSha: installedSha ?? src?.git('rev-parse', 'HEAD') }] } }));
  }
  fs.writeFileSync(path.join(plugins, 'known_marketplaces.json'), JSON.stringify({ 'nereus-agent-company': { source: { source: 'directory', path: folder }, installLocation: folder } }));
  return { plugins, folder, head };
}

test('A8 no warning when the cache sha is the source HEAD', () => {
  const { plugins } = driftSetup();
  assert.equal(pluginSourceDrift({ pluginsDir: plugins }), '');
});

test('A8 a one-line warning with the fix when the source folder moved on', () => {
  const { plugins, folder, head } = driftSetup({ installedSha: 'a'.repeat(40) });
  const w = pluginSourceDrift({ pluginsDir: plugins });
  assert.ok(!w.includes('\n'), 'one line');
  assert.ok(w.includes('aaaaaaa'));
  assert.ok(w.includes(head));
  assert.ok(w.includes(folder));
  assert.match(w, /git pull/);
  assert.match(w, /\/plugin/);
});

test('A8 fail-open: missing installed_plugins.json, a source that is not a git repo, broken JSON', () => {
  assert.equal(pluginSourceDrift({ pluginsDir: driftSetup({ writeInstalled: false }).plugins }), '');
  assert.equal(pluginSourceDrift({ pluginsDir: driftSetup({ git: false, installedSha: 'b'.repeat(40) }).plugins }), '');
  const { plugins } = driftSetup();
  fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), '{ nope');
  assert.equal(pluginSourceDrift({ pluginsDir: plugins }), '');
  assert.equal(pluginSourceDrift({ pluginsDir: path.join(os.tmpdir(), 'nac-no-such-dir') }), '');
});

test('A8 session-start prints the warning for the lead only', async () => {
  const { plugins } = driftSetup({ installedSha: 'c'.repeat(40) });
  const root = makeProject();
  const payload = await fixture('session-start-startup', { cwd: root });
  const ctx = JSON.parse(runHookScript('session-start', payload, { env: { NAC_PLUGINS_DIR: plugins } }).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /NAC plugin drift/);
  const mate = JSON.parse(runHookScript('session-start', { ...payload, agent_type: 'planner', agent_id: 'x' }, { env: { NAC_PLUGINS_DIR: plugins } }).stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(mate, /drift/);
});

// ---- A7: plain-text owner questions ----

import { askedWithoutRecommendation } from '../scripts/lib/owner-question.js';

test('A7 a final message ending in a question without a recommendation is flagged', () => {
  assert.equal(askedWithoutRecommendation('T-070 is done. Should I start T-071?'), true);
  assert.equal(askedWithoutRecommendation('Devam edeyim mi?\n\n'), true);
  assert.equal(askedWithoutRecommendation('Proceed? **yes / no?**'), true);
  assert.equal(askedWithoutRecommendation('Evet / hayır?'), true);
});

test('A7 a recommendation marker, a statement, or an empty message is not flagged', () => {
  assert.equal(askedWithoutRecommendation('Options: a) now b) later. I recommend a. Which one?'), false);
  assert.equal(askedWithoutRecommendation('Seçenekler a / b. Önerim a. Hangisi?'), false);
  assert.equal(askedWithoutRecommendation('Source: x\nRecommendation: b\nWhich one?'), false);
  assert.equal(askedWithoutRecommendation('Done. Tests are green.'), false);
  assert.equal(askedWithoutRecommendation('Why does this work? It does because of X.'), false);
  assert.equal(askedWithoutRecommendation(''), false);
  assert.equal(askedWithoutRecommendation(undefined), false);
});

const stopPayload = (cwd, patch = {}) => ({ session_id: 's', cwd, hook_event_name: 'Stop', stop_hook_active: false, ...patch });

test('A7 the Stop hook blocks the lead once and points at decisions.js ask', () => {
  const root = makeProject();
  const r = runHookScript('stop-question', stopPayload(root, { last_assistant_message: 'Shall I start T-071?' }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /decisions\.js/);
  assert.match(r.stderr, /recommend/i);
});

test('A7 the Stop hook lets go when a recommendation is there, when it already blocked once, for teammates and outside NAC', () => {
  const root = makeProject();
  assert.equal(runHookScript('stop-question', stopPayload(root, { last_assistant_message: 'I recommend a. Which one?' })).status, 0);
  assert.equal(runHookScript('stop-question', stopPayload(root, { last_assistant_message: 'Shall I?', stop_hook_active: true })).status, 0);
  assert.equal(runHookScript('stop-question', stopPayload(root, { last_assistant_message: 'Shall I?', agent_id: 'a1', agent_type: 'planner' })).status, 0);
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'nac plain '));
  assert.equal(runHookScript('stop-question', stopPayload(plain, { last_assistant_message: 'Shall I?' })).status, 0);
});

test('A7 fail-open: bad stdin, no message, unreadable transcript', () => {
  const root = makeProject();
  assert.equal(runHookScript('stop-question', 'not json').status, 0);
  assert.equal(runHookScript('stop-question', stopPayload(root)).status, 0);
  assert.equal(runHookScript('stop-question', stopPayload(root, { transcript_path: path.join(root, 'missing.jsonl') })).status, 0);
});

test('A7 without last_assistant_message the hook reads the end of the transcript', () => {
  const root = makeProject();
  const file = path.join(root, 't.jsonl');
  const line = (o) => JSON.stringify(o);
  fs.writeFileSync(file, [
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Earlier statement.' }] } }),
    line({ type: 'user', message: { content: 'ok' } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'Should I merge?' }] } }),
  ].join('\n'));
  assert.equal(runHookScript('stop-question', stopPayload(root, { transcript_path: file })).status, 2);
});

test('A7 hooks.json registers the Stop hook and question-protocol says plain-text questions are not allowed', () => {
  const hooks = JSON.parse(read('hooks', 'hooks.json')).hooks;
  assert.match(hooks.Stop[0].hooks[0].command, /hooks\/stop-question\.js"$/);
  const t = read('skills', 'question-protocol', 'SKILL.md');
  assert.match(t, /plain chat/i);
  assert.match(t, /Stop hook/);
});
