// team/work/board.md: the authoritative task board. Only the lead writes it (through scripts/board.js).
import fs from 'node:fs';
import path from 'node:path';
import { localStamp } from './dates.js';
import { teamPaths } from './paths.js';
import { parseEntries, formatEntry, toLines, nextId } from './sections.js';
import { nextAction } from './escalation.js';
import { execFileSync } from 'node:child_process';
import { readDecisions, deferredFor } from './decisions.js';

export const STATUSES = ['todo', 'in-progress', 'review', 'done', 'blocked'];
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
// The lead hands off and restarts its session after this many tasks are marked done.
export const ROTATE_EVERY = 5;
// Research roles work only in phase 1. From phase 4 on, a spike goes to a developer role or test-engineer.
const RESEARCH_OWNERS = ['researcher', 'research-reviewer', 'finance-analyst'];
export const BUILD_PHASE = 4;

function checkOwner(board, owner) {
  if (board.phase < BUILD_PHASE || typeof owner !== 'string') return;
  const role = owner.replace(/^.*:/, '');
  if (RESEARCH_OWNERS.includes(role)) {
    throw new Error(`Owner "${owner}" is not allowed from phase ${BUILD_PHASE} on: research roles work only in phase 1. Give the spike to a developer role (backend-developer, frontend-developer, database-engineer) or test-engineer.`);
  }
}

// The lead decides, plans and escalates; it does not own a task that produces code.
const LEAD_OWNERS = ['lead', 'team-lead'];
function checkCodeOwner(owner, code) {
  if (typeof owner !== 'string' || code === 'no') return;
  if (LEAD_OWNERS.includes(owner.replace(/^.*:/, ''))) {
    throw new Error(`Owner "${owner}" cannot own a code task: the lead decides and escalates, a developer role implements (backend-developer, frontend-developer, database-engineer, test-engineer). Mark the task code: no only if it produces no code.`);
  }
}

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
    ...(Number(f.foldins) > 0 ? { foldins: Number(f.foldins) } : {}),
    ...(f.approach ? { approach: f.approach, roundsBase: Number(f.roundsbase ?? 0) } : {}),
    ...(f.code === 'no' ? { code: 'no' } : {}),
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
    ...(e.foldins > 0 ? { foldins: e.foldins } : {}),
    ...(e.approach ? { approach: e.approach, roundsbase: e.roundsBase ?? 0 } : {}),
    ...(e.code === 'no' ? { code: 'no' } : {}),
  }));
  const rotation = board.doneSinceRotation > 0 ? `\ndone-since-rotation: ${board.doneSinceRotation}` : '';
  fs.writeFileSync(file, [`# Board\nphase: ${board.phase}${rotation}`, ...blocks].join('\n\n') + '\n');
}

// code: 'no' marks a task that produces no code (spike, research, docs only); its gate checks the report file.
export function addEntry(root, { id, title, owner, model, code }) {
  const board = readBoard(root);
  checkOwner(board, owner);
  checkCodeOwner(owner, code);
  const entryId = id ?? nextId('T', board.entries.map((e) => e.id));
  if (!ID_RE.test(entryId)) throw new Error(`Invalid board id "${entryId}"`);
  if (board.entries.some((e) => e.id === entryId)) throw new Error(`Board entry ${entryId} already exists`);
  const entry = { id: entryId, title, owner, status: 'todo', rounds: 0, model, commits: [], handoff: '', ...(code === 'no' ? { code: 'no' } : {}) };
  board.entries.push(entry);
  writeBoard(root, board);
  return entry;
}

// A task is not done while it has questions the owner has not been given yet.
function checkDone(root, entry) {
  const deferred = deferredFor(root, entry.id);
  if (deferred.length) {
    throw new Error(`${entry.id} has ${deferred.length} deferred question(s) (${deferred.map((q) => q.id).join(', ')}). Ask them first: run decisions.js flush --task ${entry.id} and put the groups to the owner (one AskUserQuestion call per group).`);
  }
}

