#!/usr/bin/env node
// Live test, step 1: builds a fresh NAC project with hook recording on. Usage: node prepare.js <new folder>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../scripts/lib/config.js';
import { planSetup, applySetup, PLUGIN_KEY } from '../../scripts/lib/setup.js';
import { addEntry } from '../../scripts/lib/board.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = process.argv[2];

if (!target) {
  process.stderr.write('Usage: node prepare.js <new folder>\n');
  process.exit(1);
}
const root = path.resolve(target);
if (fs.existsSync(root)) {
  process.stderr.write(`${root} already exists; give a new folder so no real project is touched.\n`);
  process.exit(1);
}

fs.mkdirSync(root, { recursive: true });
applySetup(planSetup(root, { pluginRoot, config: loadConfig({ pluginRoot, projectRoot: null }) }));

// The plugin is loaded with --plugin-dir, so the marketplace key is not needed; recording goes to team/work.
const settingsFile = path.join(root, '.claude', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
delete settings.enabledPlugins[PLUGIN_KEY];
settings.env.NAC_HOOK_LOG = path.join(root, 'team', 'work', 'hook-log.jsonl');
fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

addEntry(root, { id: 'T-001', title: 'Live check', owner: 'architect', model: 'opus' });

process.stdout.write(`Prepared ${root}

Start Claude Code there with NAC loaded from this folder:

  cd "${root}"
  claude --plugin-dir "${pluginRoot}"

Then follow tests/live/README.md (paste the prompt, wait, exit) and run:

  node "${path.join(pluginRoot, 'tests', 'live', 'check.js')}" "${root}"
`);
