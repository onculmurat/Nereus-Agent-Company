#!/usr/bin/env node
// Stop (lead session only): a final message that asks the owner a question in plain chat, without a recommendation,
// skips the checks of decisions.js ask. The lead is sent back once to ask it properly. Fail-open: any problem lets it stop.
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { askedWithoutRecommendation, lastAssistantText } from '../scripts/lib/owner-question.js';

runHook(async (payload) => {
  if (payload.stop_hook_active || payload.agent_id || payload.agent_type) return;
  const text = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message
    : typeof payload.transcript_path === 'string' ? lastAssistantText(payload.transcript_path) : '';
  if (!askedWithoutRecommendation(text)) return;
  const cli = path.join(pluginRoot, 'scripts', 'decisions.js');
  return { block: `Your last message ends with a question to the owner but states no recommendation. Owner questions go through skill question-protocol: record it with node "${cli}" ask (Source, Status, Impact, at least 2 options, exactly one recommendation), then ask it in full with that recommendation. If it was not a question to the owner, say so in one line and stop.` };
});
