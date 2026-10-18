#!/usr/bin/env node
// SessionStart: makes this session the NAC team lead and tells it where the project stands.
import fs from 'node:fs';
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { buildResumeSummary } from '../scripts/lib/summary.js';

const contextOutput = (additionalContext) => ({ output: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } } });

runHook(async (payload, root) => {
  let config;
  try {
    config = loadConfig({ pluginRoot, projectRoot: root });
  } catch (e) {
    // A typo in a config file must not silently turn NAC off: tell the session why it has no lead context.
    return contextOutput(`NAC config error: ${e.message}. Tell the owner, and do not act as the NAC team lead until it is fixed.`);
  }
  const lead = fs.readFileSync(path.join(pluginRoot, 'prompts', 'lead.md'), 'utf8');
  const rules = { rules: config.rules, models: config.models, escalation: config.escalation, maxActiveRoles: config.maxActiveRoles };
  const additionalContext = [
    lead.trim(),
    `## Resolved rules\n\nPlugin scripts: ${path.join(pluginRoot, 'scripts')}\n\n\`\`\`json\n${JSON.stringify(rules, null, 2)}\n\`\`\``,
    `## Resume (session ${payload.source ?? 'startup'})\n\n${buildResumeSummary(root)}`,
  ].join('\n\n');
  return contextOutput(additionalContext);
});
