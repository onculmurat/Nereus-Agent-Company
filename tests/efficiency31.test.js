// 1.3.40: g81, the gate removes the tests' temporary folders when it ends; a closed task's tmp-<id> folders go with its worktree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { addWorktree, removeWorktree } from '../scripts/lib/worktree.js';

const gateCli = path.join(pluginRoot, 'scripts', 'gate.js');
const env = { ...process.env, NAC_GATE_WAIT_SECONDS: '0' };
const leak = `node -e "const fs=require('fs'),p=require('path');const d=p.join(process.env.TMP,'nim-leak');fs.mkdirSync(d);fs.writeFileSync(p.join(d,'f'),'x')"`;

// Seen live (Memory Agent, 10-26): the tests left nim-* folders behind on every gate run, ~10 GB in gateTmp and 38k
// folders on C: from the runs before gateTmp.
test('g81: a gate run leaves nothing in gateTmp, green or red', () => {
  const { root, commit } = makeGitProject();
  commit('a.txt');
  const tmp = path.join(root, 'out', 'gtmp');
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'keep.txt'), 'owner');
  for (const [command, status] of [[leak, 0], [`${leak} && node -e "process.exit(1)"`, 1]]) {
    fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ gateTmp: tmp, gateRetry: 0, gateCommands: [{ name: 'test', command }] }));
    const r = spawnSync(process.execPath, [gateCli, '--project', root], { encoding: 'utf8', env });
    assert.equal(r.status, status, r.stdout + r.stderr);
    assert.deepEqual(fs.readdirSync(tmp), ['keep.txt']);
  }
});

test('g81: removing a worktree also removes the task tmp-<id> folders beside it', () => {
  const { root, git } = makeGitProject();
  git('commit', '-q', '--allow-empty', '-m', 'seed');
  const wt = addWorktree(root, 'T-12');
  const base = path.dirname(wt.path);
  for (const d of ['tmp-T-12', 'tmp-T-120']) fs.mkdirSync(path.join(base, d, 'nim-x'), { recursive: true });
  removeWorktree(root, 'T-12');
  assert.ok(!fs.existsSync(path.join(base, 'tmp-T-12')));
  assert.ok(fs.existsSync(path.join(base, 'tmp-T-120')));
});
