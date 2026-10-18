#!/usr/bin/env node
// SessionStart: makes this session the NAC team lead and tells it where the project stands.
import fs from 'node:fs';
import path from 'node:path';
import { runHook, pluginRoot } from '../scripts/lib/hookio.js';
import { loadConfig } from '../scripts/lib/config.js';
import { buildResumeSummary } from '../scripts/lib/summary.js';

runHook(async (payload, root) => {
  const config = loadConfig({ pluginRoot, projectRoot: root });
  const lead = fs.readFileSync(path.join(pluginRoot, 'prompts', 'lead.md'), 'utf8');
  const rules = { rules: config.rules, models: config.models, escalation: config.escalation, maxActiveRoles: config.maxActiveRoles };
  const additionalContext = [
    lead.trim(),
    `## Resolved rules\n\nPlugin scripts: ${path.join(pluginRoot, 'scripts')}\n\n\`\`\`json\n${JSON.stringify(rules, null, 2)}\n\`\`\``,
    `## Resume (session ${payload.source ?? 'startup'})\n\n${buildResumeSummary(root)}`,
  ].join('\n\n');
  return { output: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } } };
});
