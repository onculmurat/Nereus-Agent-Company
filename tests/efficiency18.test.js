// 1.3.8: code map (g37), Files: line and scope record, team/ files in a code commit, findings amend and pack --ids
// (g40), board update --title (g42), the obstacle rule (g38).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { addEntry, readBoard } from '../scripts/lib/board.js';
import { addFinding, listFindings } from '../scripts/lib/findings.js';
import { briefFiles, codeMap, classify, MAP_MAX_CHARS } from '../scripts/lib/scope.js';
import { buildPack } from '../scripts/lib/pack.js';

const commitAll = (p, msg = 'x') => { p.git('add', '-A'); p.git('commit', '-q', '-m', msg); };
const node = (script, args, root) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8' });
const json = (r) => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');

const RUST = 'use std::fs;\n\npub struct Status {\n    files: u32,\n}\n\nimpl Status {\n    pub fn new() -> Self { Status { files: 0 } }\n}\n\nfn helper(x: u32) -> u32 { x }\n';

function project(brief) {
  const p = makeGitProject();
  write(p.root, 'crates/core/src/status.rs', RUST);
  write(p.root, 'crates/core/src/lib.rs', 'pub mod status;\n');
  addEntry(p.root, { id: 'T-001', title: 'status', owner: 'backend-developer', model: 'sonnet', size: 'S' });
  write(p.root, 'team/work/tasks/T-001.md', brief);
  commitAll(p, 'seed');
  return p;
}

test('briefFiles: the Files: line wins; without it the backticked paths; team/, URLs and absolute paths are dropped', () => {
  assert.deepEqual(briefFiles('# T\n- Files: `crates/a.rs` (new), crates/b.rs, Cargo.toml, team/x.md\nsee `crates/c.rs`'), { line: true, files: ['crates/a.rs', 'crates/b.rs', 'Cargo.toml'] });
  assert.deepEqual(briefFiles('edit `crates/c.rs:12` and `src/d.ts`, not `https://x.y/z`, `/etc/passwd`, `team/work/b.md`, `D:/x/y`, `%LOCALAPPDATA%/m`, `store::open(a/b.db)`'), { line: false, files: ['crates/c.rs', 'src/d.ts'] });
});

test('g37: without a Files: line a named path that does not exist is left out of the map, not called new', () => {
  const p = project('# T-001\nedit `crates/core/src/status.rs` and `local/nereus-infra-mem`\n');
  const map = codeMap(p.root, fs.readFileSync(path.join(p.root, 'team/work/tasks/T-001.md'), 'utf8'));
  assert.match(map, /status\.rs/);
  assert.doesNotMatch(map, /nereus-infra-mem|new file/);
});

