#!/usr/bin/env node
// Research CLI: deterministic checks on team/research/ before the phase 1 report. Exits 1 when a check fails.
import { runCli } from './lib/cli.js';
import { checkResearch } from './lib/research-check.js';

const usage = `Usage:
  research-check.js [--project <dir>]
`;

runCli(usage, {}, ({ root }) => {
  const problems = checkResearch(root);
  if (problems.length) process.exitCode = 1;
  return { ok: problems.length === 0, problems };
});
