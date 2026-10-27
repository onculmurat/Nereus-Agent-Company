// Conditional autocompact. Claude Code compacts the lead's context on its own; the PreCompact hook lets that happen
// only when the lead's own state is safe (team/ committed, no owner question waiting, every in-progress task has a
// hand-off file; tasks in flight alone do not block), or when the context passes a ceiling. Every function here is cheap,
// and the hook treats any error as "allow".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBoard, verifyCommit } from './board.js';
import { pendingQuestions } from './decisions.js';
import { buildResumeSummary } from './summary.js';
import { hardeningDueModules } from './findings.js';
import { loadConfig } from './config.js';
import { pluginRoot } from './hookio.js';
import { teamPaths } from './paths.js';
import { localDate } from './dates.js';

export const DEFAULT_CEILING = 220000;
export const DEFAULT_WINDOW = 200000;
const TAIL_BYTES = 512 * 1024;
const CACHE_MS = 10000;
const HANDOFF_GLOB = 'team/work/handoffs/compact-*';

// Tokens in the context at the last assistant message: input + cache read + cache creation. null when unknown.
export function contextTokens(file) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        let u;
        try {
          const entry = JSON.parse(lines[i]);
          u = entry?.type === 'assistant' ? entry.message?.usage : null;
        } catch {
          continue;
        }
        if (u) return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // unreadable transcript: unknown
  }
  return null;
}

// Every condition that is not met, one line each (empty when compaction may run). Throws on a problem the caller
// treats as "allow". g25: only the lead's own state counts. Tasks in flight do not block by themselves, and developer
// files elsewhere in a shared tree are ignored: only uncommitted paths under team/ count.
export function compactBlockers(root) {
  const { soft, hard } = compactConditions(root);
  return [...soft, ...hard];
}

// g32: soft conditions (a missing task hand-off, uncommitted team/ files, the last done task's commit) defer an auto
// compaction only for a bounded number of tokens: the compact hand-off lists them and nothing on disk is lost. T-037
// stayed in progress without a hand-off for hours and held every compaction back until the ceiling. An owner question
// waiting for an answer is hard: it blocks up to the ceiling; one whose task is already done is soft (g95).
export function compactConditions(root) {
  const soft = [];
  const board = readBoard(root);
  const missing = board.entries.filter((e) => e.status === 'in-progress' && !handoffFileOf(root, e));
  if (missing.length) soft.push(`${missing.map((e) => e.id).join(', ')} in progress without a hand-off file (team/work/handoffs/<id>.md); write it so the task can resume after compaction.`);
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'team', `:(exclude)${HANDOFF_GLOB}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  if (dirty) soft.push('uncommitted changes under team/ (board, decisions, hand-offs); commit them first.');
  const last = board.entries.filter((e) => e.status === 'done').at(-1);
  if (last && last.code !== 'no') {
    const sha = last.commits.at(-1);
    if (!sha) soft.push(`${last.id} is done but has no commit recorded on the board.`);
    else {
      try {
        verifyCommit(root, sha);
      } catch {
        soft.push(`${last.id}: commit ${sha} is not reachable from HEAD.`);
      }
    }
  }
  // waiting for an answer in this turn: parked, deferred and queued questions are not
  const open = pendingQuestions(root).filter((q) => q.state !== 'deferred' && q.state !== 'queued');
  // g95: a question whose task is done was answered and never recorded. Memory Agent's Q-207 stayed open after T-110a
  // shipped and held every auto compaction back for hours; it is soft, so the deferral limit lets compaction run.
  const doneIds = new Set(board.entries.filter((e) => e.status === 'done').map((e) => e.id));
  const stale = open.filter((q) => q.task && doneIds.has(q.task));
  // g108: a non-blocking question is on disk and survives the compaction; as hard it held Memory Agent's lead from
  // 100k to 161k tokens (Q-227..Q-237, 10-27) while the lead kept starting work. Only a blocking question is hard now.
  const nonBlocking = open.filter((q) => !stale.includes(q) && q.blocking === 'no');
  const waiting = open.filter((q) => !stale.includes(q) && !nonBlocking.includes(q));
  if (stale.length) soft.push(`${stale.map((q) => `${q.id} (${q.task} is done)`).join(', ')} still open; record the answer with decisions.js decide.`);
  if (nonBlocking.length) soft.push(`${nonBlocking.map((q) => q.id).join(', ')} not answered yet (non-blocking question, recorded in decisions.md).`);
  const hard = waiting.length ? [`${waiting.length} owner question(s) not answered yet (${waiting.map((q) => q.id).join(', ')}); ask or answer them first.`] : [];
  return { soft, hard };
}

// The hand-off file of a task: the path recorded on the board, else team/work/handoffs/<id>.md. null when none exists.
function handoffFileOf(root, e) {
  const rel = e.handoff || `team/work/handoffs/${e.id}.md`;
  return fs.existsSync(path.resolve(root, rel)) ? rel : null;
}

// null when compaction may run, else a one-line reason (the first unmet condition).
export function compactBlocker(root) {
  return compactBlockers(root)[0] ?? null;
}

// A block is remembered briefly: Claude Code asks again after every tool result.
const cacheFile = (sessionId) => path.join(os.tmpdir(), `nac-precompact-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

export function cachedBlocker(sessionId, root, now = Date.now()) {
  const { soft, hard } = cachedConditions(sessionId, root, now);
  return [...soft, ...hard][0] ?? null;
}

function cachedConditions(sessionId, root, now) {
  if (!sessionId) return compactConditions(root);
  const file = cacheFile(sessionId);
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c.root === root && now - c.time < CACHE_MS && Array.isArray(c.soft) && Array.isArray(c.hard)) return { soft: c.soft, hard: c.hard };
  } catch { /* no usable cache */ }
  const c = compactConditions(root);
  try {
    if (c.soft.length || c.hard.length) fs.writeFileSync(file, JSON.stringify({ root, time: now, ...c }));
    else fs.rmSync(file, { force: true });
  } catch { /* the cache is an optimisation */ }
  return c;
}

