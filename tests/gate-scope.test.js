import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeGitProject } from './helpers.js';
import { scopePackages, scopeCommand, scopeChecks } from '../scripts/lib/gate.js';

// g55: the gate ran the whole Rust workspace for every task, also when the task touched one leaf crate.
const ws = [
  { name: 'core', dir: 'crates/core', deps: ['api'] },
  { name: 'api', dir: 'crates/api', deps: [] },
  { name: 'mcp', dir: 'crates/mcp', deps: ['core'] },
  { name: 'cli', dir: 'crates/cli', deps: ['mcp'] },
  { name: 'bench', dir: 'crates/bench', deps: [] },
];

test('a change in a leaf package tests only that package', () => {
  assert.deepEqual(scopePackages(['crates/bench/src/run.rs'], ws), { packages: ['bench'] });
});

test('a changed package brings in every package that depends on it, transitively', () => {
  assert.deepEqual(scopePackages(['crates/core/src/lib.rs'], ws), { packages: ['core', 'mcp', 'cli'] });
});

test('documents and agent settings do not widen the scope', () => {
  assert.deepEqual(scopePackages(['crates/mcp/src/a.rs', 'README.md', 'docs/x.txt', '.claude/settings.json'], ws), { packages: ['mcp', 'cli'] });
  assert.match(scopePackages(['README.md'], ws).full, /only documents/);
});

test('a file outside every package (lock file, root manifest) runs the whole workspace', () => {
  assert.match(scopePackages(['crates/bench/src/a.rs', 'Cargo.lock'], ws).full, /Cargo\.lock/);
  assert.match(scopePackages([], ws).full, /no changed files/);
});

test('when every package is in scope it says full instead of listing them all', () => {
  assert.match(scopePackages(['crates/api/src/a.rs', 'crates/bench/src/a.rs'], ws).full, /every workspace package/);
});

test('cargo test and clippy get -p per package and lose --workspace; other checks stay as they are', () => {
  assert.equal(scopeCommand('cargo test', ['mcp', 'cli']), 'cargo test -p mcp -p cli');
  assert.equal(scopeCommand('cargo clippy --workspace --all-targets -- -D warnings', ['mcp']), 'cargo clippy -p mcp --all-targets -- -D warnings');
  assert.equal(scopeCommand('cargo fmt --check', ['mcp']), 'cargo fmt --check');
  assert.equal(scopeCommand('npm test', ['mcp']), 'npm test');
});

test('without a task start commit or a cargo check the gate keeps the whole workspace', () => {
  const { root } = makeGitProject();
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = []\n');
  const cargo = [{ name: 'test', command: 'cargo test' }];
  const r = scopeChecks(root, 'T-001', cargo);
  assert.match(r.scope.full, /T-001 start/);
  assert.equal(r.checks[0].command, 'cargo test');
  assert.match(scopeChecks(root, 'T-001', [{ name: 'test', command: 'npm test' }]).scope.full, /no cargo/);
});
