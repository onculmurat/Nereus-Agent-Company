// 1.3.50: g91, the maintenance routine. Below maintenanceFreeGB task.js start refuses, the running work drains and
// worktree.js prune --shared removes sharedBuildDirs (the shared target dirs the done-task prune never touches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { addEntry } from '../scripts/lib/board.js';
import { maintenanceState, pruneShared } from '../scripts/lib/worktree.js';
import { loadConfig, validateConfig } from '../scripts/lib/config.js';

const GB = 1024 ** 3;

// Seen live (Memory Agent, 10-26): build/debug ~90 GB and the main tree's target ~53 GB filled D: overnight.
function project() {
  const { root, commit } = makeGitProject();
  const build = fs.mkdtempSync(path.join(path.dirname(root), 'nac-g91-build-'));
  const outside = fs.mkdtempSync(path.join(path.dirname(root), 'nac-g91-out-'));
  const dirs = { debug: path.join(build, 'debug'), target: path.join(root, 'target'), outside };
  for (const d of Object.values(dirs)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'x.rlib'), 'x'); }
  const config = { deleteRoots: [build], sharedBuildDirs: [dirs.debug, dirs.target], maintenanceFreeGB: 20 };
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify(config));
  addEntry(root, { id: 'T-200', title: 'next one', owner: 'backend-developer', model: 'sonnet' });
  fs.writeFileSync(path.join(root, '.gitignore'), 'target/\n');
  commit('README.md');
  return { root, build, dirs, config };
}

function withFree(bytes, fn) {
  const old = process.env.NAC_FREE_BYTES;
  process.env.NAC_FREE_BYTES = String(bytes);
  try { return fn(); } finally { if (old === undefined) delete process.env.NAC_FREE_BYTES; else process.env.NAC_FREE_BYTES = old; }
}

test('g91: maintenance is due below maintenanceFreeGB, only with sharedBuildDirs, and 0 turns it off', () => {
  const { root, config } = project();
  withFree(5 * GB, () => {
    const m = maintenanceState(root, config);
    assert.equal(m.due, true);
    assert.equal(m.freeGB, 5);
    assert.match(m.note, /prune --shared/);
    assert.equal(maintenanceState(root, { ...config, maintenanceFreeGB: 0 }).due, false);
    assert.equal(maintenanceState(root, { maintenanceFreeGB: 20 }).due, false, 'nothing to remove, no routine');
  });
  withFree(30 * GB, () => assert.equal(maintenanceState(root, config).due, false));
});

test('g91: config checks maintenanceFreeGB and sharedBuildDirs', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: path.join(os.tmpdir(), 'none.json') });
  const validate = (c) => validateConfig({ ...base, ...c });
  validate({ maintenanceFreeGB: 0, sharedBuildDirs: [path.join(os.tmpdir(), 'x', 'target')] });
  assert.throws(() => validate({ maintenanceFreeGB: -1 }), /maintenanceFreeGB/);
  assert.throws(() => validate({ maintenanceFreeGB: '20' }), /maintenanceFreeGB/);
  assert.throws(() => validate({ sharedBuildDirs: ['relative/target'] }), /sharedBuildDirs/);
  assert.throws(() => validate({ sharedBuildDirs: [path.parse(process.cwd()).root] }), /sharedBuildDirs/);
});

test('g91: pruneShared waits while cargo or rustc runs', () => {
  const { root, build, dirs, config } = project();
  const r = pruneShared(root, config, { deleteRoots: [build], list: () => [{ pid: 7, ppid: 1, cmd: '"C:\\Users\\x\\.cargo\\bin\\cargo.exe" test -p memory' }, { pid: 8, ppid: 1, cmd: 'node rust-analyzer-helper.js' }] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.busy.map((p) => p.pid), [7]);
  assert.match(r.note, /never stop them by name/);
  assert.ok(fs.existsSync(dirs.debug) && fs.existsSync(dirs.target));
});

test('g91: pruneShared removes the shared dirs inside the project or deleteRoots, never one outside', () => {
  const { root, build, dirs, config } = project();
  const r = pruneShared(root, { ...config, sharedBuildDirs: [...config.sharedBuildDirs, dirs.outside] }, { deleteRoots: [build], list: () => [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.removed.sort(), [dirs.debug, dirs.target].sort());
  assert.deepEqual(r.refused, [dirs.outside]);
  assert.ok(!fs.existsSync(dirs.debug) && !fs.existsSync(dirs.target));
  assert.ok(fs.existsSync(dirs.outside) && fs.existsSync(build), 'the outside dir and the deleteRoots folder stay');
});

const cli = (script, args, root, env = {}) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { encoding: 'utf8', env: { ...process.env, ...env } });

test('g91: task.js start refuses while maintenance is due and starts when the drive has room', () => {
  const { root } = project();
  const low = cli('task.js', ['start', 'T-200'], root, { NAC_FREE_BYTES: String(5 * GB) });
  assert.notEqual(low.status, 0);
  assert.match(low.stdout + low.stderr, /maintenance due \(g91\)/);
  const ok = cli('task.js', ['start', 'T-200'], root, { NAC_FREE_BYTES: String(50 * GB) });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});
