// The marketplace is a directory source: skills and scripts load from that folder, hooks from the plugin cache
// (installed_plugins.json records the commit the cache was installed from). A commit in the folder after the install
// silently mixes two versions. This compares the two and returns a one-line warning, or '' (also on any problem).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MARKETPLACE = 'nereus-agent-company';
const PLUGIN_KEY = `nac@${MARKETPLACE}`;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

export const defaultPluginsDir = () => process.env.NAC_PLUGINS_DIR || path.join(os.homedir(), '.claude', 'plugins');

export function pluginSourceDrift({ pluginsDir = defaultPluginsDir() } = {}) {
  try {
    const installed = readJson(path.join(pluginsDir, 'installed_plugins.json')).plugins?.[PLUGIN_KEY]?.[0]?.gitCommitSha;
    const market = readJson(path.join(pluginsDir, 'known_marketplaces.json'))[MARKETPLACE];
    const folder = market?.installLocation ?? market?.source?.path;
    if (!/^[0-9a-f]{7,40}$/i.test(installed ?? '') || typeof folder !== 'string') return '';
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    if (!head || head.startsWith(installed) || installed.startsWith(head)) return '';
    return `NAC plugin drift: the installed cache is at ${installed.slice(0, 7)} but ${folder} is at ${head.slice(0, 7)}; skills and scripts load from the folder, hooks from the cache. Fix: git pull in the folder if it is behind, then /plugin update nac (owner).`;
  } catch {
    return '';
  }
}
