import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, defaultUserConfigPath } from '../scripts/lib/config.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nac-config-')); }
function project(overrides) {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'team'));
  fs.writeFileSync(path.join(root, 'team', 'config.json'), overrides === undefined ? '{}' : JSON.stringify(overrides));
  return root;
}
const noUser = path.join(os.tmpdir(), 'nac-no-such-user-config.json');

test('defaults load alone', () => {
  const cfg = loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: null });
  assert.equal(cfg.models.architect, 'opus');
  assert.equal(cfg.models.assistant, 'haiku');
  assert.equal(cfg.cleanup.closedThreadMaxAgeDays, 30);
});

test('project override changes only that key', () => {
  const cfg = loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: project({ models: { assistant: 'sonnet' } }) });
  assert.equal(cfg.models.assistant, 'sonnet');
  assert.equal(cfg.models.architect, 'opus');
});

test('project wins over user, user wins over defaults', () => {
  const userFile = path.join(tmp(), 'config.json');
  fs.writeFileSync(userFile, JSON.stringify({ maxActiveRoles: 3, models: { planner: 'opus' } }));
  const cfg = loadConfig({ pluginRoot, userConfigPath: userFile, projectRoot: project({ maxActiveRoles: 4 }) });
  assert.equal(cfg.maxActiveRoles, 4);
  assert.equal(cfg.models.planner, 'opus');
});

test('arrays replace instead of merging', () => {
  const cfg = loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: project({ phases: { enabled: [0] } }) });
  assert.deepEqual(cfg.phases.enabled, [0]);
  assert.deepEqual(cfg.phases.teamMode, [1, 3, 6, 8]);
});

test('invalid JSON names the file', () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{ nope');
  assert.throws(() => loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: root }),
    (e) => e.message.includes(path.join(root, 'team', 'config.json')));
});

test('validateConfig rejects an unknown model naming the key', () => {
  const cfg = loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: null });
  cfg.models.planner = 'gpt';
  assert.throws(() => validateConfig(cfg), /models\.planner/);
});

test('validateConfig rejects a non-positive threshold', () => {
  const cfg = loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: null });
  cfg.escalation.leadRounds = 0;
  assert.throws(() => validateConfig(cfg), /escalation\.leadRounds/);
});

test('default escalation rounds sum to 5', () => {
  const { escalation: e } = loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: null });
  assert.equal(e.modelRounds + e.authorityRounds + e.leadRounds, 5);
});

test('default user config path', () => {
  assert.equal(defaultUserConfigPath(), path.join(os.homedir(), '.claude', 'nac', 'config.json'));
});

test('a config file with a UTF-8 BOM loads', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'team'));
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '﻿{"maxActiveRoles": 3}');
  assert.equal(loadConfig({ pluginRoot, userConfigPath: noUser, projectRoot: root }).maxActiveRoles, 3);
});
