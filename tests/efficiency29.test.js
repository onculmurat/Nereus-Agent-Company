// 1.3.37: g77, gateTmp sets TMP, TEMP and TMPDIR for the gate checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { validateConfig } from '../scripts/lib/config.js';

const gateCli = path.join(pluginRoot, 'scripts', 'gate.js');
const defaults = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'defaults', 'config.json'), 'utf8'));
const env = { ...process.env, NAC_GATE_WAIT_SECONDS: '0' };
const check = `node -e "const t=process.env.TMP;process.exit(t&&t===process.env.TEMP&&t===process.env.TMPDIR&&t.endsWith('gtmp')?0:1)"`;

// Seen live (Memory Agent T-101, 10-26): the lead runs the gate from the PowerShell tool, which has the Windows user
// TMP (C:\Users\...\Temp); the unsafe_policy tests wrote their temporary files to the full C: drive.
test('g77: gateTmp sends the checks to the configured temporary folder and creates it', () => {
  const { root, commit } = makeGitProject();
  commit('a.txt');
  const tmp = path.join(root, 'out', 'gtmp');
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateTmp: tmp, gateCommands: [{ name: 'test', command: check }] }));
  const r = spawnSync(process.execPath, [gateCli, '--project', root], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(tmp));
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateCommands: [{ name: 'test', command: check }] }));
  assert.equal(spawnSync(process.execPath, [gateCli, '--project', root], { encoding: 'utf8', env }).status, 1);
});

test('g77: gateTmp must be a folder path', () => {
  assert.doesNotThrow(() => validateConfig({ ...defaults, gateTmp: 'D:/nac-tmp' }));
  assert.throws(() => validateConfig({ ...defaults, gateTmp: '' }), /gateTmp must be a folder path/);
});
