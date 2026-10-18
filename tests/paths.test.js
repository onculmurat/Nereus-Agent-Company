import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRoot, teamPaths } from '../scripts/lib/paths.js';

function makeProject(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-paths-'));
  const proj = path.join(root, name);
  fs.mkdirSync(path.join(proj, 'team'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'team', 'config.json'), '{}');
  return proj;
}

test('finds root from nested dir', () => {
  const proj = makeProject('a');
  const nested = path.join(proj, 'src', 'x');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findProjectRoot(nested), proj);
});

test('returns null outside a NAC project', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-empty-'));
  assert.equal(findProjectRoot(empty), null);
});

test('works with spaces in path', () => {
  const proj = makeProject('Personal Vault');
  assert.equal(findProjectRoot(path.join(proj, 'team')), proj);
});

test('teamPaths maps the team layout', () => {
  const r = path.resolve('/x/proj');
  const p = teamPaths(r);
  assert.equal(p.board, path.join(r, 'team', 'work', 'board.md'));
  assert.equal(p.decisions, path.join(r, 'team', 'decisions.md'));
  assert.equal(p.mailbox, path.join(r, 'team', 'work', 'mailbox'));
  assert.equal(p.config, path.join(r, 'team', 'config.json'));
  for (const k of ['team', 'config', 'brief', 'decisions', 'contracts', 'glossary', 'work', 'board', 'handoffs', 'escalations', 'mailbox', 'archive']) {
    assert.ok(path.isAbsolute(p[k]), k);
  }
});
