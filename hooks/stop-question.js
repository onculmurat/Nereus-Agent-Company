#!/usr/bin/env node
// Stop (lead session only): a final message that mixes a status report with an owner question, or names an open Q-id
// without its own question block, is sent back once too. A final message that asks the owner a question in plain chat, without a recommendation,
// skips the checks of decisions.js ask. The lead is sent back once to ask it properly. Fail-open: any problem lets it stop.
import path from 'node:path';
import { pendingQuestions } from '../scripts/lib/decisions.js';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { askedWithoutRecommendation, buriedQuestionProblem, lastAssistantText } from '../scripts/lib/owner-question.js';

runHook(async (payload, root) => {
  if (payload.stop_hook_active || payload.agent_id || payload.agent_type) return;
  const text = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message
    : typeof payload.transcript_path === 'string' ? lastAssistantText(payload.transcript_path) : '';
  const cli = path.join(pluginRoot, 'scripts', 'decisions.js');
  if (!askedWithoutRecommendation(text)) {
    let ids = [];
    try {
      ids = pendingQuestions(root).filter((x) => x.state !== 'deferred').map((x) => x.id);
    } catch { /* unreadable log: skip this check */ }
    const problem = buriedQuestionProblem(text, ids);
    if (!problem) return;
    return { block: `Your last message is not a clean owner question: ${problem}. Send the status report as its own message first, then ask the question alone in its own message (skill question-protocol: Source, Status, Impact, options, one recommendation, asked in full). If nothing here is a question to the owner, say so in one line and stop.` };
  }
  return { block: `Your last message ends with a question to the owner but states no recommendation. Owner questions go through skill question-protocol: record it with node "${cli}" ask (Source, Status, Impact, at least 2 options, exactly one recommendation), then ask it in full with that recommendation. If it was not a question to the owner, say so in one line and stop.` };
});
