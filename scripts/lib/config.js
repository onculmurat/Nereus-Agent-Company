// Resolves NAC config: shipped defaults <- user config <- project team/config.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROXY_SESSION_RE, PROXY_UNTIL_RE } from './proxy.js';

const MODELS = ['haiku', 'sonnet', 'opus'];
const CLEANUP_MODES = ['archive', 'delete'];

export function defaultUserConfigPath() {
  return path.join(os.homedir(), '.claude', 'nac', 'config.json');
}

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
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
    // callBudget is the old name of turnBudget; it counts only when the same layer has no turnBudget
    if (layer && layer.callBudget !== undefined && layer.turnBudget === undefined) layer.turnBudget = layer.callBudget;
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
    turnBudget: cfg.turnBudget,
    ...(cfg.callBudget === undefined ? {} : { callBudget: cfg.callBudget }),
    packMaxChars: cfg.packMaxChars,
    reviewRoundCap: cfg.reviewRoundCap,
    foldInRounds: cfg.foldInRounds,
    findingsBatch: cfg.findingsBatch,
  };
  for (const [key, v] of Object.entries(positive)) {
    if (!Number.isInteger(v) || v < 1) throw new Error(`${key} must be a positive integer; got ${JSON.stringify(v)}`);
  }
  if (!CLEANUP_MODES.includes(cfg.cleanup?.mode)) {
    throw new Error(`cleanup.mode must be one of ${CLEANUP_MODES.join(', ')}; got ${JSON.stringify(cfg.cleanup?.mode)}`);
  }
  if (cfg.testCommand !== undefined && (typeof cfg.testCommand !== 'string' || !cfg.testCommand.trim())) {
    throw new Error(`testCommand must be a non-empty command string; got ${JSON.stringify(cfg.testCommand)}`);
  }
  if (cfg.worktreeRoot !== undefined && (typeof cfg.worktreeRoot !== 'string' || !cfg.worktreeRoot.trim())) {
    throw new Error(`worktreeRoot must be a non-empty directory path; got ${JSON.stringify(cfg.worktreeRoot)}`);
  }
  const op = cfg.ownerProxy;
  if (op !== undefined) {
    if (!op || typeof op !== 'object' || typeof op.session !== 'string' || !PROXY_SESSION_RE.test(op.session)) throw new Error(`ownerProxy.session must be the proxy session name (letters, digits, . _ - and spaces); got ${JSON.stringify(op?.session)}`);
    if (op.until !== undefined && (typeof op.until !== 'string' || !PROXY_UNTIL_RE.test(op.until))) throw new Error(`ownerProxy.until must be a date YYYY-MM-DD; got ${JSON.stringify(op.until)}`);
  }
  const g = cfg.gateCommands;
  if (g !== undefined) {
    if (!Array.isArray(g) || g.length === 0) throw new Error(`gateCommands must be a non-empty list of { name, command }; got ${JSON.stringify(g)}`);
    const names = new Set();
    for (const e of g) {
      const ok = e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim() && typeof e.command === 'string' && e.command.trim();
      if (!ok) throw new Error(`gateCommands entries need a non-empty name and command; got ${JSON.stringify(e)}`);
      if (e.fix !== undefined && !(typeof e.fix === 'string' && e.fix.trim())) throw new Error(`gateCommands "${e.name}": fix must be a non-empty command; got ${JSON.stringify(e.fix)}`);
      if (names.has(e.name)) throw new Error(`gateCommands has the name "${e.name}" twice`);
      names.add(e.name);
    }
  }
  const c = cfg.compaction;
  if (c !== undefined) {
    if (!Number.isInteger(c.autoCompactWindow) || c.autoCompactWindow < 100000) throw new Error(`compaction.autoCompactWindow must be a whole number of at least 100000 tokens; got ${JSON.stringify(c.autoCompactWindow)}`);
    if (!Number.isInteger(c.ceiling) || c.ceiling < 1) throw new Error(`compaction.ceiling must be a positive integer; got ${JSON.stringify(c.ceiling)}`);
    if (c.softMargin !== undefined && (!Number.isInteger(c.softMargin) || c.softMargin < 1)) throw new Error(`compaction.softMargin must be a positive integer; got ${JSON.stringify(c.softMargin)}`);
  }
  if (cfg.rotateEvery !== undefined && (!Number.isInteger(cfg.rotateEvery) || cfg.rotateEvery < 1)) throw new Error(`rotateEvery must be a positive integer; got ${JSON.stringify(cfg.rotateEvery)}`);
  if (cfg.gateWaitSeconds !== undefined && (!Number.isInteger(cfg.gateWaitSeconds) || cfg.gateWaitSeconds < 0)) throw new Error(`gateWaitSeconds must be a whole number of seconds, 0 or more; got ${JSON.stringify(cfg.gateWaitSeconds)}`);
  if (cfg.gateCheckSeconds !== undefined && (!Number.isInteger(cfg.gateCheckSeconds) || cfg.gateCheckSeconds < 0)) throw new Error(`gateCheckSeconds must be a whole number of seconds, 0 (no deadline) or more; got ${JSON.stringify(cfg.gateCheckSeconds)}`);
  const age = cfg.cleanup?.closedThreadMaxAgeDays;
  if (!Number.isInteger(age) || age < 0) throw new Error(`cleanup.closedThreadMaxAgeDays must be a whole number of days, 0 or more; got ${JSON.stringify(age)}`);
}
