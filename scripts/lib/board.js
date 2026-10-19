// team/work/board.md: the authoritative task board. Only the lead writes it (through scripts/board.js).
import fs from 'node:fs';
import path from 'node:path';
import { teamPaths } from './paths.js';
import { parseEntries, formatEntry, toLines, nextId } from './sections.js';
import { nextAction } from './escalation.js';

export const STATUSES = ['todo', 'in-progress', 'review', 'done', 'blocked'];
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
// The lead hands off and restarts its session after this many tasks are marked done.
export const ROTATE_EVERY = 5;

export function readBoard(root) {
  const file = teamPaths(root).board;
  if (!fs.existsSync(file)) return { phase: 0, entries: [] };
  const lines = toLines(fs.readFileSync(file, 'utf8'));
  const phaseLine = lines.find((l) => /^phase:\s*\d+\s*$/.test(l));
  const entries = parseEntries(lines, '##').map(({ id, title, fields: f }) => ({
    id,
    title,
    owner: f.owner ?? '',
    status: f.status ?? 'todo',
    rounds: Number(f.rounds ?? 0),
    model: f.model ?? '',
    commits: (f.commits ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    handoff: f.handoff ?? '',
  }));
  const rotLine = lines.find((l) => /^done-since-rotation:\s*\d+\s*$/.test(l));
  const board = { phase: phaseLine ? Number(phaseLine.split(':')[1]) : 0, entries };
  if (rotLine) board.doneSinceRotation = Number(rotLine.split(':')[1]);
  return board;
}

export function writeBoard(root, board) {
  const file = teamPaths(root).board;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const blocks = board.entries.map((e) => formatEntry('##', e.id, e.title, {
    owner: e.owner, status: e.status, rounds: e.rounds, model: e.model, commits: e.commits.join(', '), handoff: e.handoff,
  }));
  const rotation = board.doneSinceRotation > 0 ? `\ndone-since-rotation: ${board.doneSinceRotation}` : '';
  fs.writeFileSync(file, [`# Board\nphase: ${board.phase}${rotation}`, ...blocks].join('\n\n') + '\n');
}

export function addEntry(root, { id, title, owner, model }) {
  const board = readBoard(root);
  const entryId = id ?? nextId('T', board.entries.map((e) => e.id));
  if (!ID_RE.test(entryId)) throw new Error(`Invalid board id "${entryId}"`);
  if (board.entries.some((e) => e.id === entryId)) throw new Error(`Board entry ${entryId} already exists`);
  const entry = { id: entryId, title, owner, status: 'todo', rounds: 0, model, commits: [], handoff: '' };
  board.entries.push(entry);
  writeBoard(root, board);
  return entry;
}

export function updateEntry(root, id, patch) {
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw new Error(`Invalid status "${patch.status}" (allowed: ${STATUSES.join(', ')})`);
  }
  const board = readBoard(root);
  const entry = board.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No board entry ${id}`);
  if (patch.status === 'done' && entry.status !== 'done') board.doneSinceRotation = (board.doneSinceRotation ?? 0) + 1;
  Object.assign(entry, patch);
  writeBoard(root, board);
  return entry;
}

export function rotationDue(root) {
  return (readBoard(root).doneSinceRotation ?? 0) >= ROTATE_EVERY;
}

// The lead calls this after writing its hand-off, so the next rotation counts from zero.
export function markRotated(root) {
  const board = readBoard(root);
  delete board.doneSinceRotation;
  writeBoard(root, board);
}

export function setPhase(root, n) {
  const board = readBoard(root);
  board.phase = Number(n);
  writeBoard(root, board);
}

// Counts one more unresolved round on an entry and applies the escalation ladder.
// Only the lead calls this, so no agent has to remember the count.
export function incrementRound(root, id, config) {
  const board = readBoard(root);
  const entry = board.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No board entry ${id}`);
  entry.rounds += 1;
  const next = nextAction(entry.rounds, entry.model, config);
  if (next.action === 'raise-model') entry.model = next.model;
  writeBoard(root, board);
  if (next.action !== 'retry') {
    const dir = teamPaths(root).escalations;
    fs.mkdirSync(dir, { recursive: true });
    const text = [
      `# Escalation ${entry.id} round ${entry.rounds}`,
      '',
      `- entry: ${entry.id}: ${entry.title}`,
      `- owner: ${entry.owner}`,
      `- action: ${next.action}`,
      `- model: ${next.model}`,
      `- date: ${new Date().toISOString()}`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, `${entry.id}-r${entry.rounds}.md`), text);
  }
  return { entry, next };
}
