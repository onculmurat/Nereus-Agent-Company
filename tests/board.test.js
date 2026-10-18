import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeProject } from './helpers.js';
import { readBoard, writeBoard, addEntry, updateEntry, setPhase } from '../scripts/lib/board.js';
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
