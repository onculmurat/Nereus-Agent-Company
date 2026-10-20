// 1.3.7: g35, a finding addressed to a directory crashed the hardening pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeGitProject } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const find = (root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'findings.js'), ...args, '--project', root], { encoding: 'utf8' });
  return { status: r.status, out: r.status === 0 && r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const add = (root, file, text) => find(root, 'add', '--module', 'bench', '--file', file, '--line', '1', '--severity', 'hardening', '--class', 'observed', '--task', 'T-001', '--text', text);

// Seen live (T-082): F-254 was recorded at `crates/bench/src:1`; `findings.js pack --module bench` then failed with
// "EISDIR: illegal operation on a directory, read" and the lead had to fix the ledger by hand.
test('g35: add refuses a directory as the finding address', () => {
  const { root } = makeGitProject();
  fs.mkdirSync(path.join(root, 'src'));
  const r = add(root, 'src', 'whole module');
  assert.equal(r.status, 1);
  assert.match(r.err, /--file "src" is a directory; give the file the finding is in/);
});

test('g35: pack keeps going past a recorded directory address and says so', () => {
  const { root, git } = makeGitProject();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.rs'), 'fn run() {}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'files');
  assert.equal(add(root, 'src/later', 'recorded before it became a directory').status, 0);
  assert.equal(add(root, 'src/a.rs', 'real file').status, 0);
  fs.mkdirSync(path.join(root, 'src', 'later'));
  const r = find(root, 'pack', '--module', 'bench');
  assert.equal(r.status, 0, r.err);
  const t = fs.readFileSync(r.out.path, 'utf8');
  assert.match(t, /\(src\/later is a directory, not a file; correct the finding's address\)/);
  assert.match(t, /fn run\(\) \{\}/);
});
