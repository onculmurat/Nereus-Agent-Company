// Batch 4: research roles stay out of the build phase, team/work/ is committed except packs, lessons capture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, taskLoopText } from './helpers.js';
import { addEntry, updateEntry, setPhase, readBoard } from '../scripts/lib/board.js';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const run = (script, root, ...args) => spawnSync(process.execPath, [path.join(scripts, script), ...args, '--project', root], { encoding: 'utf8' });
const RESEARCH = ['researcher', 'research-reviewer', 'finance-analyst'];

test('research roles cannot own board tasks from phase 4 on', () => {
  for (const phase of [4, 5]) {
    const root = makeProject();
    setPhase(root, phase);
    for (const role of [...RESEARCH, 'nac:researcher']) {
      assert.throws(() => addEntry(root, { title: 'Spike', owner: role, model: 'sonnet' }), /not allowed from phase 4/);
    }
    const ok = addEntry(root, { title: 'Spike', owner: 'test-engineer', model: 'sonnet' });
    for (const role of RESEARCH) assert.throws(() => updateEntry(root, ok.id, { owner: role }), /not allowed from phase 4/);
    assert.equal(readBoard(root).entries[0].owner, 'test-engineer');
  }
});

test('research roles can still own tasks in phase 1', () => {
  const root = makeProject();
  setPhase(root, 1);
  for (const role of RESEARCH) assert.equal(addEntry(root, { title: role, owner: role, model: 'sonnet' }).owner, role);
});

test('the error names the roles a build-phase spike may go to', () => {
  const root = makeProject();
  setPhase(root, 4);
  assert.throws(() => addEntry(root, { title: 'x', owner: 'researcher', model: 'sonnet' }), /backend-developer.*test-engineer/s);
});

test('board.js add and update reject a research owner in phase 4 (CLI)', () => {
  const root = makeProject();
  setPhase(root, 4);
  const r = run('board.js', root, 'add', '--title', 'x', '--owner', 'researcher', '--model', 'sonnet');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not allowed from phase 4/);
  run('board.js', root, 'add', '--title', 'x', '--owner', 'test-engineer', '--model', 'sonnet');
  const u = run('board.js', root, 'update', 'T-001', '--owner', 'finance-analyst');
  assert.notEqual(u.status, 0);
  assert.match(u.stderr, /not allowed from phase 4/);
});

test('research agents no longer point at an assignment file for build-phase research', () => {
  for (const r of RESEARCH) {
    const text = fs.readFileSync(new URL(`../agents/${r}.md`, import.meta.url), 'utf8');
    assert.match(text, /Your pack is your assignment: the lead's prompt, so the guard below never blocks it\./);
  }
});

test('the planner is told to keep research roles out of the build phase', () => {
  const text = fs.readFileSync(new URL('../agents/planner.md', import.meta.url), 'utf8');
  assert.match(text, /Never give a build-phase task \(phase 4 or 5\) to `researcher`, `research-reviewer` or `finance-analyst`/);
});

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('task-loop commits team/work changes as chore(team) after each done task and at rotation, never with code', () => {
  const loop = taskLoopText();
  const done = loop.split('## Session rotation')[0];
  assert.match(done, /9\. \*\*Commit the team state\.\*\*[^\n]*`chore\(team\): [^`]*`[^\n]*explicit paths[^\n]*never[^\n]*code commit/);
  const rotation = loop.split('## Session rotation')[1].split('## Parallel tasks')[0];
  assert.match(rotation, /chore\(team\)[^\n]*explicit paths/);
  assert.match(read('prompts/lead.md'), /chore\(team\)/);
});

test('README and README.tr say team/work/ is committed except packs', () => {
  for (const f of ['README.md', 'README.tr.md']) {
    const text = read(f);
    assert.match(text, /team\/work\/packs\//);
    assert.doesNotMatch(text, /`team\/work\/` is git-ignored/);
    assert.doesNotMatch(text, /hand-offs, escalations, mailbox, archive; git-ignored/);
    assert.match(text, /chore\(team\)/);
  }
});
