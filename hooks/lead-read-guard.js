#!/usr/bin/env node
// PreToolUse (Read): the lead does not read source files or large files whole (g48). Roles are not touched.
// Fails open: an internal error never blocks a read.
import { runHook } from '../scripts/lib/hookio.js';
import { checkLeadRead } from '../scripts/lib/lead-read.js';

runHook(async (payload, root) => {
  try {
    if (payload.tool_name !== 'Read' || payload.agent_id || payload.agent_type) return undefined;
    return checkLeadRead(payload.tool_input, root);
  } catch (e) {
    process.stderr.write(`NAC lead read guard error (ignored): ${e.message}\n`);
  }
});
