// g36: a role cannot count its own model turns, so the pack's budget line alone let one run into the maxTurns
// hard stop with no report and no commit. The PostToolUse hook counts the turns from the role's transcript.
import fs from 'node:fs';
import path from 'node:path';

export const WARN_TURNS = 5;

// <projects>/<slug>/<session>/subagents/agent-<agent_id>.jsonl, next to the lead's <session>.jsonl.
export function subagentLog({ transcriptPath, sessionId, agentId }) {
  const id = /^[A-Za-z0-9-]+$/;
  if (typeof transcriptPath !== 'string' || !id.test(sessionId ?? '') || !id.test(agentId ?? '')) return null;
  return path.join(path.dirname(transcriptPath), sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

// One turn is one model message; its text and tool_use blocks are saved as separate lines with the same id.
export function countTurns(file) {
  if (!file || !fs.existsSync(file)) return 0;
  const ids = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === 'assistant' && e.message?.id) ids.add(e.message.id);
    } catch {
      // a line being written is skipped
    }
  }
  return ids.size;
}

export function budgetNotice(turns, budget) {
  if (turns >= budget) {
    return `NAC turn budget: you have reached your budget of ${budget} turns (${turns} used); the hard stop comes a few turns later and cuts you off without a report. Stop now: commit only if your tests pass (your own paths), otherwise leave the changes uncommitted, and write your report: what is done, what is left, the files changed and what you need.`;
  }
  if (turns >= budget - WARN_TURNS) {
    return `NAC turn budget: ${turns} of ${budget} turns; ${budget - turns} left. Do not start new work: finish the step you are on, then commit (tests green) and report.`;
  }
  return null;
}
