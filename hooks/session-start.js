#!/usr/bin/env node
// SessionStart: makes this session the NAC team lead and tells it where the project stands.
// A teammate's session (payload carries agent_id or agent_type) gets a short reminder instead.
import fs from 'node:fs';
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig, validateConfig } from '../scripts/lib/config.js';
import { buildResumeSummary } from '../scripts/lib/summary.js';
import { hasGuardBlock, hasCompactionSettings } from '../scripts/lib/setup.js';
import { pluginSourceDrift } from '../scripts/lib/drift.js';
import { latestCompactHandoff } from '../scripts/lib/compact.js';
import { proxyContext } from '../scripts/lib/proxy.js';
import { assembleContext } from '../scripts/lib/start-context.js';

const contextOutput = (additionalContext) => ({ output: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } } });

// Only roles that ship an agent file in this release (plus the lead) go into the context.
function shippedModels(models) {
  const shipped = new Set(fs.readdirSync(path.join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
  return Object.fromEntries(Object.entries(models).filter(([role]) => role === 'team-lead' || shipped.has(role)));
}

runHook(async (payload, root) => {
  if (payload.agent_id || payload.agent_type) {
    const role = payload.agent_type ?? 'a NAC role';
    return contextOutput(`You are ${role} on a NAC team, not the team lead. Follow your agent instructions, take work only from the lead, and send questions for the owner to the lead.`);
  }
  let config;
  try {
    config = loadConfig({ pluginRoot, projectRoot: root });
    validateConfig(config);
  } catch (e) {
    // A typo in a config file must not silently turn NAC off: tell the session why it has no lead context.
    return contextOutput(`NAC config error: ${e.message}. Tell the owner, and do not act as the NAC team lead until it is fixed.`);
  }
  const leadFile = path.join(pluginRoot, 'prompts', 'lead.md');
  const lead = fs.readFileSync(leadFile, 'utf8');
  const rules = { rules: config.rules, models: shippedModels(config.models), escalation: config.escalation, maxActiveRoles: config.maxActiveRoles };
  const guardHint = hasGuardBlock(root) ? '' : `\nNo NAC guard in CLAUDE.md. Owner, type once: ! node "${path.join(pluginRoot, 'scripts', 'setup.js')}" --guard-block`;
  // One owner hint at a time keeps the context short: the compaction hint follows once the guard block is in place.
  const compactHint = guardHint || hasCompactionSettings(root) ? '' : `
No autoCompactWindow set. Owner, type once: ! node "${path.join(pluginRoot, 'scripts', 'setup.js')}" --compaction`;
  const compacted = payload.source === 'compact' ? latestCompactHandoff(root) : null;
  const drift = pluginSourceDrift();
  return contextOutput(assembleContext({
    marker: `NAC-LEAD-ACTIVE${guardHint}${compactHint}${drift ? `\n${drift}` : ''}`,
    sections: [
      proxyContext(config),
      `## Resume (session ${payload.source ?? 'startup'})\n\n${compacted ? `Compact hand-off: ${compacted}. Context was just compacted; read it first and carry on.\n\n` : ''}${buildResumeSummary(root)}`,
      `## Resolved rules\n\nPlugin scripts: ${path.join(pluginRoot, 'scripts')}\n\n\`\`\`json\n${JSON.stringify(rules)}\n\`\`\``,
    ],
    lead: lead.trim(),
    leadFile,
  }));
});
