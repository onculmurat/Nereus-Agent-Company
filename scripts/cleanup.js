#!/usr/bin/env node
// Mailbox cleanup CLI. Show the dry run to the owner before --apply.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig } from './lib/config.js';
import { planCleanup, applyCleanup } from './lib/cleanup.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node cleanup.js [--project <dir>] --dry-run | --apply\n';

runCli(usage, { 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' } }, ({ values, root }) => {
  if (!values['dry-run'] && !values.apply) throw new UsageError('Pass --dry-run or --apply.');
  const plan = planCleanup(root, loadConfig({ pluginRoot, projectRoot: root }));
  const text = plan.length ? plan.map((p) => `${p.action.padEnd(7)} ${p.thread}  (${p.reason})`).join('\n') + '\n' : 'No threads.\n';
  if (values['dry-run']) return text;
  applyCleanup(root, plan);
  return `Applied:\n${text}`;
});
