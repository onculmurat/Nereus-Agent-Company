#!/usr/bin/env node
// Cost CLI: calls and tokens per role or task from this project's Claude Code transcripts.
import { runCli } from './lib/cli.js';
import { buildCostReport } from './lib/cost.js';

const usage = `Usage:
  cost.js [--since <iso date>] [--by role|task]
          sums input, cache creation, cache read and output tokens and counts calls per role (agent type) or task,
          per model, plus totals and the 5 most expensive dispatches. "Most expensive" is ranked by weighted:
          weighted = input + 1.25 x cache_creation + 0.1 x cache_read + 5 x output (relative to the input price,
          not money); the raw token totals are kept next to it. A task is read from the pack path in the
          dispatch prompt; other dispatches and the lead session are "unassigned".
  (accepts --project <dir>; --transcripts <dir> overrides ~/.claude/projects)
`;

runCli(usage, { since: { type: 'string' }, by: { type: 'string' }, transcripts: { type: 'string' } }, ({ values: v, root }) =>
  buildCostReport(root, { by: v.by, since: v.since, projectsDir: v.transcripts }));
