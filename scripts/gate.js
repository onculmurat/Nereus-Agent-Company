#!/usr/bin/env node
// Test gate CLI: runs gateCommands (or testCommand) from team/config.json in the project root. Exits 1 when the tests fail.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { runGate, gateChecks, isCodeless, checkDocGate } from './lib/gate.js';

const usage = `Usage:
  gate.js [--task <id>] [--project <dir>]
                      without --task, or when the task has code: runs every check of gateCommands (name + command, in order; all are run and reported, any red fails)
                      or the single testCommand when gateCommands is not set
                      a task marked code: no (board entry or brief) is checked on its report file instead:
                      the file named by the brief's "Output: <path>" line exists, has a verdict line
                      (Verdict: GO | GO-WITH-CHANGES | NO-GO) and an acceptance criteria section
`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runCli(usage, { task: { type: 'string' } }, ({ values, root }) => {
  if (values.task !== undefined && isCodeless(root, values.task)) {
    const doc = checkDocGate(root, values.task);
    if (!doc.ok) process.exitCode = 1;
    return doc;
  }
  const config = loadConfig({ pluginRoot, projectRoot: root });
  validateConfig(config);
  const checks = gateChecks(config);
  if (checks.length === 0) {
    throw new UsageError('No testCommand in team/config.json. The planner records it in phase 4; ask the owner if it is unknown.');
  }
  const result = runGate(root, checks);
  if (!result.ok) process.exitCode = 1;
  return result;
});
