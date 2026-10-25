#!/usr/bin/env node
// Where a stopped NAC role stands (g63): its turns, whether the usage limit stopped it, and whether to continue it
// with SendMessage (context intact) or re-dispatch it with a fresh pack. Neither is a review round.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli, UsageError } from './lib/cli.js';
import { pluginRoot } from './lib/hookio.js';
import { loadConfig } from './lib/config.js';
import { agentStop, resumeAdvice } from './lib/budget.js';

const usage = `Usage:
  agent-state.js <agentId> [--logs <dir>] [--project <dir>]
    <agentId> is the id in the task notification (<task-id>). --logs is the Claude Code projects folder
    (default ~/.claude/projects).
`;

// <logs>/<project slug>/<session>/subagents/agent-<id>.jsonl
function findLog(logs, id) {
  for (const slug of fs.existsSync(logs) ? fs.readdirSync(logs) : []) {
    const dir = path.join(logs, slug);
    let sessions = [];
    try {
      sessions = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const s of sessions) {
      const file = path.join(dir, s, 'subagents', `agent-${id}.jsonl`);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

runCli(usage, { logs: { type: 'string' } }, ({ values, positionals, root }) => {
  const id = positionals[0];
  if (!/^[A-Za-z0-9-]+$/.test(id ?? '')) throw new UsageError('Give the agent id from the task notification');
  const file = findLog(values.logs ?? path.join(os.homedir(), '.claude', 'projects'), id);
  if (!file) throw new UsageError(`No transcript for agent ${id}`);
  let role = null;
  try {
    role = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType?.replace(/^.*:/, '') ?? null;
  } catch {}
  const budget = loadConfig({ pluginRoot, projectRoot: root }).turnBudget;
  const stop = agentStop(file);
  const { advice, why } = resumeAdvice(stop, budget);
  const next = {
    resume: `After the limit resets: SendMessage to "${id}" with "The usage limit has reset. Continue where you stopped." Not a round.`,
    fresh: `After the limit resets: pack.js <task> --role ${role ?? '<role>'}, then dispatch it again. Not a round.`,
    none: null,
  }[advice];
  return { agentId: id, role, turns: stop.turns, budget, stoppedBy: stop.stoppedBy, message: stop.message, advice, why, ...(next ? { next } : {}) };
});
