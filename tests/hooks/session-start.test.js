import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProject } from '../helpers.js';
import { runHook, fixture } from './run-hook.js';

test('injects lead instructions, rules and resume summary in a NAC project', async () => {
  const root = makeProject();
  const r = runHook('session-start', await fixture('session-start-startup', { cwd: root }));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /# NAC lead instructions/);
  assert.match(ctx, /## Resolved rules/);
  assert.match(ctx, /neverDecideWithoutAsking/);
  assert.match(ctx, /## Resume/);
  assert.match(ctx, /Phase: 0/);
});

test('resume payload works the same', async () => {
  const root = makeProject();
  const r = runHook('session-start', await fixture('session-start-resume', { cwd: root }));
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Phase: 0/);
});

test('outside a NAC project: no output, exit 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac plain '));
  const r = runHook('session-start', await fixture('session-start-startup', { cwd: dir }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('malformed stdin: no output, exit 0', () => {
  const r = runHook('session-start', 'not json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('empty stdin: no output, exit 0', () => {
  const r = runHook('session-start', '');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
