import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { parseRefs, extractSection, buildPack, writePack } from '../scripts/lib/pack.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(pluginRoot, 'scripts', 'pack.js');

// Header shape taken from a real brief (Turkish, bold section numbers, contract and threat refs on one line).
const BRIEF = `# T-018d: Handle-tabanli FinalPath

- rol: backend-developer | boyut: M | bagimlilik: T-018, T-018c
- Kararlar: D-086 (handle-tabanli FinalPath), D-087 (OnceLock), D-086 again, D-999 (missing).
- Spec: **5.4** (snippet okuma, N1), **2.3 adim 2** (mesaj metni), **3** (crate listesi), **9.9** (absent); mcp-tools 1.3; threat-model T5, N1, T77; storage-schema 2; ghost-file 4.

## Hedef
Do the thing.
`;

const SPEC = `# Spec

## 2. Mimari

### 2.3 Yerel yol
Path text 2.3.

### 2.4 Next
Other 2.4.

## 3. Dil
Dil text.

### 3.1 Sub
Sub text.

## 5. Indeks

### 5.4 Snippet okuma
Snippet body.

#### 5.4.1 deeper
Deeper body.

### 5.5 After
After body.
`;

const CONTRACT = `# Contract

## 1. General

### 1.2 Budget
Budget text.

### 1.3 Paths
Paths text.

### 1.4 Token
Token text.
`;

const THREAT = `# Threat model

| # | Attack | Fix |
|---|---|---|
| T5 | Path traversal | realpath |
| T6 | Wide root | reject |
`;

const DECISIONS = `# Decisions

## Open questions

### Q-001: Open one
- source: x

## Decided

### D-086: Handle based
- answer: new task
- date: 2026-10-19

### D-087: OnceLock
- answer: yes
`;

