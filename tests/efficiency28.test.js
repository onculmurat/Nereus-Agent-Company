// 1.3.36: g76, rotateBy in team/config.json picks the lead rotation way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { addEntry, updateEntry } from '../scripts/lib/board.js';
import { rotationEvery, rotationWay } from '../scripts/lib/task.js';
import { validateConfig } from '../scripts/lib/config.js';

const defaults = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'defaults', 'config.json'), 'utf8'));
const node = (script, args, root) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8' });

// Seen live (Memory Agent, 10-26): with compaction the lead went on at ~62k per call after each compaction (the summary
// and the reloaded files) and compacted 8 times in a day, some 3-4 minutes apart; a fresh session starts at ~37k.
test('g76: rotateBy clear wins over compaction and rotates after every task', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  fs.mkdirSync(path.join(p.root, '.claude'));
  fs.writeFileSync(path.join(p.root, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 100000 }));
  addEntry(p.root, { id: 'T-001', title: 'first', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  addEntry(p.root, { id: 'T-002', title: 'second', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), JSON.stringify({ rotateBy: 'clear' }));
  assert.equal(rotationWay(p.root, {}), 'compaction');
  assert.equal(rotationWay(p.root, { rotateBy: 'clear' }), 'clear');
  assert.equal(rotationEvery(p.root, { rotateBy: 'clear' }), 1);
  assert.equal(rotationEvery(p.root, { rotateBy: 'clear', rotateEvery: 2 }), 2);
  updateEntry(p.root, 'T-001', { status: 'in-progress' });
  const r = node('board.js', ['update', 'T-001', '--status', 'done'], p.root);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.rotate, true);
  assert.equal(out.rotateBy, 'clear');
});

test('g76: rotateBy accepts only clear or compaction', () => {
  assert.doesNotThrow(() => validateConfig({ ...defaults, rotateBy: 'compaction' }));
  assert.throws(() => validateConfig({ ...defaults, rotateBy: 'restart' }), /rotateBy must be "clear" or "compaction"/);
});

test('g76: task-loop says to carry on when devam comes without /clear', () => {
  const skill = fs.readFileSync(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'), 'utf8');
  assert.match(skill, /`rotateBy` in `team\/config\.json` picks the way/);
  assert.match(skill, /if "devam" comes without `\/clear`, carry on in this session/);
  assert.ok(skill.length < 18000);
});
