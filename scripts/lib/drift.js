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

// Folders that make up the plugin's behaviour. The cache is a plain copy, so a sha record that lags behind (installed_plugins.json
// keeps the old gitCommitSha until /plugin update) is not a difference by itself: compare the version and the files.
const CODE_DIRS = ['.claude-plugin', 'agents', 'commands', 'defaults', 'hooks', 'prompts', 'scripts', 'skills', 'templates'];

function filesUnder(root, dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '.git') filesUnder(root, rel, out);
    } else if (e.isFile()) out.push(rel);
  }
}

const textOf = (file) => fs.readFileSync(file, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

// true when the two trees hold different plugin code; throws on a read problem (the caller treats that as "unknown").
function codeDiffers(cache, source) {
  const list = (root) => {
    const out = [];
    for (const d of CODE_DIRS) filesUnder(root, d, out);
    return out.sort();
  };
  const a = list(cache);
  const b = list(source);
  if (a.length !== b.length || a.some((f, i) => f !== b[i])) return true;
  return a.some((f) => textOf(path.join(cache, f)) !== textOf(path.join(source, f)));
}

const versionOf = (root) => {
  try {
    const v = readJson(path.join(root, '.claude-plugin', 'plugin.json')).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
};

export function pluginSourceDrift({ pluginsDir = defaultPluginsDir() } = {}) {
  try {
    const record = readJson(path.join(pluginsDir, 'installed_plugins.json')).plugins?.[PLUGIN_KEY]?.[0];
    const installed = record?.gitCommitSha;
    const market = readJson(path.join(pluginsDir, 'known_marketplaces.json'))[MARKETPLACE];
    const folder = market?.installLocation ?? market?.source?.path;
    if (!/^[0-9a-f]{7,40}$/i.test(installed ?? '') || typeof folder !== 'string') return '';
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    if (!head || head.startsWith(installed) || installed.startsWith(head)) return '';
    // The shas differ. Compare what is really installed with the folder before raising an alarm (g12).
    const cachePath = typeof record.installPath === 'string' && fs.existsSync(record.installPath) ? record.installPath : null;
    let cacheVersion = null;
    let sourceVersion = null;
    let same = false;
    if (cachePath) {
      try {
        cacheVersion = versionOf(cachePath) ?? (typeof record.version === 'string' ? record.version : null);
        sourceVersion = versionOf(folder);
        same = cacheVersion !== null && cacheVersion === sourceVersion && !codeDiffers(cachePath, folder);
      } catch {
        same = false;
      }
    }
    if (same) return `NAC plugin: sha record stale (cache and ${folder} are both ${cacheVersion}, same files); run /plugin update to refresh it.`;
    const versions = cacheVersion || sourceVersion ? ` Cache version ${cacheVersion ?? 'unknown'}, folder version ${sourceVersion ?? 'unknown'}.` : '';
    return `NAC plugin drift: the installed cache is at ${installed.slice(0, 7)} but ${folder} is at ${head.slice(0, 7)}.${versions} Skills and scripts load from the folder, hooks from the cache. Fix: git pull in the folder if it is behind, then /plugin update nac (owner).`;
  } catch {
    return '';
  }
}
