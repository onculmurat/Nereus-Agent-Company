#!/usr/bin/env node
// Status CLI: resume summary (default) or phase report data (--phase-report).
import { runCli } from './lib/cli.js';
import { buildResumeSummary, buildPhaseReport } from './lib/summary.js';

const usage = `Usage:
  summary.js [--phase-report [--since <iso date>]] [--project <dir>]
                                         --since limits the cost table to the phase
`;

runCli(usage, { 'phase-report': { type: 'boolean' }, since: { type: 'string' } }, ({ values, root }) =>
  values['phase-report'] ? buildPhaseReport(root, { since: values.since }) : buildResumeSummary(root));
