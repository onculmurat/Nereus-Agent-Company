// Hook plumbing. A hook must never break a session: outside a NAC project, on bad input or on any
// error it exits 0. It exits 2 only when the handler returns { block }.
import fs from 'node:fs';
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

// Live test recording: when NAC_HOOK_LOG names a file, every hook call is appended to it as one JSON
// line (payload, outcome, start of the text returned). Recording never affects the hook's result.
function record(payload, root, outcome, text) {
  const file = process.env.NAC_HOOK_LOG;
  if (!file) return;
  try {
    const entry = { time: new Date().toISOString(), event: payload?.hook_event_name, root, payload, outcome, excerpt: (text ?? '').slice(0, 300) };
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // A broken log path must not break the session.
  }
}

export async function runHook(handler) {
  let payload = null;
  let root = null;
  try {
    payload = await readStdinJson();
    if (!payload) return;
    root = findProjectRoot(payload.cwd ?? process.cwd());
    if (!root) return record(payload, null, 'outside-project');
    const result = await handler(payload, root);
    if (result?.block) {
      process.stderr.write(`${result.block}\n`);
      process.exitCode = 2;
      record(payload, root, 'block', result.block);
    } else if (result?.output) {
      process.stdout.write(JSON.stringify(result.output));
      record(payload, root, 'output', result.output.hookSpecificOutput?.additionalContext);
    } else {
      record(payload, root, 'none');
    }
  } catch (e) {
    process.stderr.write(`NAC hook error (ignored): ${e.message}\n`);
    process.exitCode = 0;
    record(payload, root, 'error', e.message);
  }
}
