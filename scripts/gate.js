#!/usr/bin/env node
// Test gate CLI: runs testCommand from team/config.json in the project root. Exits 1 when the tests fail.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { runTestGate, isCodeless, checkDocGate } from './lib/gate.js';

const usage = `Usage:
  gate.js [--task <id>] [--project <dir>]
                      without --task, or when the task has code: runs the testCommand
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
  if (config.testCommand === undefined) {
    throw new UsageError('No testCommand in team/config.json. The planner records it in phase 4; ask the owner if it is unknown.');
  }
  const result = runTestGate(root, config.testCommand);
  if (!result.ok) process.exitCode = 1;
  return result;
});
