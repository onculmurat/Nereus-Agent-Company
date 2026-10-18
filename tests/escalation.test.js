import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { nextAction } from '../scripts/lib/escalation.js';
import { addEntry, incrementRound, readBoard } from '../scripts/lib/board.js';
import { loadConfig } from '../scripts/lib/config.js';
import { teamPaths } from '../scripts/lib/paths.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null });

test('default ladder', () => {
  assert.deepEqual(nextAction(1, 'haiku', config), { action: 'retry', model: 'haiku' });
  assert.deepEqual(nextAction(2, 'haiku', config), { action: 'raise-model', model: 'sonnet' });
  assert.deepEqual(nextAction(2, 'opus', config), { action: 'retry', model: 'opus' });
  assert.deepEqual(nextAction(3, 'sonnet', config), { action: 'retry', model: 'sonnet' });
  assert.deepEqual(nextAction(4, 'sonnet', config), { action: 'to-lead', model: 'opus' });
  assert.equal(nextAction(5, 'opus', config).action, 'to-owner');
  assert.equal(nextAction(6, 'opus', config).action, 'to-owner');
});

test('custom thresholds', () => {
  const c = { ...config, escalation: { modelRounds: 1, authorityRounds: 1, leadRounds: 1 } };
  assert.equal(nextAction(1, 'haiku', c).action, 'raise-model');
  assert.equal(nextAction(2, 'sonnet', c).action, 'to-lead');
  assert.equal(nextAction(3, 'opus', c).action, 'to-owner');
});

test('incrementRound raises the model and writes an escalation record', () => {
  const root = makeProject();
  addEntry(root, { title: 'API', owner: 'backend-developer', model: 'haiku' });
  const first = incrementRound(root, 'T-001', config);
  assert.equal(first.next.action, 'retry');
  assert.equal(fs.existsSync(teamPaths(root).escalations) && fs.readdirSync(teamPaths(root).escalations).length, false);
  const second = incrementRound(root, 'T-001', config);
  assert.equal(second.entry.rounds, 2);
  assert.equal(second.entry.model, 'sonnet');
  assert.equal(readBoard(root).entries[0].model, 'sonnet');
  const record = path.join(teamPaths(root).escalations, 'T-001-r2.md');
  assert.match(fs.readFileSync(record, 'utf8'), /raise-model/);
});
