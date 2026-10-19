#!/usr/bin/env node
// Cost CLI: calls and tokens per role or task from this project's Claude Code transcripts.
import { runCli } from './lib/cli.js';
import { buildCostReport } from './lib/cost.js';

const usage = `Usage:
  cost.js [--since <iso date>] [--by role|task]
          sums input, cache creation, cache read and output tokens and counts calls per role (agent type) or task,
          per model, plus totals and the 5 most expensive dispatches. A task is read from the pack path in the
          dispatch prompt; other dispatches and the lead session are "unassigned".
  (accepts --project <dir>; --transcripts <dir> overrides ~/.claude/projects)
`;

runCli(usage, { since: { type: 'string' }, by: { type: 'string' }, transcripts: { type: 'string' } }, ({ values: v, root }) =>
  buildCostReport(root, { by: v.by, since: v.since, projectsDir: v.transcripts }));
