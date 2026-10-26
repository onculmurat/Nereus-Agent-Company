#!/usr/bin/env node
// Task CLI (lead only): start | note | close, each one call for the bookkeeping of a task step (g33).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, need, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { startTask, noteTask, closeTask } from './lib/task.js';
import { commitPaths } from './lib/commit.js';

const usage = `Usage:
  task.js start <id> [--worktree] [--role <role>] [--paths <p1,p2>]
                                         board in-progress (same refusals as board.js update), the hand-off skeleton
                                         team/work/handoffs/<id>.md with the base commit, --worktree: worktree.js add and
                                         record it, --role: the role's context pack (pack.js), then one chore(team) commit
  task.js note <id> --text <text> [--heading <h>] [--chore]
                                         appends a section to the task's hand-off (gate result, review verdict, decisions)
                                         --chore: also one chore(team) commit of team/, saves the separate git call (g67)
  task.js close <id> --commit <sha> [--findings <json-file>] [--single-commit <reason>] [--lead-note <text>]
                                         records the findings (a JSON array of {module, file, line, symbol?, severity,
                                         class, text, origin?}), done with the commit and the hand-off (same refusals as
                                         board.js update --status done), the cost file, and when the rotation is due
                                         (every task with compaction; rotateEvery in team/config.json) the lead hand-off
                                         with --lead-note in it; then one chore(team) commit
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const configOf = (root) => {
  const config = loadConfig({ pluginRoot, projectRoot: root });
  validateConfig(config);
  return config;
};

const commands = {
  start: ({ values: v, id, root }) => {
    const r = startTask(root, id, { worktree: v.worktree, worktreeRoot: configOf(root).worktreeRoot, role: v.role, paths: v.paths });
    if (r.pack?.tooLarge) {
      process.stderr.write(`WARNING: pack is ${r.pack.chars} characters, over the limit of ${r.pack.limit} (packMaxChars). Do not dispatch it as is: build it again with pack.js and --paths or a later --base.\n`);
      process.exitCode = 3;
    }
    return r;
  },
  note: ({ values: v, id, root }) => {
    need(v, 'text');
    const r = noteTask(root, id, { text: v.text, heading: v.heading });
    if (!v.chore) return r;
    const c = commitPaths(root, ['team'], `chore(team): ${id} note${v.heading ? `: ${v.heading}` : ''}`);
    if (!c.committed) process.stderr.write(`warning: ${c.warning}
`);
    return { ...r, commit: c.sha ?? null };
  },
  close: ({ values: v, id, root }) => {
    need(v, 'commit');
    if (v['single-commit'] !== undefined && !v['single-commit'].trim()) throw new UsageError('--single-commit needs a reason');
    let findings = [];
    if (v.findings !== undefined) {
      try {
        findings = JSON.parse(fs.readFileSync(path.resolve(root, v.findings), 'utf8').replace(/^﻿/, ''));
      } catch (e) {
        throw new UsageError(`--findings: cannot read a JSON array from ${v.findings} (${e.message})`);
      }
    }
    const r = closeTask(root, id, { commit: v.commit, singleCommit: v['single-commit'], findings, leadNote: v['lead-note'], config: configOf(root), pluginRoot });
    for (const w of r.warnings ?? []) process.stderr.write(`warning: ${w}\n`);
    return r;
  },
};

const options = {
  worktree: { type: 'boolean' }, role: { type: 'string' }, paths: { type: 'string' }, text: { type: 'string' }, heading: { type: 'string' }, chore: { type: 'boolean' },
  commit: { type: 'string' }, findings: { type: 'string' }, 'single-commit': { type: 'string' }, 'lead-note': { type: 'string' },
};

runCli(usage, options, ({ values, positionals: [cmd, id], root }) => {
  if (!commands[cmd]) throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  if (!id) throw new UsageError('Missing task id');
  return commands[cmd]({ values, id, root });
});
