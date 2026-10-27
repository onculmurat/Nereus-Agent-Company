// 1.3.67: g109, every compact hand-off is also written to one fixed path, and the lead is pointed at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeGitProject } from './helpers.js';
import { writeCompactHandoff, latestCompactHandoff } from '../scripts/lib/compact.js';

// Seen live (Memory Agent, 10-28): after an auto compaction the first call carried three earlier compact hand-offs
// (~5k tokens) because the lead had read a new timestamped file after each compaction; only the newest was useful.
test('g109: the latest hand-off is one fixed path; the timestamped copy stays as history', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  const dir = path.join(p.root, 'team', 'work', 'handoffs');
  const first = writeCompactHandoff(p.root, new Date(2026, 0, 1, 1, 0, 1), { trigger: 'manual' });
  const second = writeCompactHandoff(p.root, new Date(2026, 0, 1, 2, 0, 1), { trigger: 'manual' });
  assert.notEqual(first, second);
  assert.ok(fs.existsSync(path.join(dir, first)) && fs.existsSync(path.join(dir, second)));
  assert.equal(latestCompactHandoff(p.root), 'team/work/handoffs/compact.md');
  assert.equal(fs.readFileSync(path.join(dir, 'compact.md'), 'utf8'), fs.readFileSync(path.join(dir, second), 'utf8'));
});

test('g109: a project with only older timestamped hand-offs still gets the newest', () => {
  const p = makeGitProject();
  p.commit('seed.txt');
  const dir = path.join(p.root, 'team', 'work', 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'compact-2026-01-01-010001.md'), 'a');
  fs.writeFileSync(path.join(dir, 'compact-2026-01-02-010001.md'), 'b');
  assert.equal(latestCompactHandoff(p.root), 'team/work/handoffs/compact-2026-01-02-010001.md');
});
