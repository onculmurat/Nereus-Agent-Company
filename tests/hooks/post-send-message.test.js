import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeProject } from '../helpers.js';
import { runHook, fixture } from './run-hook.js';
import { listInbox } from '../../scripts/lib/mailbox.js';
import { teamPaths } from '../../scripts/lib/paths.js';

const allMessages = (root) => {
  const box = teamPaths(root).mailbox;
  if (!fs.existsSync(box)) return [];
  return fs.readdirSync(box).flatMap((t) => fs.readdirSync(path.join(box, t)).map((f) => path.join(box, t, f)));
};

test('a teammate message is recorded once, even when the hook runs twice', async () => {
  const root = makeProject();
  const payload = await fixture('post-send-message-teammate', { cwd: root });
  assert.equal(runHook('post-send-message', payload).status, 0);
  assert.equal(runHook('post-send-message', payload).status, 0);
  assert.equal(allMessages(root).length, 1);
  const [msg] = listInbox(root, 'alpha', { state: 'read' });
  assert.equal(msg.data.id, payload.tool_use_id);
  assert.equal(msg.data.from, 'unknown');
  assert.equal(msg.data.thread, 'general');
});

test('recipient "main" is the team lead', async () => {
  const root = makeProject();
  runHook('post-send-message', await fixture('post-send-message-teammate-to-lead', { cwd: root }));
  assert.equal(listInbox(root, 'team-lead', { state: 'read' }).length, 1);
});

test('header sets thread and sender and is stripped from the body', async () => {
  const root = makeProject();
  const base = await fixture('post-send-message-teammate', { cwd: root });
  base.tool_input = { ...base.tool_input, message: '[thread:db-choice from:architect] Use Postgres?' };
  runHook('post-send-message', base);
  const [msg] = listInbox(root, 'alpha', { state: 'read' });
  assert.equal(msg.data.thread, 'db-choice');
  assert.equal(msg.data.from, 'architect');
  assert.equal(msg.body.trim(), 'Use Postgres?');
});

test('a send from the lead without a header is from team-lead', async () => {
  const root = makeProject();
  const base = await fixture('post-send-message-lead-protocol', { cwd: root });
  base.tool_input = { to: 'alpha', message: 'plain text from the lead' };
  runHook('post-send-message', base);
  assert.equal(listInbox(root, 'alpha', { state: 'read' })[0].data.from, 'team-lead');
});

test('protocol (object) messages are not recorded', async () => {
  const root = makeProject();
  const r = runHook('post-send-message', await fixture('post-send-message-lead-protocol', { cwd: root }));
  assert.equal(r.status, 0);
  assert.equal(allMessages(root).length, 0);
});

test('an invalid thread in the header falls back to general', async () => {
  const root = makeProject();
  const base = await fixture('post-send-message-teammate', { cwd: root });
  base.tool_input = { ...base.tool_input, message: '[thread:../../etc from:architect] hi' };
  runHook('post-send-message', base);
  assert.equal(listInbox(root, 'alpha', { state: 'read' })[0].data.thread, 'general');
});

test('outside a NAC project nothing is written and exit is 0', async () => {
  const r = runHook('post-send-message', await fixture('post-send-message-teammate', { cwd: path.parse(process.cwd()).root }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
