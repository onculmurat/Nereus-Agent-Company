// 1.3.41: g82, the NAC suite removes its own temporary folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot } from './hooks/run-hook.js';

const preload = path.join(pluginRoot, 'tests', 'tmp-root.cjs');

// Seen live (10-26): ~34,000 "nac *" folders (26 GB) under the session temp folder, made by this suite's mkdtempSync
// calls and never removed; the same leak as g81, in NAC's own tests.
test('g82: npm test preloads the temp root for every test process', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --require ./tests/tmp-root.cjs --test');
});

test('g82: the folders the test processes make with mkdtemp, and their -wt worktrees, are gone when the run ends', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nac g82 '));
  try {
    const { NAC_TEST_RUN, ...env } = process.env; // the spawned process is the runner of its own run
    const child = `import { mkdtempSync, mkdirSync } from 'node:fs';import p from 'node:path';const d=mkdtempSync(p.join(process.argv[1],'child '));mkdirSync(d+'-wt-T-1');`;
    const runner = `const fs=require('fs'),p=require('path'),{execFileSync}=require('child_process');
const d=fs.mkdtempSync(p.join(process.argv[1],'runner '));fs.writeFileSync(p.join(d,'f'),'x');
execFileSync(process.execPath,['--require',${JSON.stringify(preload)},'--input-type=module','-e',${JSON.stringify(child)},process.argv[1]]);
if(fs.readdirSync(process.argv[1]).length!==3)process.exit(9);`;
    const r = spawnSync(process.execPath, ['--require', preload, '-e', runner, parent], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || 'the folders were there while the run went on');
    assert.deepEqual(fs.readdirSync(parent), [], 'the folders and what was made in them are gone after the run');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
