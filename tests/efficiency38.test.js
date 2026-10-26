// 1.3.47: g88, the destructive guard blocks a kill by process name (a kill by PID stays allowed); g89, a recursive
// delete inside the project's worktrees passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDestructive } from '../scripts/lib/destructive.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProject } from './helpers.js';
import { runHook, fixture } from './hooks/run-hook.js';

const sh = (root, command) => checkDestructive(command, { toolName: 'Bash', cwd: root, root, deleteRoots: [] }) ?? null;
const ps = (root, command) => checkDestructive(command, { toolName: 'PowerShell', cwd: root, root, deleteRoots: [] }) ?? null;

// Seen live (Memory Agent T-108a, 10-26): a developer ran pkill -f cargo while four more tasks built and gated in
// their own worktrees; only the auto mode classifier stopped it.
test('g88: a kill by process name is blocked in Bash and PowerShell', () => {
  const root = makeProject();
  for (const command of [
    'pkill -f cargo; ls',
    'killall cargo',
    'sudo pkill rustc',
    'taskkill /IM cargo.exe /F',
    'cmd /c taskkill /F /IM cargo.exe',
    'taskkill /F /FI "IMAGENAME eq cargo.exe"',
  ]) assert.match(sh(root, command) ?? '', /blocked a kill by process name/, command);
  for (const command of [
    'Stop-Process -Name cargo -Force',
    'Stop-Process -ProcessName rustc',
    'spps -n cargo',
    'kill -Name cargo',
    'Get-Process cargo | Stop-Process -Force',
    'gps cargo* | kill',
  ]) assert.match(ps(root, command) ?? '', /blocked a kill by process name/, command);
});

test('g88: a kill by PID, and a process listing, pass', () => {
  const root = makeProject();
  for (const command of ['kill 1234', 'kill -9 1234 5678', 'kill %1', 'taskkill /PID 1234 /T /F', 'pgrep -f cargo', 'ps aux | grep cargo']) {
    assert.equal(sh(root, command), null, command);
  }
  for (const command of ['Stop-Process -Id 1234 -Force', '$p | Stop-Process', 'Get-Process cargo', 'kill 1234']) {
    assert.equal(ps(root, command), null, command);
  }
});

// Seen live (Memory Agent T-108a, 10-26): rm -rf target in the task's own worktree (worktreeRoot D:/Projects/nac-wt)
// was blocked as outside the project.
test('g89: a recursive delete inside the worktrees folder passes; the folder itself and beside it are blocked', async () => {
  const root = makeProject();
  const wtRoot = path.join(path.parse(os.tmpdir()).root, 'nac-g89-wt');
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ worktreeRoot: wtRoot }));
  const base = path.join(wtRoot, `${path.basename(root)}-wt`);
  const call = async (command) => (await runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Bash', tool_input: { command } }))).status;
  assert.equal(await call(`rm -rf "${path.join(base, 'T-108a', 'target')}"`), 0);
  assert.equal(await call(`cd "${path.join(base, 'T-108a')}" && rm -rf target`), 0);
  assert.equal(await call(`rm -rf "${path.join(base, 'target-T-108a')}"`), 0);
  for (const c of [`rm -rf "${base}"`, `rm -rf "${path.join(wtRoot, 'other')}"`, `rm -rf "${wtRoot}"`]) assert.equal(await call(c), 2, c);
});

test('g88: the hook blocks pkill -f cargo', async () => {
  const root = makeProject();
  const r = await runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Bash', tool_input: { command: 'pkill -f cargo; ls' } }));
  assert.equal(r.status, 2);
});
