// 1.3.31: g70, a push named as a condition and a file- compound sent a test question to the owner; g67, a separate
// git call after each note and decide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ownerOnlyMatch, proxyDecideProblem } from '../scripts/lib/proxy.js';
import { addEntry } from '../scripts/lib/board.js';
import { addQuestion } from '../scripts/lib/decisions.js';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';

const run = (script, args, root) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8' });

const config = { ownerProxy: { session: 'agent-team-4e' } };

// Seen live (Memory Agent Q-189): the proxy answer "d" was refused twice, on "drop the 3 file-symlink tests" and on
// "(CI runs only after an owner push)"; T-099 waited for the owner's own confirmation.
test('g70: a push as a condition or CI trigger and a file- compound do not make a question owner-only', () => {
  const q189 = {
    title: 'T-099 Windows file-symlink tests: symlink privilege missing (os error 1314)',
    source: 'T-099 developer; the unix symlink routes are covered once linux CI runs cargo test (CI runs only after an owner push)',
    impact: 'c: drop the 3 file-symlink tests on Windows and keep the junction test. d: hard-link tests, keep the 3 tests with an os error 1314 check, add cargo test to the linux CI job.',
  };
  assert.equal(proxyDecideProblem(config, q189), undefined);
  for (const text of ['before any v* tag push', 'until the owner push', 'add an event_name==push guard', 'on push events', 'remove the file-level lint']) {
    assert.equal(ownerOnlyMatch(text), null, text);
  }
});

test('g70: the owner-only actions still match', () => {
  for (const text of ['push the branch to origin', 'Shall I push now?', 'drop the 3 files', 'delete the backup files', 'merge after the owner push', 'remove the data folder']) {
    assert.ok(ownerOnlyMatch(text), text);
  }
});

// Seen live (Memory Agent T-060..T-064, g67): most task.js note and decisions.js decide calls were followed by a
// separate git commit call; each call is a lead turn that re-reads the whole context.
test('g67: task.js note and decisions.js decide commit team/ in the same call with --chore', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  addEntry(p.root, { id: 'T-001', title: 'first', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  addQuestion(p.root, { title: 'Which way', source: 's', status: 'st', impact: 'i', blocking: 'no', thread: 'way', options: 'a|b', recommend: 'a' });
  assert.equal(run('task.js', ['start', 'T-001'], p.root).status, 0);
  const note = run('task.js', ['note', 'T-001', '--heading', 'Gate', '--text', 'green', '--chore'], p.root);
  assert.equal(note.status, 0, note.stderr);
  assert.match(JSON.parse(note.stdout).commit, /^[0-9a-f]{7,}$/);
  const git = (...a) => execFileSync('git', a, { cwd: p.root, encoding: 'utf8' }).trim();
  assert.equal(git('log', '-1', '--format=%s'), 'chore(team): T-001 note: Gate');
  const decided = run('decisions.js', ['decide', 'Q-001', '--answer', 'a', '--chore'], p.root);
  assert.equal(decided.status, 0, decided.stderr);
  assert.equal(git('log', '-1', '--format=%s'), 'chore(team): Q-001 decided');
  assert.equal(git('status', '--porcelain', '--', 'team'), '');
  const plain = run('task.js', ['note', 'T-001', '--text', 'no commit'], p.root);
  assert.equal(JSON.parse(plain.stdout).commit, undefined);
  assert.notEqual(git('status', '--porcelain', '--', 'team'), '');
});

// Seen live (Memory Agent, g67): Claude Code puts a skill back after a compaction cut at 20000 characters; task-loop had
// 27085, so the sections at its end (Never, Review round cap, Turn budget, Lessons) were gone after every compaction.
test('g67: task-loop SKILL.md fits the 20000-character reload and keeps every section in it', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.ok(skill.length < 18000, `SKILL.md is ${skill.length} characters`);
  for (const h of ['## Never', '## Review round cap', '## Turn budget', '## Role rule', '## Automation first', '## For each board entry', '## Findings and hardening', '## Resuming a task', '## Session rotation', '## Parallel tasks', '## Lessons']) {
    assert.ok(skill.includes(h), h);
  }
  assert.match(skill, /reference\.md/);
  assert.ok(fs.existsSync(path.join(pluginRoot, 'skills', 'task-loop', 'reference.md')));
});

// Seen live (Memory Agent T-099, g71): the lead ran gate.js as a background shell; Claude Code stopped it under memory
// pressure while the lead waited, and the round's gate result was lost.
test('g71: task-loop tells the lead to run the gate in the foreground', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(skill, /gate[^\n]*in the foreground[^\n]*600000[^\n]*never as a background shell/);
});

// Seen live (Memory Agent T-099, T-100, T-074, g75): a whole task in one dispatch ran into the turn budget in the middle
// of a step; the half-done work stayed uncommitted and the next dispatch spent turns finding where it stood.
test('g75: task-loop plans one step per dispatch for an L task', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(skill, /Size L \(g75\): plan one step \(one commit\) per dispatch from the start/);
  assert.ok(skill.length < 18000);
});
