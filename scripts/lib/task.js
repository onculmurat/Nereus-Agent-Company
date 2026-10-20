// Task start and close as one call each (g33). In T-059 and T-080 about a third of the lead's calls were bookkeeping
// (board, hand-off appends, findings, team commits, git checks), and each call re-read the whole lead context. The
// steps are the same as by hand; the script runs them in order and stops at the first refusal.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBoard, updateEntry, commitsWith, rotationDue, markRotated, ROTATE_EVERY } from './board.js';
import { addWorktree, removeWorktree } from './worktree.js';
import { writePack } from './pack.js';
import { commitPaths } from './commit.js';
import { ensureCostFile } from './cost.js';
import { addFinding, validateFinding } from './findings.js';
import { buildResumeSummary, questionListsMarkdown } from './summary.js';
import { hasCompactionSettings } from './setup.js';
import { teamPaths } from './paths.js';
import { localDate } from './dates.js';
import { scopeRecord } from './scope.js';

// g34: with compaction configured the lead rotates after every task, so each task starts on a small context.
export const COMPACTION_ROTATE_EVERY = 1;

// g15: with compaction configured the lead rotates by hand-off and autocompact; /clear is for projects without it.
export function rotationWay(root) {
  try {
    return hasCompactionSettings(root) ? 'compaction' : 'clear';
  } catch {
    return 'clear';
  }
}

// rotateEvery from the config wins; else every task with compaction, every 5 tasks with /clear (an owner step each time).
export function rotationEvery(root, config = {}) {
  if (config.rotateEvery !== undefined) return config.rotateEvery;
  return rotationWay(root) === 'compaction' ? COMPACTION_ROTATE_EVERY : ROTATE_EVERY;
}

const entryOf = (root, id) => {
  const e = readBoard(root).entries.find((x) => x.id === id);
  if (!e) throw new Error(`No board entry ${id}`);
  return e;
};
const handoffRel = (e) => e.handoff || `team/work/handoffs/${e.id}.md`;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (now) => `${localDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
const headOf = (dir) => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// in-progress (+ worktree), the hand-off skeleton with the base commit, the role's pack, one chore(team) commit.
export function startTask(root, id, { worktree = false, worktreeRoot, role, paths, now = new Date() } = {}) {
  const before = entryOf(root, id);
  const wt = worktree ? addWorktree(root, id, { worktreeRoot }) : null;
  const tree = wt ? wt.path : root;
  const rel = handoffRel(before);
  const file = path.resolve(root, rel);
  const created = !fs.existsSync(file);
  let entry;
  try {
    const base = headOf(tree);
    if (created) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `# ${id}: ${before.title}\n\nStarted: ${stamp(now)}\nBase: ${base}\nTree: ${wt ? wt.path.split(path.sep).join('/') : 'main project'}\n\n## Notes\n`);
    }
    entry = updateEntry(root, id, { status: 'in-progress', handoff: rel, ...(wt ? { worktree: wt.path.split(path.sep).join('/') } : {}) });
    entry.base = base;
  } catch (e) {
    if (created) fs.rmSync(file, { force: true });
    if (wt) removeWorktree(root, id, { worktreeRoot });
    throw e;
  }
  const pack = role ? writePack(root, { id, role, paths }) : null;
  const commit = commitPaths(root, ['team'], `chore(team): ${id} start`);
  return {
    id, status: entry.status, base: entry.base, tree: tree.split(path.sep).join('/'), handoff: rel,
    ...(entry.securityNote ? { securityNote: entry.securityNote } : {}),
    ...(pack ? { pack: { path: pack.path, chars: pack.chars, notFound: pack.notFound, ...(pack.tooLarge ? { tooLarge: true, limit: pack.limit } : {}), ...(pack.note ? { note: pack.note } : {}) } } : {}),
    commit,
  };
}

// Appends a section to the task's hand-off file (replaces heredoc appends). Committed with the next start or close.
export function noteTask(root, id, { text, heading, now = new Date() }) {
  if (!String(text ?? '').trim()) throw new Error('--text must not be empty');
  const rel = handoffRel(entryOf(root, id));
  const file = path.resolve(root, rel);
  if (!fs.existsSync(file)) throw new Error(`${rel} does not exist; start the task with task.js start ${id} first`);
  const body = String(text).replace(/\r\n/g, '\n').trimEnd();
  fs.appendFileSync(file, `\n### ${heading?.trim() || stamp(now)}\n\n${body}\n`);
  return { handoff: rel };
}

