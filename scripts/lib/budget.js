// g36: a role cannot count its own model turns, so the pack's budget line alone let one run into the maxTurns
// hard stop with no report and no commit. The PostToolUse hook counts the turns from the role's transcript.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const WARN_TURNS = 5;

// <projects>/<slug>/<session>/subagents/agent-<agent_id>.jsonl, next to the lead's <session>.jsonl.
export function subagentLog({ transcriptPath, sessionId, agentId }) {
  const id = /^[A-Za-z0-9-]+$/;
  if (typeof transcriptPath !== 'string' || !id.test(sessionId ?? '') || !id.test(agentId ?? '')) return null;
  return path.join(path.dirname(transcriptPath), sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

// One turn is one model message; its text and tool_use blocks are saved as separate lines with the same id.
export function countTurns(file) {
  if (!file || !fs.existsSync(file)) return 0;
  const ids = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === 'assistant' && e.message?.id) ids.add(e.message.id);
    } catch {
      // a line being written is skipped
    }
  }
  return ids.size;
}

export function budgetNotice(turns, budget) {
  if (turns >= budget) {
    return `NAC turn budget: you have reached your budget of ${budget} turns (${turns} used); the hard stop comes a few turns later and cuts you off without a report. Stop now: do not commit (g61), leave the changes uncommitted (the lead's next pack carries them), and write your report: what is done, what is left, the files changed, which tests pass and which fail, and what you need.`;
  }
  if (turns >= budget - WARN_TURNS) {
    return `NAC turn budget: ${turns} of ${budget} turns; ${budget - turns} left. Do not start new work: finish the step you are on, then commit (tests green) and report.`;
  }
  return null;
}

// g60: Memory Agent counted three budget stops as `board.js round --reason stuck` (T-053 twice, T-054b), which
// spends the round cap on a stop that is not a round (g46). The hook records each stop per role; a fresh pack for
// that role clears it, and round --reason stuck is refused while it stands.
const stopsFile = (root) => path.join(mainTree(root), 'team', 'work', 'budget-stops.json');

// A role in a worktree writes its stop where the lead's board.js reads it: the main tree.
function mainTree(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const main = path.dirname(common);
    return fs.existsSync(path.join(main, 'team', 'config.json')) ? main : root;
  } catch {
    return root;
  }
}

export function readBudgetStops(root) {
  try {
    return JSON.parse(fs.readFileSync(stopsFile(root), 'utf8'));
  } catch {
    return {};
  }
}

export function recordBudgetStop(root, { role, agentId, turns, now = new Date() }) {
  const stops = readBudgetStops(root);
  if (stops[role]?.agentId === agentId) return;
  stops[role] = { agentId, turns, at: now.toISOString() };
  fs.mkdirSync(path.dirname(stopsFile(root)), { recursive: true });
  fs.writeFileSync(stopsFile(root), `${JSON.stringify(stops, null, 1)}\n`);
}

export function clearBudgetStop(root, role) {
  const stops = readBudgetStops(root);
  if (!stops[role]) return;
  delete stops[role];
  fs.writeFileSync(stopsFile(root), `${JSON.stringify(stops, null, 1)}\n`);
}

// g61: at its second budget stop in T-058 (Memory Agent) the developer committed 0ea2311 with 7 of 12 existing
// pre_tool_use tests red, without noticing; the next dispatch first had to find out whether the red was its own.
// A role at the budget has no turns left to run the full tests, so it does not commit at all.
const GIT_COMMIT = /(?:^|[\s;&|(])git(?:\.exe)?(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--[\w-]+(?:=\S+)?))*\s+commit(?![\w-])/i;
export const isGitCommit = (command) => GIT_COMMIT.test(String(command));

export function budgetCommitBlock(turns, budget) {
  if (turns < budget) return null;
  return `NAC turn budget: you are at your budget (${turns} of ${budget} turns), so you do not commit now (g61): there are no turns left to run the full tests, and a red commit misleads the next dispatch. Leave the changes uncommitted; the lead's next pack carries the diff and lists new files. Write your report and stop.`;
}

// g63: in Memory Agent T-058 the usage limit cut off two reviewers mid-run (18:50, reset 21:40). Claude Code keeps a
// stopped subagent's transcript, and SendMessage to its agent id continues it with its context; a fresh pack makes
// a role that had done real work read everything again and redo it. The limit stop is the last line of the role's
// transcript: a synthetic assistant message with isApiErrorMessage and error rate_limit.
export const RESUME_MIN_TURNS = 10;

export function agentStop(file) {
  if (!file || !fs.existsSync(file)) return null;
  let last = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === 'assistant') last = e;
    } catch {
      // a line being written is skipped
    }
  }
  const limit = Boolean(last?.isApiErrorMessage && (last.error === 'rate_limit' || /hit your .*limit/i.test(JSON.stringify(last.message?.content ?? ''))));
  const text = limit ? (last.message?.content ?? []).map((c) => c.text ?? '').join(' ').trim() : null;
  // the synthetic message is not a model turn
  return { turns: countTurns(file) - (limit ? 1 : 0), stoppedBy: limit ? 'limit' : null, message: text };
}

// Resume when the role was cut off by the limit after real work and still has turns left before the warning line
// (a resumed role keeps its turn count); otherwise a fresh pack. Neither is a review round.
export function resumeAdvice({ turns, stoppedBy }, budget) {
  if (stoppedBy !== 'limit') return { advice: 'none', why: 'the role did not stop on the usage limit' };
  if (turns < RESUME_MIN_TURNS) return { advice: 'fresh', why: `only ${turns} turns before the limit: a fresh pack costs about the same and carries the current code` };
  if (turns >= budget - WARN_TURNS) return { advice: 'fresh', why: `${turns} of ${budget} turns used: a resumed role keeps its count and would stop at the budget almost at once` };
  return { advice: 'resume', why: `${turns} turns of work before the limit: continuing keeps what it read and did` };
}
