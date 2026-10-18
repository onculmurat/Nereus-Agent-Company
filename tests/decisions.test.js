import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeProject } from './helpers.js';
import { readDecisions, addQuestion, decide, isThreadDecided } from '../scripts/lib/decisions.js';
import { teamPaths } from '../scripts/lib/paths.js';

const q = { title: 'Which DB?', source: 'architect, design review', status: 'no code yet', impact: 'schema', blocking: 'yes', thread: 'db-choice' };

test('missing file reads empty', () => {
  assert.deepEqual(readDecisions(makeProject()), { open: [], decided: [] });
});

test('addQuestion then decide moves it to Decided', () => {
  const root = makeProject();
  assert.equal(addQuestion(root, q).id, 'Q-001');
  assert.equal(isThreadDecided(root, 'db-choice'), false);
  const d = decide(root, 'Q-001', { answer: 'PostgreSQL', link: 'docs/spec.md' });
  assert.equal(d.id, 'D-001');
  assert.equal(d.question, 'Q-001');
  assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
  const all = readDecisions(root);
  assert.equal(all.open.length, 0);
  assert.equal(all.decided[0].answer, 'PostgreSQL');
  assert.equal(all.decided[0].thread, 'db-choice');
  assert.equal(isThreadDecided(root, 'db-choice'), true);
});

test('question ids keep counting after a decision', () => {
  const root = makeProject();
  addQuestion(root, q);
  decide(root, 'Q-001', { answer: 'x' });
  assert.equal(addQuestion(root, { ...q, thread: 'other' }).id, 'Q-002');
});

test('CRLF decisions file parses', () => {
  const root = makeProject();
  addQuestion(root, q);
  const file = teamPaths(root).decisions;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(readDecisions(root).open[0].impact, 'schema');
});

test('decide rejects an unknown question', () => {
  assert.throws(() => decide(makeProject(), 'Q-404', { answer: 'x' }), /Q-404/);
});
