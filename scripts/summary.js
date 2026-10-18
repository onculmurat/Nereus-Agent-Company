#!/usr/bin/env node
// Status CLI: resume summary (default) or phase report data (--phase-report).
import { runCli } from './lib/cli.js';
import { buildResumeSummary, buildPhaseReport } from './lib/summary.js';

const usage = `Usage:
  summary.js [--phase-report] [--project <dir>]
`;

runCli(usage, { 'phase-report': { type: 'boolean' } }, ({ values, root }) =>
  values['phase-report'] ? buildPhaseReport(root) : buildResumeSummary(root));
