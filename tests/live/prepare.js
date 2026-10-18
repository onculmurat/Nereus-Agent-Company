#!/usr/bin/env node
// Live test, step 1: builds a fresh project for one scenario, with hook recording on.
// Usage: node prepare.js <scenario> <new folder>
import fs from 'node:fs';
import path from 'node:path';
import { scenarios, pluginRoot } from './scenarios.js';

const [name, target] = process.argv.slice(2);
const scenario = scenarios[name];
if (!scenario || !target) {
  process.stderr.write(`Usage: node prepare.js <scenario> <new folder>\nScenarios: ${Object.keys(scenarios).join(', ')}\n`);
  process.exit(1);
}
const root = path.resolve(target);
if (fs.existsSync(root)) {
  process.stderr.write(`${root} already exists; give a new folder so no real project is touched.\n`);
  process.exit(1);
}

// Every hook call is appended to .live/hook-log.jsonl; setup keeps this existing settings value.
const live = path.join(root, '.live');
fs.mkdirSync(live, { recursive: true });
fs.mkdirSync(path.join(root, '.claude'));
fs.writeFileSync(path.join(root, '.claude', 'settings.json'), `${JSON.stringify({ env: { NAC_HOOK_LOG: path.join(live, 'hook-log.jsonl') } }, null, 2)}\n`);
fs.writeFileSync(path.join(live, 'scenario'), `${name}\n`);
const state = scenario.prepare(root) ?? {};
fs.writeFileSync(path.join(live, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);

process.stdout.write(`Prepared ${name} in ${root}
${scenario.about}

1. Start Claude Code there with NAC loaded from this folder:

  cd "${root}"
  claude --plugin-dir "${pluginRoot}"

${scenario.steps.map((s, i) => `${i + 2}. ${s}`).join('\n')}

${scenario.steps.length + 2}. Check:

  node "${path.join(pluginRoot, 'tests', 'live', 'check.js')}" "${root}"
`);
