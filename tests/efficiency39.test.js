// 1.3.48: g90, the build output of done tasks is removed (at close, by worktree.js prune, and by the gate when the
// drive runs low), and the gate does not run, nor count a round, on a full drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { addEntry, readBoard } from '../scripts/lib/board.js';
import { idPattern, pruneTaskBuilds, worktreePath } from '../scripts/lib/worktree.js';
import { diskFull } from '../scripts/lib/gate.js';

// Seen live (Memory Agent, 10-26): review-t047, review-t047-base, t105a, review-061b stayed in the build folder, ~33 GB.
test('g90: idPattern finds a task id as its own part of a folder name', () => {
  for (const [id, names] of [['T-047', ['review-t047', 'review-t047-base', 't047', 'T-047', 't-047-rev', '047']], ['T-105a', ['t105a']], ['T-061b', ['review-061b']]]) {
    for (const n of names) assert.ok(idPattern(id).test(n), `${id} ${n}`);
  }
  for (const n of ['t0470', 't047a', 'review-t1047', 'base', 'debug', 'nimc-mem-e67c-d047-4c2a', 'x-rev047']) assert.ok(!idPattern('T-047').test(n), n);
});

test('g90: diskFull reads the full-drive forms of cargo, git and node', () => {
  for (const o of ['error: No space left on device (os error 28)', 'ENOSPC: no space left on device, write', 'os error 112', 'There is not enough space on the disk.']) assert.ok(diskFull(o), o);
  assert.ok(!diskFull('test result: FAILED. 1 passed; 1 failed'));
});

function project() {
  const root = makeProject();
  const wtRoot = fs.mkdtempSync(path.join(path.dirname(root), 'nac-g90-wt-'));
  const build = fs.mkdtempSync(path.join(path.dirname(root), 'nac-g90-build-'));
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ worktreeRoot: wtRoot, deleteRoots: [build] }));
  addEntry(root, { id: 'T-047', title: 'done one', owner: 'backend-developer', model: 'sonnet' });
  addEntry(root, { id: 'T-110a', title: 'open one', owner: 'backend-developer', model: 'sonnet' });
  const board = path.join(root, 'team', 'work', 'board.md');
  const text = fs.readFileSync(board, 'utf8');
  fs.writeFileSync(board, text.replace(/(## T-047:[^\n]*\n(?:- [^\n]*\n)*?- status: )todo/, '$1done'));
  assert.equal(readBoard(root).entries.find((e) => e.id === 'T-047').status, 'done');
  const beside = path.dirname(worktreePath(root, 'T-1', { worktreeRoot: wtRoot }));
  const dirs = {
    doneBeside: path.join(beside, 'target-T-047'), openBeside: path.join(beside, 'target-T-110a'),
    doneNamed: path.join(build, 'review-t047'), doneBase: path.join(build, 'review-t047-base'),
    openNamed: path.join(build, 'review-t110a'), both: path.join(build, 'cmp-t047-t110a'), shared: path.join(build, 'debug'),
  };
  for (const d of Object.values(dirs)) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'x.rlib'), 'x'); }
  return { root, wtRoot, build, dirs };
}

test('g90: pruneTaskBuilds removes only the done tasks\' build dirs', () => {
  const { root, wtRoot, build, dirs } = project();
  const r = pruneTaskBuilds(root, { worktreeRoot: wtRoot, deleteRoots: [build] });
  assert.deepEqual(r.removed.sort(), [dirs.doneBeside, dirs.doneNamed, dirs.doneBase].sort());
  for (const k of ['doneBeside', 'doneNamed', 'doneBase']) assert.ok(!fs.existsSync(dirs[k]), k);
  for (const k of ['openBeside', 'openNamed', 'both', 'shared']) assert.ok(fs.existsSync(dirs[k]), `${k} stays`);
  assert.ok(fs.existsSync(build), 'the deleteRoots folder itself stays');
  assert.deepEqual(pruneTaskBuilds(root, { worktreeRoot: wtRoot, deleteRoots: [build], ids: ['T-110a'] }).removed, [], 'a task not done keeps its dirs');
});

const cli = (script, args, root, env = {}) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { encoding: 'utf8', env: { ...process.env, NAC_GATE_WAIT_SECONDS: '0', ...env } });

test('g90: worktree.js prune removes the done tasks\' build dirs', () => {
  const { root, dirs } = project();
  const r = cli('worktree.js', ['prune'], root);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(dirs.doneNamed) && !fs.existsSync(dirs.doneBeside));
  assert.ok(fs.existsSync(dirs.openNamed));
});

test('g90: below gateMinFreeGB the gate prunes, then refuses to run and it is not a round', () => {
  const { root, dirs } = project();
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'team', 'config.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ ...cfg, testCommand: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\', \'1\')"' }));
  const r = cli('gate.js', [], root, { NAC_GATE_MIN_FREE_GB: '999999999' });
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.diskNote, /not a round/);
  assert.ok(out.disk.pruned.includes(dirs.doneNamed));
  assert.ok(!fs.existsSync(path.join(root, 'ran.txt')), 'the checks did not run');
  const ok = cli('gate.js', [], root, { NAC_GATE_MIN_FREE_GB: '0' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(fs.existsSync(path.join(root, 'ran.txt')));
});
