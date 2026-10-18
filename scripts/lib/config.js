// Resolves NAC config: shipped defaults <- user config <- project team/config.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODELS = ['haiku', 'sonnet', 'opus'];

export function defaultUserConfigPath() {
  return path.join(os.homedir(), '.claude', 'nac', 'config.json');
}

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : structuredClone(v);
  return out;
}

export function loadConfig({ pluginRoot, userConfigPath = defaultUserConfigPath(), projectRoot }) {
  let cfg = readJson(path.join(pluginRoot, 'defaults', 'config.json'));
  for (const file of [userConfigPath, projectRoot && path.join(projectRoot, 'team', 'config.json')]) {
    const layer = readJson(file);
    if (layer) cfg = merge(cfg, layer);
  }
  return cfg;
}

export function validateConfig(cfg) {
  for (const [role, model] of Object.entries(cfg.models ?? {})) {
    if (!MODELS.includes(model)) throw new Error(`models.${role} must be one of ${MODELS.join(', ')}; got "${model}"`);
  }
  for (const model of cfg.modelLadder ?? []) {
    if (!MODELS.includes(model)) throw new Error(`modelLadder contains unknown model "${model}"`);
  }
  const positive = {
    'escalation.modelRounds': cfg.escalation?.modelRounds,
    'escalation.authorityRounds': cfg.escalation?.authorityRounds,
    'escalation.leadRounds': cfg.escalation?.leadRounds,
    maxActiveRoles: cfg.maxActiveRoles,
  };
  for (const [key, v] of Object.entries(positive)) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`${key} must be a positive integer; got ${JSON.stringify(v)}`);
  }
}
