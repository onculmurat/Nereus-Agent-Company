// Hook plumbing. A hook must never break a session: outside a NAC project, on bad input or on any
// error it exits 0. It exits 2 only when the handler returns { block }.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProjectRoot } from './paths.js';

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function readStdinJson() {
  // Join the raw chunks before decoding: a multi-byte character can be split across two chunks.
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function runHook(handler) {
  try {
    const payload = await readStdinJson();
    if (!payload) return;
    const root = findProjectRoot(payload.cwd ?? process.cwd());
    if (!root) return;
    const result = await handler(payload, root);
    if (result?.block) {
      process.stderr.write(`${result.block}\n`);
      process.exitCode = 2;
    } else if (result?.output) {
      process.stdout.write(JSON.stringify(result.output));
    }
  } catch (e) {
    process.stderr.write(`NAC hook error (ignored): ${e.message}\n`);
    process.exitCode = 0;
  }
}
