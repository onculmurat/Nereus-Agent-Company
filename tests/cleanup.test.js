import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { writeMessage, closeThread } from '../scripts/lib/mailbox.js';
import { addQuestion, decide } from '../scripts/lib/decisions.js';
import { teamPaths } from '../scripts/lib/paths.js';
import { planCleanup, applyCleanup } from '../scripts/lib/cleanup.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-10-18T12:00:00Z');
const config = (mode = 'archive') => ({ cleanup: { closedThreadMaxAgeDays: 30, mode } });
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

function thread(root, name, { age = 31, close = true, decided = true } = {}) {
  writeMessage(root, { from: 'architect', to: 'team-lead', thread: name, body: 'hi', date: daysAgo(age) });
  if (close) closeThread(root, name);
  if (decided) {
    const q = addQuestion(root, { title: name, source: 's', status: 'd', impact: 'i', blocking: 'no', thread: name });
    decide(root, q.id, { answer: 'ok' });
  }
}

const actionFor = (plan, name) => plan.find((p) => p.thread === name);

test('closed, decided and old thread is archived', () => {
  const root = makeProject();
  thread(root, 'api-shape');
  assert.equal(actionFor(planCleanup(root, config(), NOW), 'api-shape').action, 'archive');
});

test('closed but undecided thread is kept', () => {
  const root = makeProject();
  thread(root, 'open-one', { decided: false });
  const p = actionFor(planCleanup(root, config(), NOW), 'open-one');
  assert.equal(p.action, 'keep');
  assert.equal(p.reason, 'not in decisions.md');
});

test('a thread with an unread message is kept', () => {
  const root = makeProject();
  thread(root, 'busy', { close: false });
  assert.equal(actionFor(planCleanup(root, config(), NOW), 'busy').action, 'keep');
});

test('a thread younger than the limit is kept', () => {
  const root = makeProject();
  thread(root, 'fresh', { age: 29 });
  assert.equal(actionFor(planCleanup(root, config(), NOW), 'fresh').action, 'keep');
});

test('apply archives the thread directory', () => {
  const root = makeProject();
  thread(root, 'api-shape');
  applyCleanup(root, planCleanup(root, config(), NOW));
  const t = teamPaths(root);
  assert.ok(!fs.existsSync(path.join(t.mailbox, 'api-shape')));
  assert.equal(fs.readdirSync(path.join(t.archive, 'api-shape')).length, 1);
});

test('delete mode removes the thread directory', () => {
  const root = makeProject();
  thread(root, 'api-shape');
  applyCleanup(root, planCleanup(root, config('delete'), NOW));
  const t = teamPaths(root);
  assert.ok(!fs.existsSync(path.join(t.mailbox, 'api-shape')));
  assert.ok(!fs.existsSync(path.join(t.archive, 'api-shape')));
});

test('CLI dry run changes nothing', () => {
  const root = makeProject();
  thread(root, 'api-shape', { age: 400 });
  const out = execFileSync(process.execPath, [path.join(pluginRoot, 'scripts', 'cleanup.js'), '--project', root, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /archive\s+api-shape/);
  assert.ok(fs.existsSync(path.join(teamPaths(root).mailbox, 'api-shape')));
});