// Findings, done (with the commit and the hand-off), the cost file, the lead hand-off when the rotation is due,
// and one chore(team) commit.
export function closeTask(root, id, { commit, singleCommit, findings = [], leadNote, config = {}, pluginRoot, now = new Date() }) {
  const e = entryOf(root, id);
  const rel = handoffRel(e);
  if (!fs.existsSync(path.resolve(root, rel))) throw new Error(`${rel} does not exist; write the task's hand-off before done`);
  if (!Array.isArray(findings)) throw new Error('--findings must hold a JSON array of findings');
  for (const [i, f] of findings.entries()) {
    const missing = ['module', 'file', 'line', 'severity', 'class', 'text'].filter((k) => f?.[k] === undefined || f[k] === '');
    if (missing.length) throw new Error(`finding ${i + 1} in --findings lacks ${missing.join(', ')}; nothing was recorded`);
    try {
      validateFinding(root, f);
    } catch (err) {
      throw new Error(`finding ${i + 1} in --findings: ${err.message}; nothing was recorded`);
    }
  }
  const commits = commit === undefined ? e.commits : commitsWith(root, id, commit);
  // done first: a refused done (deferred question, security review) must not leave findings that a second try repeats
  const entry = updateEntry(root, id, { status: 'done', commits, handoff: rel }, { singleCommit });
  const added = [];
  try {
    for (const f of findings) added.push(addFinding(root, { ...f, task: f.task ?? id, pluginRoot }));
  } catch (err) {
    throw new Error(`${id} is done, but a finding was refused: ${err.message}. Recorded: ${added.map((f) => f.id).join(', ') || 'none'}; add the rest with findings.js add, then commit with team-commit.js`);
  }
  const warnings = [];
  let cost = null;
  try {
    const c = ensureCostFile(root, id);
    warnings.push(...c.warnings);
    cost = { file: c.file, created: c.created };
  } catch (err) {
    warnings.push(`cost file not written for ${id} (${err.message}); run cost.js --save --task ${id}`);
  }
  // 1.3.8: scope record (no check yet; g39 waits for these numbers) and team/ files in a code commit (a rule break).
  if (entry.code !== 'no' && entry.commits?.length) {
    try {
      const briefFile = path.join(teamPaths(root).tasks, `${id}.md`);
      const brief = fs.existsSync(briefFile) ? fs.readFileSync(briefFile, 'utf8') : '';
      const scope = scopeRecord(root, { id, commits: entry.commits, brief });
      const dir = path.join(teamPaths(root).team, 'metrics');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `scope-${id}.json`), `${JSON.stringify(scope, null, 1)}
`);
      if (scope.teamFiles.length) warnings.push(`team/ files in ${id}'s code commits (${scope.teamFiles.join(', ')}): roles stage only their code paths; team/ is committed with chore(team). Tell the role; history is not rewritten.`);
    } catch (err) {
      warnings.push(`scope record not written for ${id} (${err.message})`);
    }
  }
  const rotate = rotationDue(root, rotationEvery(root, config));
  let leadHandoff = null;
  if (rotate) {
    leadHandoff = writeLeadHandoff(root, { after: entry, leadNote, now });
    markRotated(root);
  }
  const committed = commitPaths(root, ['team'], `chore(team): ${id} done${leadHandoff ? ', lead hand-off' : ''}`);
  return {
    id, status: entry.status, commits: entry.commits,
    findings: added.map((f) => ({ id: f.id, module: f.module, severity: f.severity, hardeningDue: f.hardeningDue })),
    cost, rotate, ...(rotate ? { rotateBy: rotationWay(root), leadHandoff } : {}),
    commit: committed, ...(warnings.length ? { warnings } : {}),
  };
}

// The lead hand-off from the board and the decisions log, plus the lead's own note (risks, what the next session
// must know). The question lists come from the log, never by hand.
export function writeLeadHandoff(root, { after, leadNote, now = new Date() }) {
  const name = `lead-${localDate(now)}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
  const dir = teamPaths(root).handoffs;
  fs.mkdirSync(dir, { recursive: true });
  const text = [
    `# Lead hand-off ${stamp(now)}`,
    '',
    `Written by task.js close after ${after.id} (${after.title}${after.commits?.length ? `, commit ${after.commits.at(-1)}` : ''}).`,
    '',
    ...(leadNote?.trim() ? ['## Lead notes', '', leadNote.trim(), ''] : []),
    '## State',
    '',
    buildResumeSummary(root, { gitStatus: '' }).replace(/^Lead hand-off: .*\n\n/m, '').trim(),
    '',
    '## Owner questions (from the log)',
    '',
    questionListsMarkdown(root).trim(),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, name), text);
  return `team/work/handoffs/${name}`;
}
