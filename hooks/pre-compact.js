#!/usr/bin/env node
// PreCompact (lead session only): an automatic compaction runs at a clean point or above the token ceiling.
// Manual compaction always runs (and leaves an honest hand-off). Fast and fail-open: any problem allows the compaction.
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { contextTokens, compactDecision, writeCompactHandoff, markCompactionHeld, DEFAULT_CEILING } from '../scripts/lib/compact.js';

runHook(async (payload, root) => {
  if (payload.agent_id || payload.agent_type) return;
  if (payload.trigger === 'manual') return void writeCompactHandoff(root, new Date(), { trigger: 'manual' });
  if (payload.trigger !== 'auto') return;
  const compaction = loadConfig({ pluginRoot, projectRoot: root }).compaction;
  const ceiling = compaction?.ceiling ?? DEFAULT_CEILING;
  const tokens = typeof payload.transcript_path === 'string' ? contextTokens(payload.transcript_path) : null;
  if (tokens === null) return;
  if (tokens >= ceiling) return void writeCompactHandoff(root, new Date(), { trigger: 'ceiling', tokens, ceiling });
  // g32: soft conditions defer it by compaction.softMargin tokens at most; an open owner question up to the ceiling
  const d = compactDecision(payload.session_id, root, tokens, compaction?.softMargin === undefined ? {} : { softMargin: compaction.softMargin });
  if (d.block) {
    markCompactionHeld(root, { tokens, reason: d.block });
    return { block: `NAC: compaction deferred (${tokens} of ${ceiling} tokens). ${d.block} Start no new task until it has run (g108).` };
  }
  writeCompactHandoff(root, new Date(), { trigger: d.allow });
});
