import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeMessage, listInbox, setState, closeThread, parseHeader, isValidThread } from '../scripts/lib/mailbox.js';
import { teamPaths } from '../scripts/lib/paths.js';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'mailbox.js');

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nac mailbox '));
  fs.mkdirSync(path.join(root, 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  return root;
}

test('writes one file per message with a colon-free name', () => {
  const root = project();
  const { path: p, created } = writeMessage(root, { from: 'architect', to: 'backend-developer', thread: 'db-choice', body: 'Use Postgres?' });
  assert.equal(created, true);
  assert.equal(path.dirname(p), path.join(teamPaths(root).mailbox, 'db-choice'));
  assert.match(path.basename(p), /^\d{8}T\d{9}Z-architect-to-backend-developer\.md$/);
  assert.ok(!path.basename(p).includes(':'));
});

test('same id twice gives one file', () => {
  const root = project();
  const msg = { id: 'toolu_1', from: 'a', to: 'b', thread: 't1', body: 'x' };
  const first = writeMessage(root, msg);
  const second = writeMessage(root, { ...msg, date: new Date(Date.now() + 5000).toISOString() });
  assert.equal(second.created, false);
  assert.equal(second.path, first.path);
  assert.equal(fs.readdirSync(path.dirname(first.path)).length, 1);
});

test('two messages in the same millisecond do not collide', () => {
  const root = project();
  const date = '2026-10-18T10:00:00.000Z';
  const a = writeMessage(root, { id: 'm1', from: 'a', to: 'b', thread: 't', body: '1', date });
  const b = writeMessage(root, { id: 'm2', from: 'a', to: 'b', thread: 't', body: '2', date });
  assert.notEqual(a.path, b.path);
  assert.ok(b.path.endsWith('-2.md'));
});

test('rejects path traversal in thread ids', () => {
  const root = project();
  assert.throws(() => writeMessage(root, { from: 'a', to: 'b', thread: '../x', body: 'y' }), /thread/);
  assert.equal(isValidThread('db-choice'), true);
  assert.equal(isValidThread('Db'), false);
});

test('missing thread goes to general', () => {
  const root = project();
  const { path: p } = writeMessage(root, { from: 'a', to: 'b', body: 'y' });
  assert.equal(path.basename(path.dirname(p)), 'general');
});

test('listInbox returns unread messages for the role, oldest first', () => {
  const root = project();
  writeMessage(root, { id: '1', from: 'a', to: 'beta', thread: 't', body: 'first', date: '2026-10-18T10:00:00.000Z' });
  writeMessage(root, { id: '2', from: 'a', to: 'beta', thread: 'u', body: 'second', date: '2026-10-18T11:00:00.000Z' });
  writeMessage(root, { id: '3', from: 'a', to: 'gamma', thread: 't', body: 'other' });
  const inbox = listInbox(root, 'beta');
  assert.deepEqual(inbox.map((m) => m.body.trim()), ['first', 'second']);
  setState(inbox[0].path, 'read');
  assert.equal(listInbox(root, 'beta').length, 1);
  assert.equal(listInbox(root, 'beta', { state: 'read' }).length, 1);
});

test('CRLF message files are read', () => {
  const root = project();
  const { path: p } = writeMessage(root, { id: 'c', from: 'a', to: 'beta', thread: 't', body: 'hi\n' });
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(listInbox(root, 'beta').length, 1);
});

test('closeThread marks every message closed', () => {
  const root = project();
  writeMessage(root, { id: '1', from: 'a', to: 'b', thread: 't', body: 'x' });
  writeMessage(root, { id: '2', from: 'b', to: 'a', thread: 't', body: 'y' });
  assert.equal(closeThread(root, 't'), 2);
  assert.equal(listInbox(root, 'b').length, 0);
  assert.equal(listInbox(root, 'b', { state: 'closed' }).length, 1);
});

test('parseHeader reads thread and sender', () => {
  assert.deepEqual(parseHeader('[thread:db-choice from:architect] Use Postgres?\nmore'),
    { thread: 'db-choice', from: 'architect', rest: 'Use Postgres?\nmore' });
  assert.deepEqual(parseHeader('[thread:x]\nbody'), { thread: 'x', from: undefined, rest: 'body' });
  assert.deepEqual(parseHeader('plain'), { thread: undefined, from: undefined, rest: 'plain' });
});

test('CLI send then inbox', () => {
  const root = project();
  const run = (...a) => JSON.parse(execFileSync(process.execPath, [cli, ...a, '--project', root], { encoding: 'utf8' }));
  const sent = run('send', '--from', 'alpha', '--to', 'beta', '--thread', 'demo', '--body', 'hello');
  assert.equal(sent.created, true);
  const inbox = run('inbox', '--role', 'beta');
  assert.equal(inbox.length, 1);
  const read = run('read', '--file', inbox[0].path);
  assert.equal(read.data.state, 'read');
  assert.equal(run('close-thread', '--thread', 'demo').closed, 1);
});

test('CLI bad input exits 1 with usage', () => {
  const r = (() => { try { execFileSync(process.execPath, [cli, 'send'], { encoding: 'utf8', stdio: 'pipe' }); return null; } catch (e) { return e; } })();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});

test('a plain file in the mailbox root (setup .gitkeep) is ignored', () => {
  const root = project();
  writeMessage(root, { from: 'architect', to: 'team-lead', thread: 't1', body: 'hi' });
  fs.writeFileSync(path.join(teamPaths(root).mailbox, '.gitkeep'), '');
  assert.equal(listInbox(root, 'team-lead').length, 1);
});
