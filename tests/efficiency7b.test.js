// Batch 7 addendum: module findings ledger, pinpoint hardening pack, module-level security gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject, makeGitProject } from './helpers.js';
import { validateConfig } from '../scripts/lib/config.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const cli = (script, root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const find = (root, ...a) => cli('findings.js', root, ...a);
const add = (root, text, o = {}) => find(root, 'add', '--module', o.module ?? 'auth', '--file', o.file ?? 'src/a.js', '--line', String(o.line ?? 3), ...(o.symbol ? ['--symbol', o.symbol] : []),
  '--severity', o.severity ?? 'hardening', '--class', o.cls ?? 'observed', '--task', o.task ?? 'T-001', '--text', text);

test('findingsBatch is 8 by default and validated', () => {
  const d = JSON.parse(read('defaults', 'config.json'));
  assert.equal(d.findingsBatch, 8);
  assert.throws(() => validateConfig({ ...d, findingsBatch: 0 }), /findingsBatch/);
});

test('add stores a row in team/findings/<module>.md and numbers F-001, F-002 across modules', () => {
  const root = makeProject();
  const a = add(root, 'token compared with ==');
  assert.equal(a.status, 0, a.err);
  assert.equal(a.out.id, 'F-001');
  assert.equal(add(root, 'pipe | in text', { module: 'db' }).out.id, 'F-002');
  const md = fs.readFileSync(path.join(root, 'team', 'findings', 'auth.md'), 'utf8');
  assert.match(md, /^\| F-001 \| open \| hardening \| observed \| T-001 \| src\/a\.js:3 \|/m);
  assert.equal(find(root, 'list', '--module', 'db').out[0].text, 'pipe | in text');
});

test('add validates severity, class, line, module and required fields', () => {
  const root = makeProject();
  assert.equal(add(root, 'x', { severity: 'huge' }).status, 1);
  assert.equal(add(root, 'x', { cls: 'maybe' }).status, 1);
  assert.equal(add(root, 'x', { line: 'abc' }).status, 1);
  assert.equal(add(root, 'x', { module: '../x' }).status, 1);
  assert.equal(find(root, 'add', '--module', 'auth').status, 1);
});

test('add reports the open count and when a hardening task is due (findingsBatch)', () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ findingsBatch: 2 }));
  assert.equal(add(root, 'one').out.hardeningDue, false);
  const second = add(root, 'two').out;
  assert.equal(second.open, 2);
  assert.equal(second.hardeningDue, true);
});

test('list filters by module and --open; close records the commit', () => {
  const root = makeProject();
  add(root, 'a');
  add(root, 'b', { module: 'db' });
  assert.equal(find(root, 'list').out.length, 2);
  assert.equal(find(root, 'list', '--module', 'auth').out.length, 1);
  const c = find(root, 'close', 'F-001', '--commit', 'abc1234');
  assert.equal(c.status, 0, c.err);
  assert.equal(c.out.status, 'closed');
  assert.equal(c.out.commit, 'abc1234');
  assert.deepEqual(find(root, 'list', '--open').out.map((f) => f.id), ['F-002']);
  assert.equal(find(root, 'close', 'F-404', '--commit', 'abc1234').status, 1);
  assert.equal(find(root, 'close', 'F-002', '--commit', 'zzz').status, 1);
});

test('pack writes only open findings with the lines around them, impact sites and tests', () => {
  const { root, git } = makeGitProject();
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'tests'));
  const lines = Array.from({ length: 40 }, (_, i) => `line${i + 1}`);
  lines[19] = 'function checkToken(t) { return t == secret; }';
  fs.writeFileSync(path.join(root, 'src', 'a.js'), lines.join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'import { checkToken } from "./a.js";\ncheckToken(x);\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.js'), 'checkToken("t");\n');
  fs.writeFileSync(path.join(root, 'src', 'other.js'), 'unrelated\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'files');
  add(root, 'use constant-time compare', { file: 'src/a.js', line: 20, symbol: 'checkToken' });
  add(root, 'already fixed', { file: 'src/a.js', line: 2 });
  find(root, 'close', 'F-002', '--commit', 'abc1234');
  add(root, 'other module', { module: 'db', file: 'src/other.js', line: 1 });
  const r = find(root, 'pack', '--module', 'auth', '--context', '2');
  assert.equal(r.status, 0, r.err);
  const file = path.join(root, 'team', 'work', 'packs', 'auth-hardening.md');
  assert.equal(path.resolve(r.out.path), path.resolve(file));
  const t = fs.readFileSync(file, 'utf8');
  assert.match(t, /F-001/);
  assert.match(t, /use constant-time compare/);
  assert.match(t, /src\/a\.js:20/);
  assert.match(t, /line18/);
  assert.match(t, /line22/);
  assert.doesNotMatch(t, /line10\b/, 'only +-n lines');
  assert.match(t, /src\/b\.js:1/);
  assert.match(t, /tests\/a\.test\.js:1/);
  assert.doesNotMatch(t, /F-002|already fixed|F-003|unrelated/);
});

test('pack without a symbol uses the enclosing function name when it can find one', () => {
  const { root, git } = makeGitProject();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function verifyPassword(p) {\n  return p == 1;\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'verifyPassword(1);\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'files');
  add(root, 'weak compare', { file: 'src/a.js', line: 2 });
  find(root, 'pack', '--module', 'auth');
  assert.match(fs.readFileSync(path.join(root, 'team', 'work', 'packs', 'auth-hardening.md'), 'utf8'), /src\/b\.js:1/);
});

test('pack refuses a module without open findings and a file outside the project', () => {
  const root = makeProject();
  assert.equal(find(root, 'pack', '--module', 'auth').status, 1);
  add(root, 'x', { file: '../outside.js' });
  assert.equal(find(root, 'pack', '--module', 'auth').status, 1);
});

// Agent and skill text.
const agents = fs.readdirSync(path.join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md'));

test('reviewers classify findings; only blockers go back, the rest go to the ledger; re-review is narrow', () => {
  for (const f of ['code-reviewer.md', 'security-reviewer.md']) {
    const t = read('agents', f);
    assert.match(t, /severity[^\n]*(blocker|hardening|minor)[^\n]*class[^\n]*(observed|known|theoretical)/i, f);
    assert.match(t, /Only a `blocker`[^\n]*fix round[^\n]*findings\.js add[^\n]*does not block/i, f);
    assert.match(t, /re-review[^\n]*only the listed findings and the lines the fix changed/i, f);
  }
});

test('every agent limits a hardening task to the pack addresses and impact sites', () => {
  for (const f of agents) {
    assert.match(read('agents', f), /On a hardening task[^\n]*only the pack's addresses and impact sites[^\n]*do not scan the rest of the module/i, f);
  }
});

test('security-reviewer runs once per module, over the pack and its diff', () => {
  assert.match(read('agents', 'security-reviewer.md'), /once per module[^\n]*hardening task[^\n]*pack and its diff[^\n]*since its last security pass/i);
});

test('planner and task-loop describe the hardening task and the non-blocking rule', () => {
  assert.match(read('agents', 'planner.md'), /hardening task[^\n]*module[^\n]*findings\.js pack/i);
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /only non-blocking findings is done/i);
  assert.match(loop, /findingsBatch/);
  assert.match(loop, /findings\.js" close/);
  assert.match(loop, /nothing re-scans the whole module/i);
});
