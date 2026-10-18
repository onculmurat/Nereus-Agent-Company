#!/usr/bin/env node
// TaskCompleted: a native team task whose subject starts with a board id ("T-001: ...") may only
// complete when the board marks it done and its hand-off note exists. The board is the source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { readBoard } from '../scripts/lib/board.js';
import { teamPaths } from '../scripts/lib/paths.js';

runHook(async (payload, root) => {
  const m = /^([A-Za-z0-9-]{1,64}):/.exec(payload.task_subject ?? '');
  if (!m) return;
  const entry = readBoard(root).entries.find((e) => e.id === m[1]);
  if (!entry) return;
  const handoff = path.join(teamPaths(root).handoffs, `${entry.id}.md`);
  let reason = null;
  if (entry.status !== 'done') reason = `board status is "${entry.status}"`;
  else if (!fs.existsSync(handoff)) reason = 'hand-off note is missing';
  if (!reason) return;
  const board = path.join(pluginRoot, 'scripts', 'board.js');
  return {
    block: `${entry.id} is not complete: ${reason}. Mark it done with node "${board}" update ${entry.id} --status done and write team/work/handoffs/${entry.id}.md.`,
  };
});
