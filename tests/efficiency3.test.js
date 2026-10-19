// Batch 3: process rules from the Memory Agent watch (help flags, local dates, commit verification, ...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, makeGitProject } from './helpers.js';
import { addEntry, updateEntry, incrementRound } from '../scripts/lib/board.js';
import { addQuestion, decide, recordOutcome } from '../scripts/lib/decisions.js';
import { localDate } from '../scripts/lib/dates.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(pluginRoot, 'scripts');
const board = (root, ...args) => spawnSync(process.execPath, [path.join(scripts, 'board.js'), ...args, '--project', root], { encoding: 'utf8' });

// 7. --help
test('every CLI script prints usage and exits 0 for --help, even outside a NAC project', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nac help '));
  const names = fs.readdirSync(scripts).filter((f) => f.endsWith('.js'));
  for (const expected of ['board', 'decisions', 'mailbox', 'summary', 'cleanup', 'gate', 'pack', 'cost', 'worktree', 'setup', 'clone', 'research-check']) {
    assert.ok(names.includes(`${expected}.js`), `${expected}.js missing`);
  }
  for (const name of names) {
    const r = spawnSync(process.execPath, [path.join(scripts, name), '--help'], { cwd: outside, encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.match(r.stdout, /^Usage:/m, name);
    assert.equal(r.stderr, '', name);
  }
});

// 6. local dates
test('localDate formats the local calendar day, not the UTC day', () => {
  assert.equal(localDate(new Date(2026, 9, 18, 0, 30)), '2026-10-18');
  assert.equal(localDate(new Date(2026, 9, 18, 23, 30)), '2026-10-18');
  assert.equal(localDate(new Date(2026, 0, 5, 12, 0)), '2026-01-05');
});

test('decisions are dated with the local day just after and just before midnight', () => {
  for (const [now, day] of [[new Date(2026, 9, 18, 0, 30), '2026-10-18'], [new Date(2026, 9, 18, 23, 30), '2026-10-18']]) {
    const root = makeProject();
    addQuestion(root, { title: 'Q', source: 's', status: 'st', impact: 'i', blocking: 'no', thread: 'q' });
    assert.equal(decide(root, 'Q-001', { answer: 'go', now }).date, day);
    assert.equal(recordOutcome(root, { thread: 't', outcome: 'done', now }).date, day);
  }
});

test('an escalation file is dated with the local day', () => {
  const root = makeProject();
  addEntry(root, { title: 'T', owner: 'backend-developer', model: 'sonnet' });
  const config = { escalation: { modelRounds: 1, authorityRounds: 1, leadRounds: 1 }, modelLadder: ['haiku', 'sonnet', 'opus'], models: { 'team-lead': 'opus' } };
  const now = new Date(2026, 9, 18, 0, 30);
  incrementRound(root, 'T-001', config, { now });
  incrementRound(root, 'T-001', config, { now });
  const files = fs.readdirSync(path.join(root, 'team', 'work', 'escalations'));
  assert.ok(files.length > 0);
  const text = fs.readFileSync(path.join(root, 'team', 'work', 'escalations', files[0]), 'utf8');
  assert.match(text, /^- date: 2026-10-18 00:30$/m);
});

// 4. commit hash verification
test('board update --commit accepts a sha reachable from HEAD and rejects the rest', () => {
  const { root, git, commit } = makeGitProject();
  const sha = commit('a.txt');
  addEntry(root, { title: 'T', owner: 'backend-developer', model: 'sonnet' });
  const ok = board(root, 'update', 'T-001', '--commit', sha);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).commits, [sha]);

  const bad = board(root, 'update', 'T-001', '--commit', 'deadbeef');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /deadbeef.*(not a commit|does not exist)/s);
  assert.match(bad.stderr, /git log -1 --format=%h/);

  git('checkout', '-q', '-b', 'side');
  const other = commit('b.txt');
  git('checkout', '-q', 'main');
  const unreachable = board(root, 'update', 'T-001', '--commit', other);
  assert.equal(unreachable.status, 1);
  assert.match(unreachable.stderr, /not reachable from HEAD/);
  assert.deepEqual(JSON.parse(board(root, 'show').stdout).entries[0].commits, [sha]);
});

test('board update --commit refuses a value that is not a plain sha and a project that is not a git repo', () => {
  const { root, commit } = makeGitProject();
  commit('a.txt');
  addEntry(root, { title: 'T', owner: 'backend-developer', model: 'sonnet' });
  for (const value of ['--all', 'HEAD~1', 'main', 'abc;ls']) {
    const r = board(root, 'update', 'T-001', `--commit=${value}`);
    assert.equal(r.status, 1, value);
    assert.match(r.stderr, /not a commit sha/, value);
  }
  const plain = makeProject();
  addEntry(plain, { title: 'T', owner: 'backend-developer', model: 'sonnet' });
  const r = board(plain, 'update', 'T-001', '--commit', 'abc1234');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /git/);
});

test('updateEntry itself stays git-free (only the CLI verifies commits)', () => {
  const root = makeProject();
  addEntry(root, { title: 'T', owner: 'backend-developer', model: 'sonnet' });
  assert.deepEqual(updateEntry(root, 'T-001', { commits: ['x'] }).commits, ['x']);
});
