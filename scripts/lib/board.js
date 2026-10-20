// team/work/board.md: the authoritative task board. Only the lead writes it (through scripts/board.js).
import fs from 'node:fs';
import path from 'node:path';
import { localStamp } from './dates.js';
import { teamPaths } from './paths.js';
import { parseEntries, formatEntry, toLines, nextId } from './sections.js';
import { nextAction } from './escalation.js';
import { execFileSync } from 'node:child_process';
import { readDecisions, deferredFor, recordOutcomes, threadFromText } from './decisions.js';
import { listFindings } from './findings.js';
import { parseRefs } from './refs.js';

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

// reviews are stored as "role:verdict, role:verdict" and read as { role: verdict }.
// security: yes marks a task for the module-level security review; contract (a changed security contract) also needs a pass before done.
const SECURITY_TAGS = ['yes', 'contract'];
export const SIZES = ['S', 'M', 'L'];
const checkSize = (size) => {
  if (size !== undefined && !SIZES.includes(size)) throw new Error(`Invalid size "${size}" (allowed: ${SIZES.join(', ')})`);
  return size;
};
const parseReviews = (s) => Object.fromEntries(s.split(',').map((p) => p.trim().split(':')).filter(([r, v]) => r && v));
const formatReviews = (r) => Object.entries(r).map(([role, verdict]) => `${role}:${verdict}`).join(', ');

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
    ...(f.worktree ? { worktree: f.worktree } : {}),
    ...(f.agent ? { agent: f.agent } : {}),
    ...(Number(f.foldins) > 0 ? { foldins: Number(f.foldins) } : {}),
    ...(f.approach ? { approach: f.approach, roundsBase: Number(f.roundsbase ?? 0) } : {}),
    ...(f.code === 'no' ? { code: 'no' } : {}),
    ...(SIZES.includes(f.size) ? { size: f.size } : {}),
    ...(SECURITY_TAGS.includes(f.security) ? { security: f.security } : {}),
    ...(f.module ? { module: f.module } : {}),
    ...(f.hardening === 'yes' ? { hardening: 'yes', hphase: Number(f.hphase ?? 0), ...(f.hdecision ? { hdecision: f.hdecision } : {}) } : {}),
    ...(f.reviews ? { reviews: parseReviews(f.reviews) } : {}),
  }));
  const rotLine = lines.find((l) => /^done-since-rotation:\s*\d+\s*$/.test(l));
  const board = { phase: phaseLine ? Number(phaseLine.split(':')[1]) : 0, entries };
  if (rotLine) board.doneSinceRotation = Number(rotLine.split(':')[1]);
  return board;
}

// g28: the tree a task's code lives in. pack --base and gate --task ran in the main tree while the task worked in
// its own worktree (T-059: empty diff, gate on the wrong tree). A worktree recorded on the board but missing is an
// error, not a silent fall back to the main tree.
export function taskTree(root, id) {
  const wt = readBoard(root).entries.find((e) => e.id === id)?.worktree;
  if (!wt) return root;
  const dir = path.resolve(root, wt);
  if (!fs.existsSync(dir)) throw new Error(`${id}: worktree ${wt} on the board does not exist. Fix it with board.js update ${id} --worktree <path>.`);
  return dir;
}