function project() {
  const root = makeProject();
  const team = path.join(root, 'team');
  fs.mkdirSync(path.join(team, 'work', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(team, 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(team, 'work', 'tasks', 'T-018d.md'), BRIEF);
  fs.writeFileSync(path.join(team, 'spec.md'), SPEC);
  fs.writeFileSync(path.join(team, 'contracts', 'mcp-tools.md'), CONTRACT);
  fs.writeFileSync(path.join(team, 'contracts', 'storage-schema.md'), '# Storage\n\n## 2. Tables\nTable text.\n\n## 3. Other\nNo.\n');
  fs.writeFileSync(path.join(team, 'threat-model.md'), THREAT);
  fs.writeFileSync(path.join(team, 'decisions.md'), DECISIONS);
  return root;
}

test('parseRefs reads spec sections, contract refs, threat ids and decision ids from a Turkish-ish header', () => {
  const r = parseRefs(BRIEF);
  assert.deepEqual(r.specSections, ['5.4', '2.3', '3', '9.9']);
  assert.deepEqual(r.contracts, [{ name: 'mcp-tools', section: '1.3' }, { name: 'storage-schema', section: '2' }, { name: 'ghost-file', section: '4' }]);
  assert.deepEqual(r.threats, ['T5', 'N1', 'T77']);
  assert.deepEqual(r.decisions, ['D-086', 'D-087', 'D-999']);
});

test('parseRefs finds nothing in a brief without references', () => {
  assert.deepEqual(parseRefs('# T-1\n\nJust text, step 2 and phase 3.\n'), { specSections: [], contracts: [], threats: [], decisions: [] });
});

test('extractSection returns the heading and its body up to the next heading of the same or higher level', () => {
  assert.equal(extractSection(SPEC, '5.4'), '### 5.4 Snippet okuma\nSnippet body.\n\n#### 5.4.1 deeper\nDeeper body.');
  assert.equal(extractSection(SPEC, '2.3'), '### 2.3 Yerel yol\nPath text 2.3.');
  assert.match(extractSection(SPEC, '3'), /^## 3\. Dil[\s\S]*### 3\.1 Sub\nSub text\.$/);
  assert.equal(extractSection(SPEC, '7.7'), null);
});

test('pack holds the brief verbatim, then sections, then decisions, in that order', () => {
  const { text, notFound } = buildPack(project(), { id: 'T-018d', role: 'backend-developer' });
  assert.ok(text.includes(BRIEF.trimEnd()));
  const at = (s) => text.indexOf(s);
  assert.ok(at('Do the thing.') < at('Snippet body.'));
  assert.ok(at('Snippet body.') < at('Path text 2.3.'), 'sections follow the order of the brief');
  assert.ok(at('Path text 2.3.') < at('Dil text.'));
  assert.ok(at('Dil text.') < at('Paths text.'));
  assert.ok(at('Paths text.') < at('Table text.'));
  assert.ok(at('Table text.') < at('| T5 | Path traversal | realpath |'));
  assert.ok(at('| T5 | Path traversal | realpath |') < at('### D-086: Handle based'));
  assert.ok(at('### D-086: Handle based') < at('### D-087: OnceLock'));
  assert.ok(text.includes('- answer: new task'));
  assert.ok(!text.includes('Other 2.4.') && !text.includes('Token text.') && !text.includes('| T6 |') && !text.includes('Open one'));
  assert.equal((text.match(/### D-086: Handle based/g) ?? []).length, 1, 'a decision repeated in the brief is included once');
  assert.ok(Array.isArray(notFound));
});

test('references that cannot be found are listed under Not found and do not fail the pack', () => {
  const { text, notFound } = buildPack(project(), { id: 'T-018d', role: 'backend-developer' });
  assert.deepEqual(notFound, ['spec 9.9', 'contract ghost-file 4', 'threat N1', 'threat T77', 'decision D-999']);
  const tail = text.split('\n## Not found\n')[1];
  assert.ok(tail, 'has a Not found section');
  for (const n of notFound) assert.ok(tail.includes(`- ${n}`), n);
});

test('a pack with every reference found has no Not found section', () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-1.md'), '# T-1\n\nplain\n');
  const { text, notFound } = buildPack(root, { id: 'T-1', role: 'code-reviewer' });
  assert.deepEqual(notFound, []);
  assert.ok(!text.includes('Not found'));
});

test('a missing brief is an error that names the path', () => {
  assert.throws(() => buildPack(makeProject(), { id: 'T-5', role: 'x' }), /T-5\.md/);
});

test('invalid ids and roles are rejected', () => {
  const root = project();
  assert.throws(() => buildPack(root, { id: '../x', role: 'a' }), /Invalid task id/);
  assert.throws(() => buildPack(root, { id: 'T-018d', role: '../a' }), /Invalid role/);
});

function gitRepo() {
  const root = project();
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'change');
  return { root, base };
}

test('--base adds the git diff against that commit after the decisions', () => {
  const { root, base } = gitRepo();
  const { text } = buildPack(root, { id: 'T-018d', role: 'code-reviewer', base });
  const diff = text.split(`\n## Diff against ${base}\n`)[1];
  assert.ok(diff, 'has a diff section');
  assert.match(diff, /\+two/);
  assert.ok(text.indexOf('### D-087: OnceLock') < text.indexOf('## Diff against'));
  assert.ok(!buildPack(root, { id: 'T-018d', role: 'code-reviewer' }).text.includes('## Diff against'));
});

test('a bad base is an error, not an empty diff', () => {
  const { root } = gitRepo();
  assert.throws(() => buildPack(root, { id: 'T-018d', role: 'code-reviewer', base: 'nosuchrev' }), /git diff/);
  assert.throws(() => buildPack(root, { id: 'T-018d', role: 'code-reviewer', base: '--output=x' }), /Invalid base/);
});

test('--gate adds the tail of the gate output last', () => {
  const root = project();
  const gate = path.join(root, 'gate.txt');
  fs.writeFileSync(gate, Array.from({ length: 200 }, (_, i) => `gate line ${i + 1}`).join('\n'));
  const { text } = buildPack(root, { id: 'T-018d', role: 'code-reviewer', gate });
  const tail = text.split('\n## Gate output (tail)\n')[1];
  assert.ok(tail.includes('gate line 200'));
  assert.ok(!tail.includes('gate line 1\n'));
  assert.ok(tail.split('\n').length <= 70);
});

test('writePack writes team/work/packs/<id>-<role>.md and reports its size', () => {
  const root = project();
  const r = writePack(root, { id: 'T-018d', role: 'backend-developer' });
  assert.equal(r.path, path.join(root, 'team', 'work', 'packs', 'T-018d-backend-developer.md'));
  const content = fs.readFileSync(r.path, 'utf8');
  assert.equal(r.chars, content.length);
});

test('cli prints the pack path and character count', () => {
  const root = project();
  const r = spawnSync(process.execPath, [cli, 'T-018d', '--role', 'backend-developer', '--project', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.path, path.join(root, 'team', 'work', 'packs', 'T-018d-backend-developer.md'));
  assert.ok(out.chars > 100);
  assert.ok(fs.existsSync(out.path));
  const noRole = spawnSync(process.execPath, [cli, 'T-018d', '--project', root], { encoding: 'utf8' });
  assert.equal(noRole.status, 1);
});

// Delta mode: fix rounds and re-reviews get the findings, the diff since the previous attempt and the acceptance criteria only.
const DELTA_BRIEF = `${BRIEF}
## Kabul kriterleri
- Criterion alpha holds.
- Criterion beta holds.

## Notlar
Background note that must not be repeated.
`;

function deltaRepo() {
  const { root, base } = gitRepo();
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-018d.md'), DELTA_BRIEF);
  const findings = path.join(root, 'findings.md');
  fs.writeFileSync(findings, '1. Missing null check in a.txt\n2. Name is unclear\n');
  return { root, base, findings };
}

test('delta pack holds the findings, the diff since the previous attempt and only the acceptance criteria', () => {
  const { root, base, findings } = deltaRepo();
  const { text } = buildPack(root, { id: 'T-018d', role: 'backend-developer', round: 2, findings, base });
  assert.match(text, /^# Pack: T-018d for backend-developer \(round 2, delta\)/);
  assert.match(text, /Budget: 40 model turns/);
  assert.ok(text.includes('## Findings\n\n1. Missing null check in a.txt'));
  assert.ok(text.includes('## Acceptance criteria\n\n## Kabul kriterleri\n- Criterion alpha holds.\n- Criterion beta holds.'));
  assert.match(text.split(`\n## Diff since ${base}\n`)[1], /\+two/);
  for (const absent of ['## Task brief', '## Spec', 'Background note', 'Hedef', 'Do the thing', '## Decisions', '## Threat']) {
    assert.ok(!text.includes(absent), `delta pack must not hold "${absent}"`);
  }
});

test('delta pack is much smaller than the full pack', () => {
  const { root, base, findings } = deltaRepo();
  const full = buildPack(root, { id: 'T-018d', role: 'backend-developer', base }).text;
  const delta = buildPack(root, { id: 'T-018d', role: 'backend-developer', round: 2, findings, base }).text;
  assert.ok(delta.length < full.length / 2, `${delta.length} vs ${full.length}`);
});

test('delta pack can carry the gate output instead of findings, and says so when the brief has no acceptance criteria', () => {
  const { root, base } = deltaRepo();
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-018d.md'), BRIEF);
  const gate = path.join(root, 'gate.txt');
  fs.writeFileSync(gate, 'not ok 1 - broken\n');
  const { text, notFound } = buildPack(root, { id: 'T-018d', role: 'backend-developer', round: 3, gate, base });
  assert.ok(text.includes('## Gate output (tail)'));
  assert.ok(!text.includes('## Findings'));
  assert.deepEqual(notFound, ['acceptance criteria']);
  assert.match(text, /## Acceptance criteria\n\nNot found in the brief/);
});

test('delta mode needs a round, findings or a gate, and a base', () => {
  const { root, base, findings } = deltaRepo();
  assert.throws(() => buildPack(root, { id: 'T-018d', role: 'a', round: 0, findings, base }), /Invalid round/);
  assert.throws(() => buildPack(root, { id: 'T-018d', role: 'a', round: 2, base }), /--findings or --gate/);
  assert.throws(() => buildPack(root, { id: 'T-018d', role: 'a', round: 2, findings }), /--base/);
  assert.throws(() => buildPack(root, { id: 'T-018d', role: 'a', round: 2, findings: path.join(root, 'none.md'), base }), /findings/);
  assert.throws(() => buildPack(root, { id: 'T-018d', role: 'a', findings, base }), /--round/);
});

test('delta pack is written to <id>-<role>-r<round>.md and the cli accepts --round, --findings and --base', () => {
  const { root, base, findings } = deltaRepo();
  const r = spawnSync(process.execPath, [cli, 'T-018d', '--role', 'code-reviewer', '--round', '2', '--findings', findings, '--base', base, '--project', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.path, path.join(root, 'team', 'work', 'packs', 'T-018d-code-reviewer-r2.md'));
  assert.match(fs.readFileSync(out.path, 'utf8'), /round 2, delta/);
});