// g32: what the PreCompact hook does with an auto compaction below the ceiling. A hard condition blocks. Soft
// conditions block until the context has grown softMargin tokens past the first deferral of this session; then the
// compaction runs with trigger 'deferral limit'. Returns { block: reason } or { allow: trigger }.
export const DEFAULT_SOFT_MARGIN = 20000;
const deferFile = (sessionId) => path.join(os.tmpdir(), `nac-precompact-defer-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

// g108: while an auto compaction is held back, the lead must not start new work (task.js start refuses); the hold is
// kept per project and cleared when a compaction runs. Older than HELD_MAX_MS it is ignored (a crashed session).
const HELD_MAX_MS = 6 * 3600 * 1000;
const heldFile = (root) => path.join(os.tmpdir(), `nac-compact-held-${path.resolve(root).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
export function markCompactionHeld(root, { tokens, reason, now = Date.now() }) {
  try { fs.writeFileSync(heldFile(root), JSON.stringify({ tokens, reason, time: now })); } catch { /* best effort */ }
}
export function clearCompactionHeld(root) {
  try { fs.rmSync(heldFile(root), { force: true }); } catch { /* best effort */ }
}
export function compactionHeld(root, now = Date.now()) {
  try {
    const h = JSON.parse(fs.readFileSync(heldFile(root), 'utf8'));
    return now - h.time < HELD_MAX_MS ? h : null;
  } catch {
    return null;
  }
}

export function compactDecision(sessionId, root, tokens, { softMargin = DEFAULT_SOFT_MARGIN, now = Date.now() } = {}) {
  const { soft, hard } = cachedConditions(sessionId, root, now);
  const file = sessionId ? deferFile(sessionId) : null;
  const clear = () => { try { if (file) fs.rmSync(file, { force: true }); } catch { /* best effort */ } };
  if (hard.length) return { block: [...hard, ...soft].join(' ') };
  if (!soft.length) {
    clear();
    return { allow: 'safe point' };
  }
  let since = tokens;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d.root === root && Number.isFinite(d.since) && d.since <= tokens) since = d.since;
  } catch { /* first deferral */ }
  if (tokens - since >= softMargin) {
    clear();
    return { allow: 'deferral limit' };
  }
  try { if (file) fs.writeFileSync(file, JSON.stringify({ root, since })); } catch { /* every call starts a new deferral then; the ceiling still holds */ }
  return { block: `${soft.join(' ')} Deferred since ${since} tokens; compaction runs anyway at ${since + softMargin}.` };
}

