// 1.3.57: g99, a failed team commit named git's LF/CRLF warning instead of the error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commitPaths } from '../scripts/lib/commit.js';
import { makeGitProject } from './helpers.js';

// Seen live (Memory Agent, 10-27): task.js close T-113 and team-commit.js both said "not committed (warning: in the
// working copy of 'team/decisions.md', LF will be replaced by CRLF ...)"; a plain git commit a few seconds later worked.
test('g99: a failed commit names the git error, not the line-ending warning, after retrying', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  p.git('config', 'core.autocrlf', 'true');
  fs.writeFileSync(path.join(p.root, 'team', 'notes.md'), 'a\nb\n');
  fs.writeFileSync(path.join(p.root, '.git', 'index.lock'), '');
  const r = commitPaths(p.root, ['team'], 'chore(team): x');
  assert.equal(r.committed, false);
  assert.match(r.warning, /index\.lock/);
  assert.doesNotMatch(r.warning, /CRLF/);
  fs.rmSync(path.join(p.root, '.git', 'index.lock'));
  const ok = commitPaths(p.root, ['team'], 'chore(team): x');
  assert.equal(ok.committed, true, ok.warning);
});
