#!/usr/bin/env node
// Clones a competitor's repository read-only into the research temp folder and prints the folder.
// Usage: node clone.js <https repository URL>
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { execFileSync } from 'node:child_process';
import { cloneTarget, cloneArgs, cloneEnv, isPrivateAddress, researchTmpRoot, tmpRootProblem } from './lib/research.js';

const usage = `Usage:
  clone.js <https repository URL>
`;
const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write(usage);
  process.exit(0);
}
try {
  if (args.length !== 1) throw new Error('Usage: node clone.js <https repository URL>');
  const root = researchTmpRoot();
  const dir = cloneTarget(args[0], root);
  const host = new URL(args[0]).hostname;
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`Refusing to clone from ${host}: it resolves to a private or local address.`);
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const problem = tmpRootProblem(root);
  if (problem) throw new Error(`Refusing to clone: ${problem} (${root}).`);
  execFileSync('git', cloneArgs(args[0], dir), { stdio: ['ignore', 'ignore', 'inherit'], env: cloneEnv(), timeout: 120000 });
  process.stdout.write(`${dir}\n`);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exitCode = 1;
}