export function updateEntry(root, id, patch) {
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw new Error(`Invalid status "${patch.status}" (allowed: ${STATUSES.join(', ')})`);
  }
  const board = readBoard(root);
  const entry = board.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No board entry ${id}`);
  checkOwner(board, patch.owner);
  checkCodeOwner(patch.owner ?? entry.owner, patch.code ?? entry.code);
  if (patch.status === 'done') checkDone(root, entry);
  if (patch.status === 'done' && entry.status !== 'done') board.doneSinceRotation = (board.doneSinceRotation ?? 0) + 1;
  Object.assign(entry, patch);
  if (entry.code !== 'no') delete entry.code;
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

// Spec fold-in rounds of one review cycle (the entry is the design task). The lead calls this before each fold-in
// round: up to the cap it counts and says "fold-in"; after that it says "batch" (everything left goes to the architect
// as one pass and the open decisions to the owner as one list). reset starts a new review cycle.
export function countFoldIn(root, id, { foldInRounds, reset = false }) {
  const board = readBoard(root);
  const entry = board.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No board entry ${id}`);
  const done = entry.foldins ?? 0;
  let action;
  if (reset) {
    delete entry.foldins;
    action = 'reset';
  } else if (done < foldInRounds) {
    entry.foldins = done + 1;
    action = 'fold-in';
  } else {
    action = 'batch';
  }
  writeBoard(root, board);
  return { id, action, foldIns: entry.foldins ?? 0, cap: foldInRounds };
}

// Counts one more unresolved round on an entry and applies the escalation ladder.
// Only the lead calls this, so no agent has to remember the count.
// Review round cap: after reviewRoundCap rounds (counted from the last approach decision) a task gets no further fix
// round. The lead sends the findings and round history to the architect as one approach question, brings it to the
// owner, records the decision and continues with --approach <decision id>. The round with --approach is the first of the next window.
export function incrementRound(root, id, config, { now = new Date(), approach } = {}) {
  const board = readBoard(root);
  const entry = board.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No board entry ${id}`);
  const cap = config.reviewRoundCap;
  if (approach !== undefined) {
    if (!readDecisions(root).decided.some((d) => d.id === approach)) {
      throw new Error(`--approach ${approach}: no decision with that id in team/decisions.md. Record the owner's decision first (decisions.js), then pass its id.`);
    }
    entry.approach = approach;
    entry.roundsBase = entry.rounds;
  } else if (Number.isInteger(cap) && entry.rounds - (entry.roundsBase ?? 0) >= cap) {
    throw new Error(`Review round cap reached for ${id}: ${entry.rounds - (entry.roundsBase ?? 0)} rounds since ${entry.approach ? `approach ${entry.approach}` : 'the start'} (reviewRoundCap ${cap}). No further fix round. Next step: send the open findings and the round history to the architect as one approach question (options, root causes, cost of each; read-only answer), bring the decision to the owner as one question (Source/Status/Impact, options, one recommendation), record it with decisions.js, then run: board.js round ${id} --approach <decision-id>.`);
  }
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
      `- date: ${localStamp(now)}`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, `${entry.id}-r${entry.rounds}.md`), text);
  }
  return { entry, next };
}

// A commit recorded on the board must exist and be part of the history of HEAD, so a hash written from memory
// (or from another branch) is caught. Read the hash from git first: git log -1 --format=%h
export function verifyCommit(root, sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha ?? '')) throw new Error(`"${sha}" is not a commit sha (7-40 hex characters). Read it from git: git log -1 --format=%h`);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  try {
    git('rev-parse', '--verify', '--quiet', `${sha}^{commit}`);
  } catch (e) {
    const msg = String(e.stderr || '').trim();
    if (/not a git repository/i.test(msg)) throw new Error(`Cannot verify commit ${sha}: ${root} is not a git repository.`);
    throw new Error(`Commit ${sha} does not exist in this repository (not a commit here). Read it from git: git log -1 --format=%h`);
  }
  try {
    git('merge-base', '--is-ancestor', sha, 'HEAD');
  } catch {
    throw new Error(`Commit ${sha} is not reachable from HEAD. Read the current hash from git: git log -1 --format=%h`);
  }
}
