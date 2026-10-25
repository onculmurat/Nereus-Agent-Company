#!/usr/bin/env node
// PreToolUse for Bash and PowerShell: blocks recursive deletes outside the project root and the temp folder
// (see scripts/lib/destructive.js). Applies to every role and the lead alike. Outside a NAC project it does nothing.
// If the check itself fails on a command that mentions a delete verb, the call is blocked, not waved through.
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig, checkDeleteRoots } from '../scripts/lib/config.js';
import { checkDestructive, mentionsDelete } from '../scripts/lib/destructive.js';

runHook(async (payload, root) => {
  if (payload.tool_name !== 'Bash' && payload.tool_name !== 'PowerShell') return;
  const command = payload.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) return;
  let reason;
  try {
    // g62: a broken config or a bad deleteRoots entry must not switch the guard off; then only the project and the
    // temp folder are allowed
    let deleteRoots = [];
    try {
      deleteRoots = checkDeleteRoots(loadConfig({ pluginRoot, projectRoot: root }).deleteRoots);
    } catch {
      deleteRoots = [];
    }
    reason = checkDestructive(command, { toolName: payload.tool_name, cwd: payload.cwd ?? process.cwd(), root, deleteRoots });
  } catch (e) {
    if (mentionsDelete(command)) reason = `NAC destructive-command guard: the guard could not check this command (${e.message}). Ask the lead, who asks the owner.`;
  }
  if (reason) return { block: reason };
});
