#!/usr/bin/env node
// PostToolUse (every tool): tells a NAC role how many of its turnBudget turns it has used once 5 or fewer are
// left, and to stop and report at the budget (g36). The lead and non-NAC agents get nothing.
import fs from 'node:fs';
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { subagentLog, countTurns, budgetNotice } from '../scripts/lib/budget.js';

const nacRoles = new Set(fs.readdirSync(path.join(pluginRoot, 'agents')).map((f) => f.replace(/\.md$/, '')));

runHook(async (payload, root) => {
  if (!payload.agent_id || typeof payload.agent_type !== 'string') return;
  if (!nacRoles.has(payload.agent_type.replace(/^.*:/, ''))) return;
  const log = subagentLog({ transcriptPath: payload.transcript_path, sessionId: payload.session_id, agentId: payload.agent_id });
  const notice = budgetNotice(countTurns(log), loadConfig({ pluginRoot, projectRoot: root }).turnBudget);
  if (notice) return { output: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notice } } };
});
