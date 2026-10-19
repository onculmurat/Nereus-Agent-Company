import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeProject } from './helpers.js';
import { readBoard, writeBoard, addEntry, updateEntry, setPhase, rotationDue, markRotated, countFoldIn } from '../scripts/lib/board.js';
import { teamPaths } from '../scripts/lib/paths.js';

test('missing board reads as empty phase 0', () => {
  assert.deepEqual(readBoard(makeProject()), { phase: 0, entries: [] });
});

test('round-trip preserves every field', () => {
  const root = makeProject();
  const board = { phase: 3, entries: [{ id: 'T-001', title: 'Schema', owner: 'database-engineer', status: 'review', rounds: 2, model: 'opus', commits: ['abc123', 'def456'], handoff: 'team/work/handoffs/T-001.md' }] };
  writeBoard(root, board);
  assert.deepEqual(readBoard(root), board);
});

test('CRLF board parses the same', () => {
  const root = makeProject();
  addEntry(root, { title: 'A', owner: 'planner', model: 'sonnet' });
  const before = readBoard(root);
  const file = teamPaths(root).board;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  assert.deepEqual(readBoard(root), before);
});

test('addEntry numbers tasks T-001, T-002', () => {
  const root = makeProject();
  assert.equal(addEntry(root, { title: 'A', owner: 'planner', model: 'sonnet' }).id, 'T-001');
  const b = addEntry(root, { title: 'B', owner: 'planner', model: 'sonnet' });
  assert.equal(b.id, 'T-002');
  assert.equal(b.status, 'todo');
  assert.equal(b.rounds, 0);
});

test('addEntry accepts a given id and rejects bad or duplicate ids', () => {
  const root = makeProject();
  assert.equal(addEntry(root, { id: 'TH-db-choice', title: 'Thread', owner: 'architect', model: 'opus' }).id, 'TH-db-choice');
  assert.throws(() => addEntry(root, { id: '../x', title: 'x', owner: 'a', model: 'opus' }), /id/);
  assert.throws(() => addEntry(root, { id: 'TH-db-choice', title: 'x', owner: 'a', model: 'opus' }), /exists/);
});

test('updateEntry patches and rejects unknown status', () => {
  const root = makeProject();
  addEntry(root, { title: 'A', owner: 'planner', model: 'sonnet' });
  assert.equal(updateEntry(root, 'T-001', { status: 'in-progress', commits: ['a1'] }).status, 'in-progress');
  assert.deepEqual(readBoard(root).entries[0].commits, ['a1']);
  assert.throws(() => updateEntry(root, 'T-001', { status: 'finished' }), /status/);
  assert.throws(() => updateEntry(root, 'T-999', { status: 'done' }), /T-999/);
});

test('setPhase', () => {
  const root = makeProject();
  setPhase(root, 4);
  assert.equal(readBoard(root).phase, 4);
});

// Session rotation: the lead's context grows with every task, so every 5 done tasks (or a milestone end) it hands off and restarts.
function addTasks(root, n) {
  for (let i = 0; i < n; i += 1) addEntry(root, { title: `Task ${i + 1}`, owner: 'planner', model: 'sonnet' });
}
const finish = (root, n) => updateEntry(root, `T-${String(n).padStart(3, '0')}`, { status: 'done' });

test('rotation is due after the fifth task marked done since the last rotation', () => {
  const root = makeProject();
  addTasks(root, 6);
  for (let n = 1; n <= 4; n += 1) { finish(root, n); assert.equal(rotationDue(root), false, `after ${n}`); }
  finish(root, 5);
  assert.equal(rotationDue(root), true);
  assert.equal(readBoard(root).entries.length, 6, 'entries survive the counter');
});

test('only a change to done counts; repeating done or other updates do not', () => {
  const root = makeProject();
  addTasks(root, 2);
  updateEntry(root, 'T-001', { status: 'review' });
  finish(root, 1);
  finish(root, 1);
  updateEntry(root, 'T-001', { commits: ['a1'] });
  assert.equal(readBoard(root).doneSinceRotation, 1);
});

test('markRotated resets the counter and the board keeps its entries', () => {
  const root = makeProject();
  addTasks(root, 5);
  for (let n = 1; n <= 5; n += 1) finish(root, n);
  markRotated(root);
  assert.equal(rotationDue(root), false);
  assert.equal(readBoard(root).doneSinceRotation, undefined);
  assert.equal(readBoard(root).entries.length, 5);
  setPhase(root, 5);
  assert.equal(readBoard(root).phase, 5);
});

test('the counter survives setPhase and a CRLF board', () => {
  const root = makeProject();
  addTasks(root, 2);
  finish(root, 1);
  setPhase(root, 5);
  const file = teamPaths(root).board;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(readBoard(root).doneSinceRotation, 1);
});

// Spec fold-in rounds: at most 2 per review cycle, then one batched architect pass.
const foldProject = () => {
  const root = makeProject();
  addEntry(root, { id: 'T-001', title: 'Design the spec', owner: 'architect', model: 'opus' });
  return root;
};

test('countFoldIn allows two fold-in rounds, then says batch without counting further', () => {
  const root = foldProject();
  const a = countFoldIn(root, 'T-001', { foldInRounds: 2 });
  assert.deepEqual([a.action, a.foldIns, a.cap], ['fold-in', 1, 2]);
  assert.equal(countFoldIn(root, 'T-001', { foldInRounds: 2 }).action, 'fold-in');
  const third = countFoldIn(root, 'T-001', { foldInRounds: 2 });
  assert.deepEqual([third.action, third.foldIns], ['batch', 2]);
  assert.equal(countFoldIn(root, 'T-001', { foldInRounds: 2 }).foldIns, 2);
  assert.equal(readBoard(root).entries[0].foldins, 2);
});

test('countFoldIn reset starts a new review cycle, the cap is configurable and unknown entries fail', () => {
  const root = foldProject();
  countFoldIn(root, 'T-001', { foldInRounds: 1 });
  assert.equal(countFoldIn(root, 'T-001', { foldInRounds: 1 }).action, 'batch');
  const r = countFoldIn(root, 'T-001', { foldInRounds: 1, reset: true });
  assert.deepEqual([r.action, r.foldIns], ['reset', 0]);
  assert.equal(readBoard(root).entries[0].foldins, undefined);
  assert.equal(countFoldIn(root, 'T-001', { foldInRounds: 1 }).action, 'fold-in');
  assert.throws(() => countFoldIn(root, 'T-404', { foldInRounds: 2 }), /No board entry/);
});

test('an entry without fold-ins keeps the board file free of a foldins line', () => {
  const root = foldProject();
  assert.doesNotMatch(fs.readFileSync(teamPaths(root).board, 'utf8'), /foldins/);
});
