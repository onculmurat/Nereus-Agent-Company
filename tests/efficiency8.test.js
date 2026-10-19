// Batch 8: question shape, NAC-less session detection, guard blind spots, guard variable resolution.
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
const base = ['--title', 'Which', '--source', 's', '--status', 'st', '--impact', 'i', '--blocking', 'no', '--thread', 'which'];
const ask = (root, ...extra) => cli('decisions.js', root, 'ask', ...base, ...extra);

// Item 1: options and a recommendation are required.
test('ask refuses a question without options', () => {
  const r = ask(makeProject(), '--recommend', 'a');
  assert.notEqual(r.status, 0);
  assert.match(r.err, /--options/);
});

test('ask refuses fewer than 2 options', () => {
  const r = ask(makeProject(), '--options', 'a', '--recommend', 'a');
  assert.notEqual(r.status, 0);
  assert.match(r.err, /at least 2/);
});

test('ask refuses a missing or unknown recommendation, deferred or not', () => {
  const root = makeProject();
  assert.match(ask(root, '--options', 'a|b').err, /--recommend/);
  assert.match(ask(root, '--options', 'a|b', '--recommend', 'c', '--defer', '--task', 'T-001').err, /one of the options/);
  assert.equal(ask(root, '--options', 'a|b', '--recommend', 'b').status, 0);
});

test('question-protocol says every question goes through decisions.js ask with options and a recommendation', () => {
  assert.match(read('skills', 'question-protocol', 'SKILL.md'), /every owner question goes through `decisions\.js ask`/i);
});
