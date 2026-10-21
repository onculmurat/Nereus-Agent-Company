#!/usr/bin/env node
// PreToolUse (AskUserQuestion): with an active owner proxy, owner questions go to the proxy by SendMessage (g47).
// Fails open: an internal error never blocks a question.
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { checkAskUser } from '../scripts/lib/proxy.js';

runHook(async (payload, root) => {
  try {
    if (payload.tool_name !== 'AskUserQuestion' || payload.agent_id) return undefined;
    return checkAskUser(loadConfig({ pluginRoot, projectRoot: root }), payload.tool_input);
  } catch (e) {
    process.stderr.write(`NAC proxy guard error (ignored): ${e.message}\n`);
  }
});
