#!/usr/bin/env node
// PreToolUse (Agent/Task): refuses a developer, database-engineer, reviewer, security, test-engineer or final-reviewer dispatch without a context pack (g22).
// Fails open: an internal error never blocks a dispatch.
import { runHook } from '../scripts/lib/hookio.js';
import { checkDispatch } from '../scripts/lib/pack-guard.js';

runHook(async (payload, root) => {
  try {
    return checkDispatch(root, payload.tool_name, payload.tool_input);
  } catch (e) {
    process.stderr.write(`NAC pack guard error (ignored): ${e.message}\n`);
  }
});
