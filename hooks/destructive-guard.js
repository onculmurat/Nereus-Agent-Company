#!/usr/bin/env node
// PreToolUse for Bash and PowerShell: blocks recursive deletes outside the project root, its worktrees and the temp
// folder, and kills by process name (see scripts/lib/destructive.js). Applies to every role and the lead alike. Outside a NAC project it does nothing.
// If the check itself fails on a command that mentions a delete verb, the call is blocked, not waved through.
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig, checkDeleteRoots } from '../scripts/lib/config.js';
import { checkDestructive, mentionsDelete } from '../scripts/lib/destructive.js';
import { worktreePath } from '../scripts/lib/worktree.js';
import path from 'node:path';

runHook(async (payload, root) => {
  if (payload.tool_name !== 'Bash' && payload.tool_name !== 'PowerShell') return;
  const command = payload.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) return;
  let reason;
  try {
    // g62: a broken config or a bad deleteRoots entry must not switch the guard off; then only the project and the
    // temp folder are allowed
    // g84: gateTmp is the owner's temp folder for the gate's tests (g77, g81); a role removing the tests' leftovers in
    // it was blocked (Memory Agent T-106: rm -rf D:/nac-tmp/t032b-fi-docs-*), so it counts like a deleteRoots folder.
    // A bad gateTmp (a drive root, the home folder) adds nothing.
    let config = {};
    let deleteRoots = [];
    try { config = loadConfig({ pluginRoot, projectRoot: root }); } catch { /* only the project and the temp folder */ }
    try { deleteRoots = checkDeleteRoots(config.deleteRoots); } catch { deleteRoots = []; }
    try { if (config.gateTmp !== undefined) deleteRoots = [...deleteRoots, ...checkDeleteRoots([config.gateTmp])]; } catch { /* nothing added */ }
    // g89: a task's worktree and its target-<id> folder lie beside the project (<project>-wt/, or under worktreeRoot);
    // a developer's rm -rf target in its own worktree was blocked (Memory Agent T-108a). The -wt folder counts too.
    try { deleteRoots = [...deleteRoots, ...checkDeleteRoots([path.dirname(worktreePath(root, 'T-1', { worktreeRoot: config.worktreeRoot }))])]; } catch { /* nothing added */ }
    // g101: CLAUDE_CODE_TMPDIR is Claude Code's own temp folder (the scratchpad lives in it); a developer's rm -rf of a
    // demo folder there was blocked (Memory Agent T-117). The folder itself stays protected.
    try { if (process.env.CLAUDE_CODE_TMPDIR) deleteRoots = [...deleteRoots, ...checkDeleteRoots([process.env.CLAUDE_CODE_TMPDIR])]; } catch { /* nothing added */ }
    reason = checkDestructive(command, { toolName: payload.tool_name, cwd: payload.cwd ?? process.cwd(), root, deleteRoots });
  } catch (e) {
    if (mentionsDelete(command)) reason = `NAC destructive-command guard: the guard could not check this command (${e.message}). Ask the lead, who asks the owner.`;
  }
  if (reason) return { block: reason };
});
