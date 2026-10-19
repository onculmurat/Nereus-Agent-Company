// Per-dispatch cost: sums message.usage from the Claude Code transcripts of this project.
// Main session: <projects>/<slug>/*.jsonl. Subagents: <projects>/<slug>/<session>/subagents/agent-*.jsonl with
// agent-*.meta.json (agent type). A subagent's first user message is the dispatch prompt, which names the pack file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { localDate } from './dates.js';
import { teamPaths } from './paths.js';

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

// A dispatch is "packed" when its prompt names a file under team/work/packs/. A hand-off, even of the same task, is
// not a pack: pre-pack sessions named hand-offs and the roles still explored the project from scratch.
export function namesPack(text) {
  return /team[\\/]+work[\\/]+packs[\\/]/.test(text ?? '');
}

const PACK_RE = /team[\\/]+work[\\/]+packs[\\/]+([^\s"'`<>|*?\\/]+?)\.md/;
const TASK_FILE_RE = /team[\\/]+work[\\/]+tasks[\\/]+([^\s"'`<>|*?\\/]+?)\.md/;
const HANDOFF_RE = /team[\\/]+work[\\/]+handoffs[\\/]+([^\s"'`<>|*?\\/]+?)\.md/;
const TASK_ID = /^[A-Za-z]+-\d+[A-Za-z]*$/;

// The task a dispatch prompt works on, in order: the pack path (team/work/packs/<id>-<role>[-r<n>].md), a task file
// (team/work/tasks/<id>.md), a hand-off named after a task (team/work/handoffs/<id>.md), the first task id in the text
// (T-<digits><letter?>, normalised to a lowercase suffix), else "unassigned".
export function taskFromPrompt(text) {
  const t = text ?? '';
  const pack = PACK_RE.exec(t);
  if (pack) {
    const name = pack[1].replace(/-r\d+$/, '');
    const role = knownRoles().filter((r) => name.endsWith(`-${r}`)).sort((a, b) => b.length - a.length)[0];
    if (role) return name.slice(0, -(role.length + 1)) || 'unassigned';
    const id = /^([A-Za-z]+-\d+[A-Za-z]*)/.exec(name)?.[1];
    if (id) return id;
  }
  const task = TASK_FILE_RE.exec(t)?.[1];
  if (task) return task;
  const handoff = HANDOFF_RE.exec(t)?.[1];
  if (handoff && TASK_ID.test(handoff)) return handoff;
  const loose = /\bT-(\d+)([a-z]?)\b/i.exec(t);
  return loose ? `T-${loose[1]}${loose[2].toLowerCase()}` : 'unassigned';
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
function messagesOf(records, since, until) {
  const byId = new Map();
  let anon = 0;
  for (const rec of records) {
    const msg = rec?.type === 'assistant' ? rec.message : null;
    const usage = msg?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const t = Date.parse(rec.timestamp);
    if (since !== undefined && !(t >= since)) continue;
    if (until !== undefined && !(t <= until)) continue;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    byId.set(msg.id ?? `anon-${anon++}`, {
      t,
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

// Lead messages carry the task of the latest dispatch of their session that started at or before them (earlier: unassigned).
function assignLead(leads, starts) {
  for (const m of leads) {
    const list = starts.get(m.session) ?? [];
    let task = 'unassigned';
    for (const d of list) if (d.t <= m.t) task = d.task;
    m.task = task;
  }
}

function collect(dirs, since, until, session) {
  const items = [];
  const leads = [];
  const starts = new Map();
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const sid = e.name.slice(0, -'.jsonl'.length);
        if (session !== undefined && sid !== session) continue;
        for (const m of messagesOf(readLines(path.join(dir, e.name)), since, until)) leads.push({ ...m, role: 'lead', task: 'unassigned', agentId: null, session: sid, packed: false });
      } else if (e.isDirectory()) {
        if (session !== undefined && e.name !== session) continue;
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
          const prompt = textOf(first?.message?.content);
          const task = taskFromPrompt(prompt);
          const packed = namesPack(prompt);
          const began = Date.parse(records.find((r) => r?.timestamp)?.timestamp);
          if (Number.isFinite(began)) starts.set(e.name, [...(starts.get(e.name) ?? []), { t: began, task }].sort((a, b) => a.t - b.t));
          const role = roleOf(meta.agentType);
          for (const m of messagesOf(records, since, until)) {
            items.push({ ...m, role, task, packed, session: e.name, agentId: `${e.name}/${base.slice('agent-'.length)}`, shortId: base.slice('agent-'.length), description: meta.description ?? '' });
          }
        }
      }
    }
  }
  assignLead(leads, starts);
  return [...leads, ...items];
}

// Relative price of one token, input = 1: cache creation 1.25, cache read 0.1, output 5. The figure ranks cost;
// it is not money. Raw token totals stay next to it.
export const WEIGHTS = { inputTokens: 1, cacheCreationTokens: 1.25, cacheReadTokens: 0.1, outputTokens: 5 };
const weigh = (x) => Math.round(FIELDS.reduce((a, f) => a + WEIGHTS[f] * x[f], 0) * 10) / 10;
const total = (x) => FIELDS.reduce((a, f) => a + x[f], 0);
const zero = () => ({ calls: 0, inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 });
function add(acc, m) {
  acc.calls += 1;
  for (const f of FIELDS) acc[f] += m[f];
}

function parseInstant(name, value) {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid --${name} "${value}": use an ISO date such as 2026-10-01T00:00:00Z`);
  return ms;
}

// --task keeps one task's messages: its subagents and the lead messages attributed to it.
function itemsFor(root, { since, until, session, task, projectsDir = defaultProjectsDir() }) {
  const items = collect(projectDirs(root, projectsDir), parseInstant('since', since), parseInstant('until', until), session);
  return task === undefined ? items : items.filter((m) => m.task.toLowerCase() === task.toLowerCase());
}

export function buildCostReport(root, { by = 'role', since, until, session, task, projectsDir = defaultProjectsDir() } = {}) {
  if (!BY.includes(by)) throw new Error(`--by must be one of ${BY.join(', ')}; got "${by}"`);
  const items = itemsFor(root, { since, until, session, task, projectsDir });

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
      if (!dispatches.has(m.agentId)) dispatches.set(m.agentId, { agentId: m.shortId, role: m.role, task: m.task, description: m.description, model: m.model, ...zero() });
      add(dispatches.get(m.agentId), m);
    }
  }
  const withTotal = (x) => ({ ...x, totalTokens: total(x), weighted: weigh(x) });
  const rows = [...groups.values()].map(withTotal).sort((a, b) => b.weighted - a.weighted || b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
  const topDispatches = [...dispatches.values()].map(withTotal).sort((a, b) => b.weighted - a.weighted || b.totalTokens - a.totalTokens).slice(0, TOP);
  return { by, since: since ?? null, rows, totals: withTotal(totals), topDispatches };
}

// ---- Durable metrics: rows saved under team/metrics/ so a later session can compare with an earlier one. ----

const BASELINE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const pad = (n) => String(n).padStart(2, '0');
const tokensOf = (r) => r.input + r.cacheWrite + r.cacheRead + r.output;
const metricsDir = (root) => path.join(teamPaths(root).team, 'metrics');
const jsonlPath = (root) => path.join(metricsDir(root), 'cost.jsonl');
export const sharedMetricsPath = (home = os.homedir()) => path.join(home, '.claude', 'nac', 'metrics.md');

function scopeOf({ since, until, session, task, baseline }) {
  if (baseline !== undefined) return 'baseline';
  const parts = [];
  if (task !== undefined) parts.push(`task ${task}`);
  if (session !== undefined) parts.push(`session ${session}`);
  if (since !== undefined) parts.push(`since ${since}`);
  if (until !== undefined) parts.push(`until ${until}`);
  return parts.length ? parts.join(' ') : 'all';
}

// One row per role, task, model and session. dispatches = subagent runs in the row; packed = those whose dispatch
// prompt names a pack or hand-off; overBudget = those with more model turns (distinct message ids, which is what calls counts) than turnBudget.
export function buildMetricRows(root, { since, until, session, task, baseline, projectsDir = defaultProjectsDir(), now = new Date() } = {}) {
  const items = itemsFor(root, { since, until, session, task, projectsDir });
  const budget = loadConfig({ pluginRoot, projectRoot: root }).turnBudget;
  const date = localDate(now);
  const project = path.basename(path.resolve(root));
  const scope = scopeOf({ since, until, session, task, baseline });
  const dispatchCalls = new Map();
  for (const m of items) if (m.agentId) dispatchCalls.set(m.agentId, (dispatchCalls.get(m.agentId) ?? 0) + 1);
  const rows = new Map();
  const seen = new Set();
  for (const m of items) {
    const key = [m.session, m.role, m.task, m.model].join('\u0000');
    if (!rows.has(key)) {
      const row = { date, project, session: m.session, scope, role: m.role, task: m.task, model: m.model, calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, weighted: 0, dispatches: 0, packed: 0, overBudget: 0 };
      if (baseline !== undefined) row.baseline = baseline;
      rows.set(key, row);
    }
    const r = rows.get(key);
    r.calls += 1;
    r.input += m.inputTokens;
    r.cacheWrite += m.cacheCreationTokens;
    r.cacheRead += m.cacheReadTokens;
    r.output += m.outputTokens;
    if (m.agentId && !seen.has(`${key}\u0000${m.agentId}`)) {
      seen.add(`${key}\u0000${m.agentId}`);
      r.dispatches += 1;
      if (m.packed) r.packed += 1;
      if (dispatchCalls.get(m.agentId) > budget) r.overBudget += 1;
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, weighted: weigh({ inputTokens: r.input, cacheCreationTokens: r.cacheWrite, cacheReadTokens: r.cacheRead, outputTokens: r.output }) }))
    .sort((a, b) => b.weighted - a.weighted || a.role.localeCompare(b.role) || a.session.localeCompare(b.session));
}

const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

function table(rows) {
  const head = '| role | task | model | session | calls | input | cacheWrite | cacheRead | output | weighted | dispatches | packed | overBudget |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => `| ${[r.role, r.task, r.model, r.session, r.calls, r.input, r.cacheWrite, r.cacheRead, r.output, r.weighted, r.dispatches, r.packed, r.overBudget].join(' | ')} |`);
  return [head, ...body].join('\n');
}

function totalsOf(rows) {
  const dispatches = sum(rows, (r) => r.dispatches);
  const packed = sum(rows, (r) => r.packed);
  return { calls: sum(rows, (r) => r.calls), tokens: sum(rows, tokensOf), weighted: round(sum(rows, (r) => r.weighted), 1), dispatches, packed, overBudget: sum(rows, (r) => r.overBudget), packedShare: dispatches ? Math.round((100 * packed) / dispatches) : 0 };
}

// Saves the run: team/metrics/cost-<date>-<HHMM>.md (cost-<task>-<date>-<HHMM>.md with a task, or baseline-<name>.md), appends the rows to cost.jsonl and one
// line to the shared ~/.claude/nac/metrics.md (this machine only).
export function saveMetrics(root, opts = {}) {
  const { baseline, home = os.homedir(), now = new Date() } = opts;
  if (baseline !== undefined && !BASELINE_RE.test(baseline)) throw new Error(`Invalid baseline name "${baseline}": letters, digits, dot, dash and underscore only`);
  const rows = buildMetricRows(root, opts);
  const dir = metricsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const hhmm = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const stamp = `${localDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const name = baseline !== undefined ? `baseline-${baseline}.md` : `cost-${opts.task !== undefined ? `${opts.task}-` : ''}${localDate(now)}-${hhmm}.md`;
  const md = path.join(dir, name);
  const scope = rows[0]?.scope ?? scopeOf({ ...opts, baseline });
  const t = totalsOf(rows);
  fs.writeFileSync(md, `# ${baseline !== undefined ? `Baseline ${baseline}` : 'Cost'} ${stamp}\n\nScope: ${scope}. Calls ${t.calls}, tokens ${t.tokens}, weighted ${t.weighted}, dispatches ${t.dispatches}, packed ${t.packedShare}%, over budget ${t.overBudget}.\n\n${table(rows)}\n`);
  const jsonl = jsonlPath(root);
  if (baseline !== undefined && fs.existsSync(jsonl)) {
    // a baseline taken again under the same name replaces its earlier rows
    const kept = fs.readFileSync(jsonl, 'utf8').split('\n').filter((l) => {
      if (!l.trim()) return false;
      try {
        const r = JSON.parse(l);
        return !(r.scope === 'baseline' && r.baseline === baseline);
      } catch { return true; }
    }).map((l) => `${l}\n`).join('');
    fs.writeFileSync(jsonl, kept);
  }
  if (rows.length) fs.appendFileSync(jsonl, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
  const shared = sharedMetricsPath(home);
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  const fresh = !fs.existsSync(shared) || fs.readFileSync(shared, 'utf8').trim() === '';
  const header = '# NAC metrics (all projects on this machine)\n\n| date | project | scope | calls | tokens | weighted | dispatches | packed | over budget |\n|---|---|---|---|---|---|---|---|---|\n';
  fs.appendFileSync(shared, `${fresh ? header : ''}| ${[localDate(now), path.basename(path.resolve(root)), scope, t.calls, t.tokens, t.weighted, t.dispatches, `${t.packedShare}%`, t.overBudget].join(' | ')} |\n`);
  return { md, jsonl, shared, rows, totals: t };
}

function roleAverages(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.role === 'lead' || !r.dispatches) continue;
    const a = by.get(r.role) ?? { dispatches: 0, calls: 0, tokens: 0 };
    a.dispatches += r.dispatches;
    a.calls += r.calls;
    a.tokens += tokensOf(r);
    by.set(r.role, a);
  }
  return new Map([...by].map(([role, a]) => [role, { dispatches: a.dispatches, avgCalls: round(a.calls / a.dispatches, 1), avgTokens: Math.round(a.tokens / a.dispatches) }]));
}

// Per role, average calls and tokens per dispatch now against the latest baseline file; null without a baseline.
export function compareWithBaseline(root, current) {
  let files = [];
  try {
    files = fs.readdirSync(metricsDir(root)).filter((f) => /^baseline-.+\.md$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(metricsDir(root), f)).mtimeMs })).sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
  } catch { return null; }
  if (!files.length) return null;
  const name = files[0].f.slice('baseline-'.length, -'.md'.length);
  const old = readLines(jsonlPath(root)).filter((r) => r?.scope === 'baseline' && r.baseline === name);
  const before = roleAverages(old);
  const now = roleAverages(current);
  const ratio = (a, b) => (a && b ? round(b / a, 2) : null);
  const roles = [...new Set([...before.keys(), ...now.keys()])].sort().map((role) => ({
    role,
    baseline: before.get(role) ?? null,
    current: now.get(role) ?? null,
    callsRatio: ratio(before.get(role)?.avgCalls, now.get(role)?.avgCalls),
    tokensRatio: ratio(before.get(role)?.avgTokens, now.get(role)?.avgTokens),
  }));
  return { name, roles };
}
