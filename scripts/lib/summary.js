// Resume summary (injected at SessionStart) and phase report data.
import { execFileSync } from 'node:child_process';
import { readBoard } from './board.js';
import { readDecisions } from './decisions.js';
import { listInbox } from './mailbox.js';

function gitStatusOf(root) {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

const line = (e) => `- ${e.id}: ${e.title} (${e.owner}, ${e.status})`;

export function buildResumeSummary(root, { gitStatus } = {}) {
  const board = readBoard(root);
  const { open } = readDecisions(root);
  const changes = (gitStatus ?? gitStatusOf(root)).split(/\r?\n/).filter((l) => l.trim());
  const inProgress = board.entries.filter((e) => e.status === 'in-progress' || e.status === 'review');
  const pending = board.entries.filter((e) => e.status === 'todo' || e.status === 'blocked');
  const unread = listInbox(root, 'team-lead').length;
  const questions = [...open].sort((a, b) => (a.blocking === 'yes' ? 0 : 1) - (b.blocking === 'yes' ? 0 : 1));

  const parts = [`Phase: ${board.phase}`];
  if (inProgress.length || changes.length) {
    const lines = inProgress.map(line);
    if (changes.length) lines.push('- Uncommitted changes (git status):', ...changes.map((c) => `  ${c}`));
    parts.push(['In progress:', ...lines].join('\n'));
  }
  if (pending.length) parts.push(['Open board items:', ...pending.map(line)].join('\n'));
  if (unread) parts.push(`Unread for team-lead: ${unread}`);
  if (questions.length) {
    parts.push(['Queued owner questions:', ...questions.map((q) => `- ${q.id}: ${q.title}${q.blocking === 'yes' ? ' [blocking]' : ''}`)].join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

export function buildPhaseReport(root) {
  const board = readBoard(root);
  const { open, decided } = readDecisions(root);
  return {
    phase: board.phase,
    done: board.entries.filter((e) => e.status === 'done'),
    notDone: board.entries.filter((e) => e.status !== 'done'),
    decided,
    open,
  };
}
