// 1.3.52: g94, test temp leftovers. Each test run leaves a temp folder (fakeclaude-*, nim-*); testTempDirs names them
// as "<dir>/<prefix>*". task.js close removes the old ones, worktree.js prune --shared all of them when no build runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pluginRoot } from './hooks/run-hook.js';
import { pruneTestTemp, pruneShared } from '../scripts/lib/worktree.js';
import { loadConfig, validateConfig, parseTestTemp } from '../scripts/lib/config.js';
import { makeGitProject } from './helpers.js';

const H = 3600e3;

// Seen live (Memory Agent, 10-26): ~14k fakeclaude-* folders (8 GB) and ~48k nim-* folders (17 GB) in two days.
function leftovers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-g94-'));
  const make = (name, ageH) => {
    const p = path.join(dir, name);
    fs.mkdirSync(p);
    fs.writeFileSync(path.join(p, 'db.sqlite'), 'x');
    const t = new Date(Date.now() - ageH * H);
    fs.utimesSync(p, t, t);
    return p;
  };
  return { dir, old: make('fakeclaude-8288-19', 10), fresh: make('fakeclaude-9708-93', 1), other: make('keep-me', 10) };
}

test('g94: parseTestTemp takes "<abs dir>/<prefix>*" with a prefix of 3+ characters and nothing else', () => {
  const abs = path.join(os.tmpdir(), 'build', 'tmp');
  assert.deepEqual(parseTestTemp(`${abs}/fakeclaude-*`), { dir: abs, prefix: 'fakeclaude-' });
  assert.equal(parseTestTemp(`${abs}/*`), null, 'no prefix would match every folder');
  assert.equal(parseTestTemp(`${abs}/ab*`), null);
  assert.equal(parseTestTemp(`${abs}/nim-*-x*`), null, 'one trailing wildcard only');
  assert.equal(parseTestTemp('build/tmp/nim-*'), null, 'relative');
  assert.equal(parseTestTemp(`${abs}/nim-`), null, 'no wildcard');
});

test('g94: config checks testTempDirs', () => {
  const base = loadConfig({ pluginRoot, userConfigPath: path.join(os.tmpdir(), 'none.json') });
  const validate = (c) => validateConfig({ ...base, ...c });
  validate({ testTempDirs: [path.join(os.tmpdir(), 'x', 'nim-*')] });
  assert.throws(() => validate({ testTempDirs: 'x' }), /testTempDirs/);
  assert.throws(() => validate({ testTempDirs: [path.join(os.tmpdir(), 'x', '*')] }), /testTempDirs/);
  assert.throws(() => validate({ testTempDirs: [path.join(path.parse(process.cwd()).root, 'nim-*')] }), /testTempDirs/, 'a drive root');
  assert.throws(() => validate({ testTempDirs: [path.join(os.homedir(), 'nim-*')] }), /testTempDirs/, 'the home folder');
});

test('g94: pruneTestTemp removes only the prefix, and at close only folders older than 6 h', () => {
  const { dir, old, fresh, other } = leftovers();
  const config = { testTempDirs: [`${dir}/fakeclaude-*`, `${path.join(dir, 'missing')}/nim-*`] };
  assert.deepEqual(pruneTestTemp(config), { removed: 1 });
  assert.ok(!fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other), 'a fresh run (a parallel task) and other names stay');
  assert.deepEqual(pruneTestTemp(config, { minAgeMs: 0 }), { removed: 1 });
  assert.ok(!fs.existsSync(fresh) && fs.existsSync(other));
});

test('g94: prune --shared removes every leftover when no build runs, none while one does', () => {
  const { root } = makeGitProject();
  const { dir, old, fresh } = leftovers();
  const config = { testTempDirs: [`${dir}/fakeclaude-*`] };
  const busy = pruneShared(root, config, { list: () => [{ pid: 7, ppid: 1, cmd: 'cargo.exe test' }] });
  assert.equal(busy.ok, false);
  assert.ok(fs.existsSync(old) && fs.existsSync(fresh));
  const r = pruneShared(root, config, { list: () => [] });
  assert.equal(r.testTempRemoved, 2);
  assert.ok(!fs.existsSync(old) && !fs.existsSync(fresh));
});
