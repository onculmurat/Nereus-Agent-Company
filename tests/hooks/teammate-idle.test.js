import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from '../helpers.js';
import { runHook, fixture } from './run-hook.js';
import { writeMessage } from '../../scripts/lib/mailbox.js';

test('keeps a teammate working while it has unread mail', async () => {
  const root = makeProject();
  writeMessage(root, { from: 'planner', to: 'architect', thread: 't', body: 'please look' });
  const r = runHook('teammate-idle', await fixture('teammate-idle.synthetic', { cwd: root }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /You have 1 unread message/);
  assert.match(r.stderr, /mailbox\.js" inbox --role architect --mark-read/);
});

test('lets a teammate go idle with an empty inbox', async () => {
  const root = makeProject();
  const r = runHook('teammate-idle', await fixture('teammate-idle.synthetic', { cwd: root }));
  assert.equal(r.status, 0);
});