// The task to resume: one in progress or in review first, then a todo whose brief exists, then any todo.
function nextTaskLine(root) {
  const board = readBoard(root);
  const inFlight = board.entries.find((e) => e.status === 'in-progress') ?? board.entries.find((e) => e.status === 'review');
  if (inFlight) return `${inFlight.id}: ${inFlight.title} (${inFlight.status}; resume it first)`;
  // g87: modules whose findings are due for hardening come before the rest of the board, an empty board included.
  let due = [];
  try {
    due = hardeningDueModules(root, board.entries, loadConfig({ pluginRoot, projectRoot: root }).findingsBatch);
  } catch { /* the line stays as it was */ }
  const hard = due.length ? `hardening due first: ${due.map((d) => `${d.module} ${d.counted}`).join(', ')}; ask the planner for those tasks (a second one in a phase needs an owner decision)` : '';
  const todo = board.entries.filter((e) => e.status === 'todo');
  const ready = todo.find((e) => fs.existsSync(path.join(teamPaths(root).tasks, `${e.id}.md`)));
  const pick = ready ?? todo[0];
  if (pick) return `${hard ? `${hard}. Then ` : ''}${pick.id}: ${pick.title} (${ready ? 'brief ready' : 'todo, no brief yet'})`;
  return hard ? `none on the board, but ${hard}` : 'none on the board; ask the owner or plan the next step';
}

// g25: each task in flight, so the lead resumes them after compaction.
function inFlightLines(root) {
  return readBoard(root).entries.filter((e) => e.status === 'in-progress' || e.status === 'review').map((e) => {
    const parts = [`${e.id}: ${e.title} (${e.status})`, `owner ${e.owner}`];
    if (e.agent) parts.push(`agent ${e.agent}`);
    if (e.worktree) parts.push(`worktree ${e.worktree}`);
    parts.push(`hand-off ${handoffFileOf(root, e) ?? 'none yet'}`);
    return `- ${parts.join('; ')}`;
  });
}

// trigger: 'safe point' (the hook found every condition met), 'ceiling' (token ceiling reached), 'deferral limit'
// (soft conditions deferred it as long as allowed, g32) or 'manual'.
// The header states the real trigger and, unless it is a verified safe point, the conditions that were not met.
export function writeCompactHandoff(root, now = new Date(), { trigger = 'safe point', tokens, ceiling } = {}) {
  clearCompactionHeld(root);
  const dir = teamPaths(root).handoffs;
  fs.mkdirSync(dir, { recursive: true });
  const pad = (n) => String(n).padStart(2, '0');
  const name = `compact-${localDate(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.md`;
  let failed;
  try {
    failed = compactBlockers(root);
  } catch {
    failed = null; // could not check: say so instead of claiming a clean point
  }
  const how = trigger === 'ceiling'
    ? `Written by the PreCompact hook because the context reached the token ceiling${tokens ? ` (${tokens} of ${ceiling} tokens)` : ''}, not because a safe point was reached.`
    : trigger === 'deferral limit' ? 'Written by the PreCompact hook after the soft conditions below deferred compaction as long as allowed (g32); settle them first.'
      : trigger === 'manual' ? 'Written for a manual compaction (the owner asked for it); nothing checked that it is a safe point.'
      : 'Written by the PreCompact hook at a safe point.';
  const status = failed === null ? 'Conditions could not be checked; treat the state below as unverified.'
    : failed.length ? ['Conditions not met when this was written:', ...failed.map((f) => `- ${f}`)].join('\n')
      : 'All conditions met: team/ state committed, last done task committed, no pending owner question (parked and deferred ones are listed below), every in-progress task has a hand-off file.';
  let flight = [];
  try {
    flight = inFlightLines(root);
  } catch { /* the list is informational */ }
  const text = [
    '# Compact hand-off',
    how,
    status,
    ...(flight.length ? ['In flight (resume each after compaction; read its hand-off first):', ...flight] : []),
    `Next task: ${nextTaskLine(root)}`,
    'Owner questions: team/decisions.md (open and decided).',
    '',
    buildResumeSummary(root, { gitStatus: '' }).trim(),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, name), text);
  return name;
}

export function latestCompactHandoff(root) {
  try {
    const names = fs.readdirSync(teamPaths(root).handoffs).filter((n) => /^compact-.+\.md$/.test(n)).sort();
    return names.length ? `team/work/handoffs/${names[names.length - 1]}` : null;
  } catch {
    return null;
  }
}
