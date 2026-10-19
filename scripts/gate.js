#!/usr/bin/env node
// Test gate CLI: runs testCommand from team/config.json in the project root. Exits 1 when the tests fail.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { runTestGate } from './lib/gate.js';

const usage = `Usage:
  gate.js [--project <dir>]
`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runCli(usage, {}, ({ root }) => {
  const config = loadConfig({ pluginRoot, projectRoot: root });
  validateConfig(config);
  if (config.testCommand === undefined) {
    throw new UsageError('No testCommand in team/config.json. The planner records it in phase 4; ask the owner if it is unknown.');
  }
  const result = runTestGate(root, config.testCommand);
  if (!result.ok) process.exitCode = 1;
  return result;
});
