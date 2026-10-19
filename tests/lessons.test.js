import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { addLesson, readLessons, sharedLessonsPath } from '../scripts/lib/lessons.js';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nac home '));
const NOW = new Date(2026, 9, 19, 0, 30);
const lesson = { trigger: 'escalation to-lead on T-004', what: 'Role looped on a flaky test', rule: 'Run the gate twice before a round', task: 'T-004' };

test('addLesson appends to the project file and the shared file under the given home', () => {
  const root = makeProject('nac lessons proj ');
  const home = tmpHome();
  addLesson(root, lesson, { home, now: NOW });
  addLesson(root, { ...lesson, task: undefined, trigger: 'owner corrected the lead' }, { home, now: NOW });
  const project = fs.readFileSync(path.join(root, 'team', 'lessons.md'), 'utf8');
  const shared = fs.readFileSync(path.join(home, '.claude', 'nac', 'lessons.md'), 'utf8');
  for (const text of [project, shared]) {
    assert.match(text, /2026-10-19/);
    assert.match(text, new RegExp(path.basename(root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, /T-004/);
    assert.match(text, /escalation to-lead on T-004/);
    assert.match(text, /Role looped on a flaky test/);
    assert.match(text, /Run the gate twice before a round/);
    assert.match(text, /owner corrected the lead/);
  }
  assert.equal(sharedLessonsPath(home), path.join(home, '.claude', 'nac', 'lessons.md'));
  assert.equal(readLessons(root).length, 2);
});

test('readLessons parses fields and filters by --since', () => {
  const root = makeProject();
  const home = tmpHome();
  addLesson(root, lesson, { home, now: new Date(2026, 9, 1, 12) });
  addLesson(root, { ...lesson, trigger: 'later one' }, { home, now: new Date(2026, 9, 19, 12) });
  const all = readLessons(root);
  assert.deepEqual(all.map((l) => l.date), ['2026-10-01', '2026-10-19']);
  assert.equal(all[0].task, 'T-004');
  assert.equal(all[0].rule, 'Run the gate twice before a round');
  assert.deepEqual(readLessons(root, { since: '2026-10-10' }).map((l) => l.trigger), ['later one']);
  assert.throws(() => readLessons(root, { since: 'yesterday' }), /YYYY-MM-DD/);
});

test('multi-line text is collapsed and cannot forge an entry heading', () => {
  const root = makeProject();
  const home = tmpHome();
  addLesson(root, { trigger: 'a\n## 2099-01-01 | evil | T-9', what: 'b\r\nc', rule: 'd' }, { home, now: NOW });
  assert.equal(readLessons(root).length, 1);
  assert.equal(readLessons(root)[0].what, 'b c');
});

test('a task id is validated and optional', () => {
  const root = makeProject();
  const home = tmpHome();
  assert.throws(() => addLesson(root, { ...lesson, task: 'bad id!' }, { home, now: NOW }), /task id/);
  addLesson(root, { ...lesson, task: undefined }, { home, now: NOW });
  assert.equal(readLessons(root)[0].task, '-');
});

test('trigger, what and rule are required', () => {
  const root = makeProject();
  for (const k of ['trigger', 'what', 'rule']) {
    assert.throws(() => addLesson(root, { ...lesson, [k]: ' ' }, { home: tmpHome(), now: NOW }), new RegExp(k));
  }
});

test('CLI add and show use HOME for the shared file and never the real one', () => {
  const root = makeProject();
  const home = tmpHome();
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const run = (...args) => spawnSync(process.execPath, [path.join(scripts, 'lessons.js'), ...args, '--project', root], { encoding: 'utf8', env });
  const a = run('add', '--trigger', 'owner corrected the lead', '--what', 'wrong phase', '--rule', 'check the board phase', '--task', 'T-002');
  assert.equal(a.status, 0, a.stderr);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'nac', 'lessons.md')));
  const s = run('show');
  assert.equal(s.status, 0, s.stderr);
  const out = JSON.parse(s.stdout);
  assert.equal(out.length, 1);
  assert.equal(out[0].task, 'T-002');
  assert.deepEqual(JSON.parse(run('show', '--since', '2999-01-01').stdout), []);
  const bad = run('add', '--trigger', 'x');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Missing --what/);
});

test('the lessons rules are in task-loop, escalation and phase-report, and the owner decides what becomes a rule', () => {
  const read = (p) => fs.readFileSync(path.join(scripts, '..', p), 'utf8');
  const loop = read('skills/task-loop/SKILL.md');
  assert.match(loop, /lessons\.js" add/);
  assert.match(loop, /repeats the same mistake/);
  assert.match(loop, /owner corrects the lead/);
  assert.match(read('skills/escalation/SKILL.md'), /to-lead[^\n]*to-owner[^\n]*lessons\.js" add|lessons\.js" add[^\n]*to-owner/);
  const report = read('skills/phase-report/SKILL.md');
  assert.match(report, /lessons\.js" show --since/);
  assert.match(report, /owner decides which[^\n]*NAC rule/);
  assert.match(report, /nothing becomes a rule automatically/);
});

test('README and README.tr document lessons.js and the shared file', () => {
  for (const f of ['README.md', 'README.tr.md']) {
    const text = fs.readFileSync(path.join(scripts, '..', f), 'utf8');
    assert.match(text, /lessons\.js/);
    assert.match(text, /team\/lessons\.md/);
    assert.match(text, /~\/\.claude\/nac\/lessons\.md/);
  }
});
