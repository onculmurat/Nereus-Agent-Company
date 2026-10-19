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
