// Scripted dry run of a v1 project: setup, board, questions, mail, hooks, escalation, cleanup, phase report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pluginRoot, runHook, fixture } from '../hooks/run-hook.js';
import '../helpers.js';

const script = (name) => path.join(pluginRoot, 'scripts', `${name}.js`);

test('setup to phase report on a sample project', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac e2e '));
  const run = (name, ...args) => execFileSync(process.execPath, [script(name), ...args, '--project', dir], { encoding: 'utf8' });
  const json = (name, ...args) => JSON.parse(run(name, ...args));

  execFileSync('git', ['init', '-q'], { cwd: dir });
  run('setup', '--apply');
  assert.ok(fs.existsSync(path.join(dir, 'team', 'work', 'board.md')));

  assert.equal(json('board', 'add', '--title', 'Build the API', '--owner', 'backend-developer', '--model', 'sonnet').id, 'T-001');
  const q = json('decisions', 'ask', '--title', 'Which database?', '--source', 'architect', '--status', 'no code', '--impact', 'schema', '--blocking', 'yes', '--thread', 'db-choice', '--options', 'pg|sqlite', '--recommend', 'pg');
  assert.equal(q.id, 'Q-001');
  run('mailbox', 'send', '--from', 'architect', '--to', 'backend-developer', '--thread', 'db-choice', '--body', 'Waiting on the database choice.');

  const start = runHook('session-start', await fixture('session-start-startup', { cwd: dir }));
  assert.equal(start.status, 0);
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /# NAC lead instructions/);

  const sent = runHook('post-send-message', await fixture('post-send-message-teammate', { cwd: dir }));
  assert.equal(sent.status, 0);

  const completed = runHook('task-completed', await fixture('task-completed.synthetic', { cwd: dir }));
  assert.equal(completed.status, 2);
  assert.match(completed.stderr, /T-001 is not complete/);

  const idle = runHook('teammate-idle', await fixture('teammate-idle.synthetic', { cwd: dir, teammate_name: 'backend-developer' }));
  assert.equal(idle.status, 2);
  assert.match(idle.stderr, /unread message/);

  // the ladder test needs more rounds than the default review round cap
  fs.writeFileSync(path.join(dir, 'team', 'config.json'), JSON.stringify({ reviewRoundCap: 10 }));
  let round;
  for (let i = 0; i < 4; i++) round = json('board', 'round', 'T-001');
  assert.equal(round.next.action, 'to-lead');

  json('decisions', 'decide', 'Q-001', '--answer', 'PostgreSQL');
  run('mailbox', 'close-thread', '--thread', 'db-choice');
  fs.writeFileSync(path.join(dir, 'team', 'config.json'), JSON.stringify({ cleanup: { closedThreadMaxAgeDays: 0 } }));
  assert.match(run('cleanup', '--apply'), /archive\s+db-choice/);
  assert.ok(fs.existsSync(path.join(dir, 'team', 'work', 'archive', 'db-choice')));

  const report = json('summary', '--phase-report');
  assert.ok(report.decided.some((d) => d.id === 'D-001'));
  assert.ok(report.notDone.some((e) => e.id === 'T-001'));
});