test('g37: the code map lists the declarations with line numbers, says new or directory, and stays under its limit', () => {
  const p = project('- Files: crates/core/src/status.rs, crates/core/src/new.rs (new), crates/core/src\n');
  const map = codeMap(p.root, fs.readFileSync(path.join(p.root, 'team/work/tasks/T-001.md'), 'utf8'));
  assert.match(map, /^## Code map/);
  assert.match(map, /from the brief's Files: line/);
  assert.match(map, /### crates\/core\/src\/status\.rs \(11 lines\)/);
  assert.match(map, /3: pub struct Status \{/);
  assert.match(map, /7: impl Status \{/);
  assert.match(map, /8: pub fn new\(\) -> Self/);
  assert.match(map, /11: fn helper/);
  assert.doesNotMatch(map, /use std::fs/);
  assert.match(map, /### crates\/core\/src\/new\.rs\n\nnew file/);
  assert.match(map, /### crates\/core\/src\n\ndirectory/);
  const many = Array.from({ length: 60 }, (_, i) => `crates/m${i}.rs`);
  for (const f of many) write(p.root, f, RUST.repeat(4));
  const big = codeMap(p.root, `Files: ${many.join(', ')}`);
  assert.ok(big.length < MAP_MAX_CHARS + 2000, `${big.length}`);
  assert.match(big, /Not mapped \(size limit\): .*crates\/m59\.rs/);
});

test('g37: the full pack carries the code map; a brief that names no file gets none', () => {
  const p = project('# T-001\n- Files: crates/core/src/status.rs\n');
  assert.match(buildPack(p.root, { id: 'T-001', role: 'backend-developer' }).text, /## Code map[\s\S]*3: pub struct Status/);
  write(p.root, 'team/work/tasks/T-001.md', '# T-001\nNo paths here.\n');
  assert.doesNotMatch(buildPack(p.root, { id: 'T-001', role: 'backend-developer' }).text, /## Code map/);
});

test('classify sorts a file the brief does not name by kind', () => {
  assert.equal(classify('Cargo.lock'), 'lock');
  assert.equal(classify('web/package-lock.json'), 'lock');
  assert.equal(classify('crates/core/src/lib.rs'), 'registration');
  assert.equal(classify('src/index.ts'), 'registration');
  assert.equal(classify('crates/core/tests/golden/a.txt'), 'fixture');
  assert.equal(classify('crates/mcp/tests/common/mod.rs'), 'registration');
  assert.equal(classify('crates/mcp/tests/common/grammar.rs'), 'test');
  assert.equal(classify('crates/core/src/engine/status.rs'), 'other');
});

test('close writes the scope record and warns about a team/ file in a code commit', () => {
  const p = project('# T-001\n- Files: crates/core/src/status.rs\n');
  json(node('task.js', ['start', 'T-001'], p.root));
  write(p.root, 'crates/core/src/status.rs', `${RUST}\nfn more() {}\n`);
  write(p.root, 'crates/core/src/lib.rs', 'pub mod status;\npub mod other;\n');
  write(p.root, 'crates/core/src/other.rs', 'fn x() {}\n');
  write(p.root, 'team/work/handoffs/T-001.md', '# T-001\nnote\n');
  p.git('add', 'crates', 'team/work/handoffs/T-001.md');
  p.git('commit', '-q', '-m', 'feat: status');
  const sha = p.git('log', '-1', '--format=%h');
  const out = json(node('task.js', ['close', 'T-001', '--commit', sha], p.root));
  const rec = JSON.parse(fs.readFileSync(path.join(p.root, 'team/metrics/scope-T-001.json'), 'utf8'));
  assert.equal(rec.filesLine, true);
  assert.equal(rec.changed, 3);
  assert.equal(rec.covered, 1);
  assert.equal(rec.coveragePct, 33);
  assert.deepEqual(rec.extras.registration, ['crates/core/src/lib.rs']);
  assert.deepEqual(rec.extras.other, ['crates/core/src/other.rs']);
  assert.deepEqual(rec.teamFiles, [`${sha}: team/work/handoffs/T-001.md`]);
  assert.match(out.warnings.join('\n'), /team\/ files in T-001's code commits .*roles stage only their code paths/);
  assert.equal(p.git('status', '--porcelain', '--', 'team'), '', 'the record is committed with chore(team)');
});

test('close of a clean code task gives no team/ warning', () => {
  const p = project('# T-001\n- Files: crates/core/src/status.rs\n');
  json(node('task.js', ['start', 'T-001'], p.root));
  write(p.root, 'crates/core/src/status.rs', `${RUST}\nfn more() {}\n`);
  const sha = (p.git('add', 'crates'), p.git('commit', '-q', '-m', 'feat'), p.git('log', '-1', '--format=%h'));
  const out = json(node('task.js', ['close', 'T-001', '--commit', sha], p.root));
  assert.doesNotMatch((out.warnings ?? []).join('\n'), /team\/ files/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(p.root, 'team/metrics/scope-T-001.json'), 'utf8')).coveragePct, 100);
});

test('g40: findings.js amend corrects an open finding address with the add checks; pack --ids takes part of a module', () => {
  const p = project('# T-001\n');
  write(p.root, 'crates/core/src/a.rs', 'fn a() {}\n'.repeat(30));
  fs.mkdirSync(path.join(p.root, 'crates/bench/src'), { recursive: true });
  const f1 = addFinding(p.root, { module: 'core', file: 'crates/core/src/status.rs', line: 3, severity: 'hardening', class: 'observed', task: 'T-001', text: 'one', pluginRoot });
  const f2 = addFinding(p.root, { module: 'core', file: 'crates/core/src/a.rs', line: 2, severity: 'hardening', class: 'observed', task: 'T-001', text: 'two', pluginRoot });
  const out = json(node('findings.js', ['amend', f1.id, '--file', 'crates/core/src/a.rs', '--line', '20', '--symbol', 'a'], p.root));
  assert.equal(out.before, 'crates/core/src/status.rs:3');
  assert.equal(out.after, 'crates/core/src/a.rs:20 a');
  const row = listFindings(p.root).find((f) => f.id === f1.id);
  assert.equal(row.file, 'crates/core/src/a.rs');
  assert.equal(row.line, 20);
  assert.match(node('findings.js', ['amend', f1.id, '--file', 'crates/bench/src'], p.root).stderr, /is a directory/);
  assert.match(node('findings.js', ['amend', f1.id], p.root).stderr, /Nothing to amend/);
  json(node('findings.js', ['close', f2.id, '--commit', 'abcdef1'], p.root));
  assert.match(node('findings.js', ['amend', f2.id, '--line', '3'], p.root).stderr, /only an open finding is amended/);
  const f3 = addFinding(p.root, { module: 'core', file: 'crates/core/src/a.rs', line: 5, severity: 'hardening', class: 'observed', task: 'T-001', text: 'three', pluginRoot });
  const pack = json(node('findings.js', ['pack', '--module', 'core', '--ids', f3.id], p.root));
  assert.deepEqual(pack.findings, [f3.id]);
  assert.match(node('findings.js', ['pack', '--module', 'core', '--ids', `${f3.id},F-999`], p.root).stderr, /Not open findings of module core: F-999/);
});

test('g42: board.js update --title retitles an entry; an empty or multi-line title is refused', () => {
  const p = project('# T-001\n');
  json(node('board.js', ['update', 'T-001', '--title', 'project_status extension'], p.root));
  assert.equal(readBoard(p.root).entries[0].title, 'project_status extension');
  assert.match(fs.readFileSync(path.join(p.root, 'team/work/board.md'), 'utf8'), /## T-001: project_status extension/);
  assert.match(node('board.js', ['update', 'T-001', '--title', ' '], p.root).stderr, /one non-empty line/);
});

test('prose: planner Files: line, hand-off outside the code commit, obstacle rule, task-loop names the new commands', () => {
  assert.match(read('agents', 'planner.md'), /one line `Files: <path>, <path> \(new\), \.\.\.`/);
  for (const f of ['backend-developer', 'database-engineer', 'frontend-developer', 'test-engineer']) {
    assert.match(read('agents', `${f}.md`), /The hand-off stays on disk, outside your commit: never stage anything under `team\/`/);
  }
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /`turn-budget` hook counts them from its transcript/);
  assert.match(loop, /team\/metrics\/scope-<id>\.json/);
  assert.match(loop, /findings\.js amend <F-id>/);
  assert.match(loop, /board\.js update <id> --title <text>/);
});
