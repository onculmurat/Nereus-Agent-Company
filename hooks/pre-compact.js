#!/usr/bin/env node
// PreCompact (lead session only): an automatic compaction runs at a clean point or above the token ceiling.
// Manual compaction always runs. Fast and fail-open: any problem allows the compaction.
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { contextTokens, cachedBlocker, writeCompactHandoff, DEFAULT_CEILING } from '../scripts/lib/compact.js';

runHook(async (payload, root) => {
  if (payload.trigger !== 'auto' || payload.agent_id || payload.agent_type) return;
  const ceiling = loadConfig({ pluginRoot, projectRoot: root }).compaction?.ceiling ?? DEFAULT_CEILING;
  const tokens = typeof payload.transcript_path === 'string' ? contextTokens(payload.transcript_path) : null;
  if (tokens === null) return;
  if (tokens >= ceiling) return void writeCompactHandoff(root);
  const reason = cachedBlocker(payload.session_id, root);
  if (reason) return { block: `NAC: compaction deferred (${tokens} of ${ceiling} tokens). ${reason}` };
  writeCompactHandoff(root);
});
