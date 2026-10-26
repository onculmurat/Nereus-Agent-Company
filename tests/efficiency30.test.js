// 1.3.39: g79, briefForbid names in the pack what the project's rules refuse; g80, rotateBy clear stops the next start once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeGitProject } from './helpers.js';
import { runHook, pluginRoot } from './hooks/run-hook.js';
import { addEntry, recordReview } from '../scripts/lib/board.js';
import { briefForbidden } from '../scripts/lib/pack.js';

const node = (script, args, root) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { cwd: root, encoding: 'utf8' });
const json = (r) => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };

function project(config) {
  const p = makeGitProject();
  p.commit('seed.txt');
  for (const id of ['T-001', 'T-002']) {
    addEntry(p.root, { id, title: id, owner: 'backend-developer', model: 'sonnet', size: 'S' });
    recordReview(p.root, id, { role: 'code-reviewer', verdict: 'pass' });
  }
  fs.mkdirSync(path.join(p.root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'tasks', 'T-001.md'), '# T-001\n\nFiles: crates/cli/tests/fuzz_hook.rs pulls in the harness with #[path].\n');
  fs.writeFileSync(path.join(p.root, 'team', 'work', 'tasks', 'T-002.md'), '# T-002\n\nAdd one test.\n');
  fs.writeFileSync(path.join(p.root, 'team', 'config.json'), JSON.stringify(config));
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'board');
  return p;
}

// Seen live (Memory Agent T-101, T-102): both briefs told the role to pull a module in with #[path], which the
// project's unsafe_policy R1 refuses; T-101 lost round 1 to it.
test('g79: a brief naming a briefForbid text comes back as briefForbidden with the rule', () => {
  const forbid = [{ text: '#[path]', rule: 'unsafe_policy R1' }, { text: 'include!', rule: 'unsafe_policy R1' }];
  const p = project({ briefForbid: forbid });
  const out = json(node('task.js', ['start', 'T-001', '--role', 'backend-developer'], p.root));
  assert.equal(out.pack.briefForbidden.length, 1);
  assert.equal(out.pack.briefForbidden[0].rule, 'unsafe_policy R1');
  assert.match(out.pack.note, /fix the brief before you dispatch \(g79\)/);
  const clean = json(node('pack.js', ['T-002', '--role', 'backend-developer'], p.root));
  assert.equal(clean.briefForbidden, undefined);
  assert.deepEqual(briefForbidden('no rule here', forbid), []);
});

// Seen live (Memory Agent, 10-26): with rotateBy clear task.js close printed rotateBy "clear" after T-101 and the lead
// went on to T-102 without asking the owner for /clear, twice.
test('g80: after a rotateBy clear close the next start refuses once; --same-session or a /clear lets it go on', () => {
  const p = project({ rotateBy: 'clear' });
  json(node('task.js', ['start', 'T-001'], p.root));
  const sha = p.commit('code.txt');
  const closed = json(node('task.js', ['close', 'T-001', '--commit', sha, '--lead-note', 'n'], p.root));
  assert.equal(closed.rotateBy, 'clear');
  const marker = path.join(p.root, '.git', 'nac-rotation-pending');
  assert.ok(fs.existsSync(marker));
  const refused = node('task.js', ['start', 'T-002'], p.root);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Rotasyon: \/clear/);
  assert.match(refused.stderr, /--same-session/);
  json(node('task.js', ['start', 'T-002', '--same-session'], p.root));
  assert.ok(!fs.existsSync(marker));
  fs.writeFileSync(marker, 'x\n');
  runHook('session-start', { hook_event_name: 'SessionStart', source: 'clear', session_id: 'g80', cwd: p.root });
  assert.ok(!fs.existsSync(marker));
});

test('g80: a close without rotateBy clear leaves no marker', () => {
  const p = project({ rotateBy: 'compaction' });
  json(node('task.js', ['start', 'T-001'], p.root));
  const sha = p.commit('code.txt');
  json(node('task.js', ['close', 'T-001', '--commit', sha, '--lead-note', 'n'], p.root));
  assert.ok(!fs.existsSync(path.join(p.root, '.git', 'nac-rotation-pending')));
});
