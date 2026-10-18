// Shared CLI plumbing: argument parsing, project resolution, JSON output, usage errors.
import { parseArgs } from 'node:util';
import { findProjectRoot } from './paths.js';

export class UsageError extends Error {}

export function runCli(usage, options, handler) {
  try {
    const { values, positionals } = parseArgs({ options: { project: { type: 'string' }, ...options }, allowPositionals: true });
    const root = values.project ?? findProjectRoot(process.cwd());
    if (!root) throw new UsageError('Not inside a NAC project (no team/config.json found). Pass --project <dir>.');
    const result = handler({ values, positionals, root });
    if (result !== undefined) process.stdout.write(typeof result === 'string' ? result : `${JSON.stringify(result, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n${e instanceof UsageError || e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ? usage : ''}`);
    process.exitCode = 1;
  }
}

export function need(values, ...keys) {
  for (const k of keys) if (values[k] === undefined) throw new UsageError(`Missing --${k}`);
}
