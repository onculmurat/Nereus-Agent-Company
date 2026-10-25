#!/usr/bin/env node
// PostToolUse (every tool): tells a NAC role how many of its turnBudget turns it has used once 5 or fewer are
// left, and to stop and report at the budget (g36); the stop is recorded for board.js round (g60). The lead and
// non-NAC agents get nothing.
import fs from 'node:fs';
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { subagentLog, countTurns, budgetNotice, recordBudgetStop } from '../scripts/lib/budget.js';

const nacRoles = new Set(fs.readdirSync(path.join(pluginRoot, 'agents')).map((f) => f.replace(/\.md$/, '')));

runHook(async (payload, root) => {
  if (!payload.agent_id || typeof payload.agent_type !== 'string') return;
  if (!nacRoles.has(payload.agent_type.replace(/^.*:/, ''))) return;
  const log = subagentLog({ transcriptPath: payload.transcript_path, sessionId: payload.session_id, agentId: payload.agent_id });
  const turns = countTurns(log);
  const budget = loadConfig({ pluginRoot, projectRoot: root }).turnBudget;
  // g60: the stop is recorded so board.js round --reason stuck can refuse it
  if (turns >= budget) recordBudgetStop(root, { role: payload.agent_type.replace(/^.*:/, ''), agentId: payload.agent_id, turns });
  const notice = budgetNotice(turns, budget);
  if (notice) return { output: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notice } } };
});
