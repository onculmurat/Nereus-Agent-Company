#!/usr/bin/env node
// PreToolUse for Bash and PowerShell: a NAC role at its turn budget may not run git commit (g61). The lead and
// non-NAC agents are not checked.
import fs from 'node:fs';
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { subagentLog, countTurns, isGitCommit, budgetCommitBlock } from '../scripts/lib/budget.js';

const nacRoles = new Set(fs.readdirSync(path.join(pluginRoot, 'agents')).map((f) => f.replace(/\.md$/, '')));

runHook(async (payload, root) => {
  if (payload.tool_name !== 'Bash' && payload.tool_name !== 'PowerShell') return;
  if (!payload.agent_id || typeof payload.agent_type !== 'string') return;
  if (!nacRoles.has(payload.agent_type.replace(/^.*:/, ''))) return;
  if (!isGitCommit(payload.tool_input?.command)) return;
  const log = subagentLog({ transcriptPath: payload.transcript_path, sessionId: payload.session_id, agentId: payload.agent_id });
  const reason = budgetCommitBlock(countTurns(log), loadConfig({ pluginRoot, projectRoot: root }).turnBudget);
  if (reason) return { block: reason };
});