export function writeBoard(root, board) {
  const file = teamPaths(root).board;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const blocks = board.entries.map((e) => formatEntry('##', e.id, e.title, {
    owner: e.owner, status: e.status, rounds: e.rounds, model: e.model, commits: e.commits.join(', '), handoff: e.handoff,
    ...(e.worktree ? { worktree: e.worktree } : {}),
    ...(e.agent ? { agent: e.agent } : {}),
    ...(e.foldins > 0 ? { foldins: e.foldins } : {}),
    ...(e.approach ? { approach: e.approach, roundsbase: e.roundsBase ?? 0 } : {}),
    ...(e.code === 'no' ? { code: 'no' } : {}),
    ...(SIZES.includes(e.size) ? { size: e.size } : {}),
    ...(SECURITY_TAGS.includes(e.security) ? { security: e.security } : {}),
    ...(e.module ? { module: e.module } : {}),
    ...(e.hardening === 'yes' ? { hardening: 'yes', hphase: e.hphase ?? 0, ...(e.hdecision ? { hdecision: e.hdecision } : {}) } : {}),
    ...(e.reviews && Object.keys(e.reviews).length ? { reviews: formatReviews(e.reviews) } : {}),
  }));
  const rotation = board.doneSinceRotation > 0 ? `\ndone-since-rotation: ${board.doneSinceRotation}` : '';
  fs.writeFileSync(file, [`# Board\nphase: ${board.phase}${rotation}`, ...blocks].join('\n\n') + '\n');
}

// code: 'no' marks a task that produces no code (spike, research, docs only); its gate checks the report file.
// At most one hardening task per module per phase: each hardening review opens the next hardening otherwise.
// A second one needs a decision recorded in decisions.md (--decision D-xxx).
function planHardening(root, board, { module, decision }) {
  if (!module) throw new Error('--hardening needs --module <m>: a hardening task belongs to one module');
  checkModuleName(module);
  const earlier = board.entries.find((e) => e.hardening === 'yes' && e.module === module && e.hphase === board.phase);
  if (decision !== undefined && !readDecisions(root).decided.some((d) => d.id === decision)) {
    throw new Error(`--decision ${decision}: no decision with that id in team/decisions.md. Record the owner's decision first (decisions.js), then pass its id.`);
  }
  if (earlier && decision === undefined) {
    throw new Error(`Module ${module} already has a hardening task in phase ${board.phase} (${earlier.id}). One per module per phase: record the findings with findings.js add --origin hardening and deal with them at the phase end, or ask the owner, record the decision and pass --decision D-xxx.`);
  }
  return { hardening: 'yes', hphase: board.phase, ...(decision === undefined ? {} : { hdecision: decision }) };
}

export function addEntry(root, { id, title, owner, model, code, security, module, hardening, decision, size }) {
  checkSize(size);
  const board = readBoard(root);
  checkOwner(board, owner);
  checkCodeOwner(owner, code);
  const entryId = id ?? nextId('T', board.entries.map((e) => e.id));
  if (!ID_RE.test(entryId)) throw new Error(`Invalid board id "${entryId}"`);
  if (board.entries.some((e) => e.id === entryId)) throw new Error(`Board entry ${entryId} already exists`);
  const hard = hardening === 'yes' ? planHardening(root, board, { module, decision }) : {};
  const entry = { id: entryId, title, owner, status: 'todo', rounds: 0, model, commits: [], handoff: '', ...(code === 'no' ? { code: 'no' } : {}), ...(size ? { size } : {}), ...(SECURITY_TAGS.includes(security) ? { security } : {}), ...(module ? { module: checkModuleName(module) } : {}), ...hard };
  const note = autoTagSecurity(root, entry, { explicit: security });
  board.entries.push(entry);
  writeBoard(root, board);
  return note ? { ...entry, securityNote: note } : entry;
}

// A brief that cites threat-model IDs belongs to a security review: the task is tagged security: yes unless it has a tag.
// Returns a note for the lead when it tagged the entry.
function autoTagSecurity(root, entry, { explicit } = {}) {
  if (entry.security || explicit !== undefined) return undefined;
  let brief;
  try {
    brief = fs.readFileSync(path.join(teamPaths(root).tasks, `${entry.id}.md`), 'utf8');
  } catch {
    return undefined;
  }
  const { threats } = parseRefs(brief);
  if (!threats.length) return undefined;
  entry.security = 'yes';
  return `Tagged security: yes because the brief cites threat-model ${threats.join(', ')}. Use board.js update ${entry.id} --security contract if it changes a security contract.`;
}

