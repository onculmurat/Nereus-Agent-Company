// Resume summary (injected at SessionStart) and phase report data.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readBoard } from './board.js';
import { readDecisions } from './decisions.js';
import { listInbox } from './mailbox.js';
import { teamPaths } from './paths.js';
import { buildCostReport, buildMetricRows, compareWithBaseline } from './cost.js';

function gitStatusOf(root) {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  } catch {
    return '';
  }
}

// The newest session hand-off the lead wrote before a rotation (lead-<YYYY-MM-DD-HHMM>.md sorts by time).
function latestLeadHandoff(root) {
  try {
    const names = fs.readdirSync(teamPaths(root).handoffs).filter((n) => /^lead-.+.md$/.test(n)).sort();
    return names.length ? `team/work/handoffs/${names[names.length - 1]}` : null;
  } catch {
    return null;
  }
}

const line = (e) => `- ${e.id}: ${e.title} (${e.owner}, ${e.status})`;

// The summary is injected into every lead session, so each list is cut to MAX_LINES.
const MAX_LINES = 20;
const capped = (lines) => (lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `- ... and ${lines.length - MAX_LINES} more`] : lines);

export function buildResumeSummary(root, { gitStatus } = {}) {
  const board = readBoard(root);
  const { open } = readDecisions(root);
  const changes = (gitStatus ?? gitStatusOf(root)).split(/\r?\n/).filter((l) => l.trim());
  const inProgress = board.entries.filter((e) => e.status === 'in-progress' || e.status === 'review');
  const pending = board.entries.filter((e) => e.status === 'todo' || e.status === 'blocked');
  const unread = listInbox(root, 'team-lead').length;
  const questions = [...open].sort((a, b) => (a.blocking === 'yes' ? 0 : 1) - (b.blocking === 'yes' ? 0 : 1));

  const parts = [`Phase: ${board.phase}`];
  const handoff = latestLeadHandoff(root);
  if (handoff) parts.push(`Lead hand-off: ${handoff}`);
  if (inProgress.length || changes.length) {
    const lines = capped(inProgress.map(line));
    if (changes.length) lines.push('- Uncommitted changes (git status):', ...capped(changes).map((c) => `  ${c}`));
    parts.push(['In progress:', ...lines].join('\n'));
  }
  if (pending.length) parts.push(['Open board items:', ...capped(pending.map(line))].join('\n'));
  if (unread) parts.push(`Unread for team-lead: ${unread}`);
  if (questions.length) {
    parts.push(['Queued owner questions:', ...capped(questions.map((q) => `- ${q.id}: ${q.title}${q.blocking === 'yes' ? ' [blocking]' : ''}`))].join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

// Calls and tokens per role and per task, plus the most expensive dispatches. Cost is context for the report,
// so unreadable transcripts must not break it.
function costOf(root, projectsDir, since) {
  try {
    const byRole = buildCostReport(root, { by: 'role', projectsDir, since });
    const byTask = buildCostReport(root, { by: 'task', projectsDir, since });
    let vsBaseline = null;
    try {
      vsBaseline = compareWithBaseline(root, buildMetricRows(root, { projectsDir, since }));
    } catch { /* a missing baseline is not an error */ }
    return { byRole: byRole.rows, byTask: byTask.rows, totals: byRole.totals, topDispatches: byRole.topDispatches, vsBaseline };
  } catch {
    return { byRole: [], byTask: [], totals: { calls: 0, totalTokens: 0 }, topDispatches: [], vsBaseline: null };
  }
}

export function buildPhaseReport(root, { projectsDir, since } = {}) {
  const board = readBoard(root);
  const { open, decided } = readDecisions(root);
  return {
    phase: board.phase,
    done: board.entries.filter((e) => e.status === 'done'),
    notDone: board.entries.filter((e) => e.status !== 'done'),
    decided,
    open,
    cost: costOf(root, projectsDir, since),
  };
}
