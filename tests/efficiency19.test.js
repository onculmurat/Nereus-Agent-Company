// 1.3.9: a Files: line with notes in parentheses keeps each path whole (g43, T-084 pack showed existing files as new).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeGitProject } from './helpers.js';
import { pluginRoot } from './hooks/run-hook.js';
import { briefFiles, codeMap } from '../scripts/lib/scope.js';

const T084 = '- Files: crates/core/src/data_dir.rs, crates/core/src/store.rs (read only, unless a new constant/arg is needed), crates/cli/src/cli.rs (serve, line ~297-330), crates/cli/src/hook.rs (line ~243), new `crates/cli/tests/data_dir_rejected.rs` (optional), team/work/handoffs/T-084.md';

test('g43: notes in parentheses and a leading "new" do not split or change a Files: path', () => {
  assert.deepEqual(briefFiles(T084), {
    line: true,
    files: ['crates/core/src/data_dir.rs', 'crates/core/src/store.rs', 'crates/cli/src/cli.rs', 'crates/cli/src/hook.rs', 'crates/cli/tests/data_dir_rejected.rs'],
  });
  assert.deepEqual(briefFiles('Files: `a/b.rs` (new), c/d.rs (new, optional)').files, ['a/b.rs', 'c/d.rs']);
});

test('g43: an existing file with a note is mapped, not called new', () => {
  const p = makeGitProject();
  for (const f of ['crates/core/src/store.rs', 'crates/cli/src/cli.rs']) {
    fs.mkdirSync(path.dirname(path.join(p.root, f)), { recursive: true });
    fs.writeFileSync(path.join(p.root, f), 'pub fn open() {}\n');
  }
  const map = codeMap(p.root, '- Files: crates/core/src/store.rs (read only, unless x), crates/cli/src/cli.rs (serve, line ~297)');
  assert.match(map, /### crates\/core\/src\/store\.rs \(1 lines\)/);
  assert.match(map, /### crates\/cli\/src\/cli\.rs \(1 lines\)/);
  assert.doesNotMatch(map, /new file|unless x/);
});

test('g43: the planner writes only paths on the Files: line', () => {
  assert.match(fs.readFileSync(path.join(pluginRoot, 'agents', 'planner.md'), 'utf8'), /Only paths on this line: a note about a file goes on its own line below it/);
});
