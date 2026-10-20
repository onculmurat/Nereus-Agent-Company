#!/usr/bin/env node
// Cost CLI: calls and tokens per role or task from this project's Claude Code transcripts.
import { runCli } from './lib/cli.js';
import { buildCostReport, saveMetrics } from './lib/cost.js';

const usage = `Usage:
  cost.js [--since <iso date>] [--until <iso date>] [--session <id>] [--task <id>] [--by role|task] [--save | --baseline <name>]
          --session keeps one lead session and its subagents; --until is an inclusive upper bound.
          --task <id> keeps only that task's rows (all roles including lead); with --save the file is
          team/metrics/cost-<id>-<date>-<HHMM>.md and the scope is "task <id>".
          --save writes team/metrics/cost-<date>-<HHMM>.md, appends one JSON line per role/task row to
          team/metrics/cost.jsonl and one summary line to ~/.claude/nac/metrics.md (this machine only).
          --baseline <name> does the same into team/metrics/baseline-<name>.md with scope "baseline".
          sums input, cache creation, cache read and output tokens and counts calls per role (agent type) or task,
          per model, plus totals and the 5 most expensive dispatches. "Most expensive" is ranked by weighted:
          weighted = input + 1.25 x cache_creation + 0.1 x cache_read + 5 x output (relative to the input price,
          not money); the raw token totals are kept next to it. A task is read from the dispatch prompt: the pack path,
          else team/work/tasks/<id>.md, else a hand-off named after a task, else the first T-<n> id in the text;
          otherwise "unassigned". Lead messages take the task of the latest subagent dispatch (by start time, same
          session) at or before them; lead messages before the first dispatch stay "unassigned". packed counts
          dispatches whose prompt names a pack file; a hand-off is not a pack.
  (accepts --project <dir>; --transcripts <dir> overrides ~/.claude/projects)
`;

runCli(usage, { since: { type: 'string' }, until: { type: 'string' }, session: { type: 'string' }, task: { type: 'string' }, by: { type: 'string' }, transcripts: { type: 'string' }, save: { type: 'boolean' }, baseline: { type: 'string' } }, ({ values: v, root }) => {
  const opts = { since: v.since, until: v.until, session: v.session, task: v.task, projectsDir: v.transcripts };
  const report = buildCostReport(root, { by: v.by, ...opts });
  if (!v.save && v.baseline === undefined) return report;
  const { md, jsonl, shared, warnings } = saveMetrics(root, { ...opts, baseline: v.baseline });
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  return { ...report, saved: { md, jsonl, shared }, ...(warnings.length ? { warnings } : {}) };
});
