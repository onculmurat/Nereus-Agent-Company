#!/usr/bin/env node
// Clones a competitor's repository read-only into the research temp folder and prints the folder.
// Usage: node clone.js <https repository URL>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cloneTarget, cloneArgs, researchTmpRoot } from './lib/research.js';

const args = process.argv.slice(2);
try {
  if (args.length !== 1) throw new Error('Usage: node clone.js <https repository URL>');
  const dir = cloneTarget(args[0], researchTmpRoot());
  fs.mkdirSync(researchTmpRoot(), { recursive: true });
  execFileSync('git', cloneArgs(args[0], dir), {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
  });
  process.stdout.write(`${dir}\n`);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exitCode = 1;
}
