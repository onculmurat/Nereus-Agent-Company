// Tasks that produce no code (spikes, research, docs-only): the gate checks the report file, not the test command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { addEntry, readBoard } from '../scripts/lib/board.js';
import { checkDocGate, isCodeless } from '../scripts/lib/gate.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(pluginRoot, 'scripts');
const node = JSON.stringify(process.execPath);
const read = (p) => fs.readFileSync(p, 'utf8');

const GOOD = '# Spike: queue library\n\nVerdict: GO-WITH-CHANGES\n\n## Findings\n\nIt works.\n\n## Acceptance criteria\n\n- throughput above 1000 msg/s: met\n';

// A project whose testCommand leaves a marker file, so a test can see whether the command ran.
function project({ board = true, brief = 'code: no\nOutput: team/work/spike.md\n', report = GOOD } = {}) {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ testCommand: `${node} -e "require('fs').writeFileSync('ran.txt','x')"` }));
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  if (brief !== null) fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-001.md'), `# T-001: Spike\n\n${brief}`);
  if (report !== null) fs.writeFileSync(path.join(root, 'team', 'work', 'spike.md'), report);
  addEntry(root, { title: 'Spike', owner: 'researcher', model: 'sonnet', ...(board ? { code: 'no' } : {}) });
  return root;
}

const gate = (root, ...args) => spawnSync(process.execPath, [path.join(scripts, 'gate.js'), ...args, '--project', root], { encoding: 'utf8' });

test('a board entry can carry code: no, written only for no', () => {
  const root = project();
  assert.equal(readBoard(root).entries[0].code, 'no');
  assert.match(read(path.join(root, 'team', 'work', 'board.md')), /^- code: no$/m);
  const plain = makeProject();
  addEntry(plain, { title: 'Api', owner: 'backend-developer', model: 'sonnet' });
  assert.equal(readBoard(plain).entries[0].code, undefined);
  assert.doesNotMatch(read(path.join(plain, 'team', 'work', 'board.md')), /code:/);
});

test('board add --code no sets the flag and board update --code yes clears it', () => {
  const root = makeProject();
  const run = (...a) => JSON.parse(spawnSync(process.execPath, [path.join(scripts, 'board.js'), ...a, '--project', root], { encoding: 'utf8' }).stdout);
  assert.equal(run('add', '--title', 'Spike', '--owner', 'researcher', '--model', 'sonnet', '--code', 'no').code, 'no');
  assert.equal(run('update', 'T-001', '--code', 'yes').code, undefined);
  assert.equal(readBoard(root).entries[0].code, undefined);
  const bad = spawnSync(process.execPath, [path.join(scripts, 'board.js'), 'add', '--title', 'x', '--owner', 'r', '--model', 'sonnet', '--code', 'maybe', '--project', root], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--code must be yes or no/);
});

test('the flag comes from the board entry or from the brief', () => {
  assert.equal(isCodeless(project({ board: true, brief: null }), 'T-001'), true);
  assert.equal(isCodeless(project({ board: false }), 'T-001'), true);
  assert.equal(isCodeless(project({ board: false, brief: 'Code: no\n' }), 'T-001'), true);
  assert.equal(isCodeless(project({ board: false, brief: '- **code:** no\n' }), 'T-001'), true);
  assert.equal(isCodeless(project({ board: false, brief: 'code: yes\n' }), 'T-001'), false);
  assert.equal(isCodeless(project({ board: false, brief: 'We write no code here, code: none of it\n' }), 'T-001'), false);
  assert.equal(isCodeless(project({ board: false, brief: null }), 'T-001'), false);
});

test('a code-less task passes on its report and does not run the test command', () => {
  const root = project();
  const r = gate(root, '--task', 'T-001');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'document');
  assert.equal(out.verdict, 'GO-WITH-CHANGES');
  assert.equal(out.file, path.join(root, 'team', 'work', 'spike.md'));
  assert.deepEqual(out.problems, []);
  assert.equal(fs.existsSync(path.join(root, 'ran.txt')), false);
});

test('a code-less task needs no testCommand', () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  assert.equal(gate(root, '--task', 'T-001').status, 0);
});

test('GO, GO-WITH-CHANGES and NO-GO are verdicts; other words are not', () => {
  for (const [line, ok] of [['Verdict: GO', true], ['Verdict: NO-GO', true], ['**Verdict:** GO-WITH-CHANGES', true], ['- Verdict: go', false],
    ['Verdict: MAYBE', false], ['Verdict: GO-WITHOUT-CHANGES', false], ['Verdict: GOOD', false], ['Verdict:', false]]) {
    const root = project({ report: GOOD.replace('Verdict: GO-WITH-CHANGES', line) });
    assert.equal(checkDocGate(root, 'T-001').ok, ok, line);
  }
});

test('a verdict word in prose is not a verdict line', () => {
  const root = project({ report: GOOD.replace('Verdict: GO-WITH-CHANGES\n', 'We expect a GO from the owner.\n') });
  const r = checkDocGate(root, 'T-001');
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /verdict/i);
});

test('each missing part is reported by name and the CLI exits 1', () => {
  const noCriteria = project({ report: '# R\n\nVerdict: GO\n\n## Findings\n\nx\n' });
  assert.match(checkDocGate(noCriteria, 'T-001').problems.join('\n'), /acceptance criteria/i);
  const emptyCriteria = project({ report: '# R\n\nVerdict: GO\n\n## Acceptance criteria\n\n## Next\n\nx\n' });
  assert.match(checkDocGate(emptyCriteria, 'T-001').problems.join('\n'), /acceptance criteria/i);
  const missingFile = project({ report: null });
  assert.match(checkDocGate(missingFile, 'T-001').problems.join('\n'), /does not exist/);
  const noOutputLine = project({ brief: 'code: no\n' });
  assert.match(checkDocGate(noOutputLine, 'T-001').problems.join('\n'), /Output:/);
  const noBrief = project({ brief: null });
  assert.match(checkDocGate(noBrief, 'T-001').problems.join('\n'), /brief/);
  const cli = gate(noCriteria, '--task', 'T-001');
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stdout).ok, false);
});

test('the report file must be inside the project', () => {
  const root = project({ brief: 'code: no\nOutput: ../outside.md\n' });
  fs.writeFileSync(path.join(root, '..', 'outside.md'), GOOD);
  const r = checkDocGate(root, 'T-001');
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /inside the project/);
});

test('a task with code still runs the test command, with or without --task', () => {
  const root = project({ board: false, brief: 'Output: team/work/spike.md\n' });
  const r = gate(root, '--task', 'T-001');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).mode, undefined);
  assert.equal(fs.existsSync(path.join(root, 'ran.txt')), true);
  fs.rmSync(path.join(root, 'ran.txt'));
  assert.equal(gate(root).status, 0);
  assert.equal(fs.existsSync(path.join(root, 'ran.txt')), true);
});

test('gate without --task never takes the document path, and an unknown task is an error', () => {
  const root = project();
  gate(root);
  assert.equal(fs.existsSync(path.join(root, 'ran.txt')), true);
  const bad = gate(root, '--task', 'nope!');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Invalid task id/);
});

test('the planner sets the flag and the task loop explains the document gate', () => {
  const planner = read(path.join(pluginRoot, 'agents', 'planner.md'));
  assert.match(planner, /`code: no`/);
  assert.match(planner, /Output: <path>/);
  const loop = read(path.join(pluginRoot, 'skills', 'task-loop', 'SKILL.md'));
  assert.match(loop, /gate\.js" --task <id>/);
  assert.match(loop, /GO-WITH-CHANGES/);
});
