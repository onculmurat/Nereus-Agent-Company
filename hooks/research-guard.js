#!/usr/bin/env node
// PreToolUse: limits the phase 1 research roles (see scripts/lib/research.js). Fails closed: any error
// while checking a research role's call blocks the call, and so does a research role outside a project.
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { researchRole, checkResearchTool } from '../scripts/lib/research.js';

runHook(async (payload, root) => {
  const role = researchRole(payload.agent_type);
  if (!role) return;
  let reason;
  try {
    reason = checkResearchTool({ role, toolName: payload.tool_name, toolInput: payload.tool_input, root, pluginRoot });
  } catch (e) {
    reason = `the guard could not check this call (${e.message})`;
  }
  if (reason) return { block: `NAC research role guard: ${reason}` };
}, { outsideProject: true });
