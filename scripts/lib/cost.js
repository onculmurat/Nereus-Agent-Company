// Per-dispatch cost: sums message.usage from the Claude Code transcripts of this project.
// Main session: <projects>/<slug>/*.jsonl. Subagents: <projects>/<slug>/<session>/subagents/agent-*.jsonl with
// agent-*.meta.json (agent type). A subagent's first user message is the dispatch prompt, which names the pack file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOP = 5;
const BY = ['role', 'task'];
const FIELDS = ['inputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'outputTokens'];

export const defaultProjectsDir = () => path.join(os.homedir(), '.claude', 'projects');

// Claude Code names a project's folder after its absolute path with separators and spaces turned into dashes.
export const projectSlug = (absPath) => absPath.replace(/[:\\/ ]/g, '-');

function knownRoles() {
  try {
    return fs.readdirSync(path.join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

// The task id from the first pack path in a dispatch prompt: team/work/packs/<id>-<role>[-r<n>].md.
export function taskFromPrompt(text) {
  const m = /team[\\/]+work[\\/]+packs[\\/]+([^\s"'`<>|*?\\/]+?)\.md/.exec(text ?? '');
  if (!m) return 'unassigned';
  const name = m[1].replace(/-r\d+$/, '');
  const role = knownRoles().filter((r) => name.endsWith(`-${r}`)).sort((a, b) => b.length - a.length)[0];
  if (role) return name.slice(0, -(role.length + 1)) || 'unassigned';
  return /^([A-Za-z]+-\d+[A-Za-z]*)/.exec(name)?.[1] ?? 'unassigned';
}

function readLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch { /* a damaged line is skipped */ }
  }
  return out;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n');
  return '';
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// One entry per API message: Claude Code writes a message once per content block, all with the same id.
function messagesOf(records, since) {
  const byId = new Map();
  let anon = 0;
  for (const rec of records) {
    const msg = rec?.type === 'assistant' ? rec.message : null;
    const usage = msg?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const t = Date.parse(rec.timestamp);
    if (since !== undefined && !(t >= since)) continue;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    byId.set(msg.id ?? `anon-${anon++}`, {
      model: msg.model ?? 'unknown',
      inputTokens: num(usage.input_tokens),
      cacheCreationTokens: num(usage.cache_creation_input_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      outputTokens: num(usage.output_tokens),
    });
  }
  return [...byId.values()];
}

const roleOf = (agentType) => (typeof agentType === 'string' && agentType ? agentType.replace(/^nac:/, '') : 'unknown');

// Project folders: the slug folder and the worktree folders of parallel tasks (<slug>-wt-<id>).
function projectDirs(root, projectsDir) {
  const slug = projectSlug(path.resolve(root));
  let names = [];
  try {
    names = fs.readdirSync(projectsDir);
  } catch { /* no transcripts yet */ }
  return names.filter((n) => n === slug || n.startsWith(`${slug}-wt-`)).map((n) => path.join(projectsDir, n));
}

function collect(dirs, since) {
  const items = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        for (const m of messagesOf(readLines(path.join(dir, e.name)), since)) items.push({ ...m, role: 'lead', task: 'unassigned', agentId: null });
      } else if (e.isDirectory()) {
        const subDir = path.join(dir, e.name, 'subagents');
        let files = [];
        try {
          files = fs.readdirSync(subDir).filter((f) => /^agent-.+\.jsonl$/.test(f));
        } catch { continue; }
        for (const f of files) {
          const base = f.slice(0, -'.jsonl'.length);
          const meta = readJson(path.join(subDir, `${base}.meta.json`));
          const records = readLines(path.join(subDir, f));
          const first = records.find((r) => r?.type === 'user');
          const task = taskFromPrompt(textOf(first?.message?.content));
          const role = roleOf(meta.agentType);
          for (const m of messagesOf(records, since)) {
            items.push({ ...m, role, task, agentId: base.slice('agent-'.length), description: meta.description ?? '' });
          }
        }
      }
    }
  }
  return items;
}

const total = (x) => FIELDS.reduce((a, f) => a + x[f], 0);
const zero = () => ({ calls: 0, inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 });
function add(acc, m) {
  acc.calls += 1;
  for (const f of FIELDS) acc[f] += m[f];
}

export function buildCostReport(root, { by = 'role', since, projectsDir = defaultProjectsDir() } = {}) {
  if (!BY.includes(by)) throw new Error(`--by must be one of ${BY.join(', ')}; got "${by}"`);
  let sinceMs;
  if (since !== undefined) {
    sinceMs = Date.parse(since);
    if (Number.isNaN(sinceMs)) throw new Error(`Invalid --since "${since}": use an ISO date such as 2026-10-01T00:00:00Z`);
  }
  const items = collect(projectDirs(root, projectsDir), sinceMs);

  const groups = new Map();
  const totals = zero();
  const dispatches = new Map();
  for (const m of items) {
    const key = by === 'role' ? m.role : m.task;
    const gk = `${key}\u0000${m.model}`;
    if (!groups.has(gk)) groups.set(gk, { key, model: m.model, ...zero() });
    add(groups.get(gk), m);
    add(totals, m);
    if (m.agentId) {
      if (!dispatches.has(m.agentId)) dispatches.set(m.agentId, { agentId: m.agentId, role: m.role, task: m.task, description: m.description, model: m.model, ...zero() });
      add(dispatches.get(m.agentId), m);
    }
  }
  const withTotal = (x) => ({ ...x, totalTokens: total(x) });
  const rows = [...groups.values()].map(withTotal).sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
  const topDispatches = [...dispatches.values()].map(withTotal).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, TOP);
  return { by, since: since ?? null, rows, totals: withTotal(totals), topDispatches };
}