// A task is not done while it has questions the owner has not been given yet, or while a security: contract task
// lacks a security-reviewer pass.
function checkDone(root, entry) {
  if (entry.security === 'contract' && entry.reviews?.['security-reviewer'] !== 'pass') {
    throw new Error(`${entry.id} is tagged security: contract and has no security-reviewer pass${entry.reviews?.['security-reviewer'] ? ` (latest verdict: ${entry.reviews['security-reviewer']})` : ''}. Dispatch security-reviewer, then record it: board.js review ${entry.id} --role security-reviewer --verdict pass`);
  }
  const deferred = deferredFor(root, entry.id);
  if (deferred.length) {
    throw new Error(`${entry.id} has ${deferred.length} deferred question(s) (${deferred.map((q) => q.id).join(', ')}). Ask them first: run decisions.js flush --task ${entry.id} and put the groups to the owner (one AskUserQuestion call per group).`);
  }
}

export function updateEntry(root, id, patch, { singleCommit } = {}) {
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw new Error(`Invalid status "${patch.status}" (allowed: ${STATUSES.join(', ')})`);
  }
  checkSize(patch.size);
  const board = readBoard(root);
  const entry = board.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No board entry ${id}`);
  checkOwner(board, patch.owner);
  checkCodeOwner(patch.owner ?? entry.owner, patch.code ?? entry.code);
  if (patch.status === 'done') checkDone(root, { ...entry, ...(patch.security === undefined ? {} : { security: patch.security }) });
  if (patch.status === 'done') checkCommits(root, { ...entry, ...patch }, singleCommit);
  if (patch.status === 'done' && entry.status !== 'done') board.doneSinceRotation = (board.doneSinceRotation ?? 0) + 1;
  if (patch.module !== undefined && patch.module !== '') checkModuleName(patch.module);
  if (patch.status === 'in-progress') checkTreeFree(board, entry, patch.worktree ?? entry.worktree);
  Object.assign(entry, patch);
  if (!entry.worktree) delete entry.worktree;
  if (!entry.agent) delete entry.agent;
  const note = patch.status === 'in-progress' ? autoTagSecurity(root, entry, { explicit: patch.security }) : undefined;
  if (!entry.module) delete entry.module;
  if (entry.code !== 'no') delete entry.code;
  if (!SECURITY_TAGS.includes(entry.security)) delete entry.security;
  writeBoard(root, board);
  return { ...entry, ...(note ? { securityNote: note } : {}) };
}

// g24: two implementers in one working tree share the git index (a formatter or `git add` of one pulls the other's
// files into its commit). A code task starts only when no other in-progress code task uses the same tree: the main
// tree (no worktree recorded) or the same worktree path. Tasks with distinct worktrees run in parallel.
function checkTreeFree(board, entry, worktree) {
  if (entry.code === 'no') return;
  const tree = worktree || '';
  const other = board.entries.find((e) => e.id !== entry.id && e.status === 'in-progress' && e.code !== 'no' && (e.worktree || '') === tree);
  if (!other) return;
  throw new Error(tree
    ? `${entry.id} cannot start in worktree ${tree}: ${other.id} is in progress there. Use its own worktree.`
    : `${entry.id} cannot start in the main working tree: ${other.id} is in progress there, and two implementers in one tree share the git index (one's formatter or commit pulls in the other's files). Run it in its own worktree: node "<scripts>/worktree.js" add ${entry.id}, then board.js update ${entry.id} --status in-progress --worktree <printed path>.`);
}

// g19: a task without a size counts as M. A medium or large code task with at most one code commit lost its work once
// at a quota stop, so done is refused unless the lead names a reason (--single-commit <reason>, recorded in the
// decisions log). S tasks and tasks that produce no code (code: no) are not checked.
function checkCommits(root, entry, singleCommit) {
  if (entry.code === 'no' || entry.size === 'S' || entry.commits.length > 1) return;
  const size = entry.size ?? 'M (no size set counts as M)';
  const reason = typeof singleCommit === 'string' ? singleCommit.trim() : '';
  if (!reason) {
    throw new Error(`${entry.id} is size ${size} but has at most one code commit: developers commit each green step (wip allowed) so a quota stop or a restart loses nothing. Check the hand-off lists the steps. If one commit is right for this task, repeat the command with --single-commit "<reason>" (recorded in team/decisions.md); for a small task use board.js update ${entry.id} --size S.`);
  }
  recordOutcomes(root, [{ thread: threadFromText(`single commit ${entry.id}`), title: `Single code commit: ${entry.id}`, outcome: `${entry.id} (size ${entry.size ?? 'M'}) closed with ${entry.commits.length} code commit(s) (--single-commit): ${reason}` }]);
}

const MODULE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const checkModuleName = (m) => {
  if (!MODULE_RE.test(m)) throw new Error(`Invalid module "${m}": letters, digits, dot, dash and underscore only`);
  return m;
};

const REVIEW_ROLE_RE = /^[a-z][a-z0-9-]{0,63}$/;
const VERDICTS = ['pass', 'fail'];

// Records the latest verdict of a reviewer role on a task (a later verdict of the same role replaces the earlier one).
export function recordReview(root, id, { role, verdict }) {
  if (!REVIEW_ROLE_RE.test(role ?? '')) throw new Error(`Invalid review role "${role}"`);
  if (!VERDICTS.includes(verdict)) throw new Error(`Invalid verdict "${verdict}" (allowed: ${VERDICTS.join(', ')})`);
  const board = readBoard(root);
  const entry = board.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`No board entry ${id}`);
  entry.reviews = { ...entry.reviews, [role]: verdict };
  writeBoard(root, board);
  return entry;
}

// A module review covers the security-tagged tasks of the module that are done now; tasks done later need a new one.
export function recordModuleReview(root, module, { role, verdict }) {
  checkModuleName(module);
  if (!REVIEW_ROLE_RE.test(role ?? '')) throw new Error(`Invalid review role "${role}"`);
  if (!VERDICTS.includes(verdict)) throw new Error(`Invalid verdict "${verdict}" (allowed: ${VERDICTS.join(', ')})`);
  const board = readBoard(root);
  const inModule = board.entries.filter((e) => e.module === module);
  if (!inModule.length) throw new Error(`No board task in module ${module}. Set it with board.js add/update --module ${module}`);
  const covered = inModule.filter((e) => SECURITY_TAGS.includes(e.security) && e.status === 'done');
  for (const e of covered) e.reviews = { ...e.reviews, [role]: verdict };
  writeBoard(root, board);
  return { module, role, verdict, covered: covered.map((e) => e.id) };
}

// What stops a phase or milestone from closing: a blocker finding still open, or a module whose security-tagged tasks
// were done after its last security-reviewer pass. Returns the problems as sentences; none means the phase can close.
export function phaseCloseProblems(root) {
  const problems = listFindings(root, { open: true }).filter((f) => f.severity === 'blocker')
    .map((f) => `Open blocker finding ${f.id} in module ${f.module} (${f.file}:${f.line}): ${f.text}. Fix it, then findings.js close ${f.id} --commit <sha>.`);
  const uncovered = new Map();
  for (const e of readBoard(root).entries) {
    if (!e.module || !SECURITY_TAGS.includes(e.security) || e.status !== 'done' || e.reviews?.['security-reviewer'] === 'pass') continue;
    uncovered.set(e.module, [...(uncovered.get(e.module) ?? []), e.id]);
  }
  for (const [module, ids] of uncovered) {
    problems.push(`Module ${module} has security tasks done (${ids.join(', ')}) after its last security-reviewer pass. Review the module's security-tagged changes since then, then run: board.js review --module ${module} --role security-reviewer --verdict pass`);
  }
  return problems;
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
