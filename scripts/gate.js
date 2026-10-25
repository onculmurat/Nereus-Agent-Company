#!/usr/bin/env node
// Test gate CLI: runs gateCommands (or testCommand) from team/config.json in the project root. Exits 1 when the tests fail.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { runGate, gateChecks, isCodeless, checkDocGate, waitForIdle, fixable, fixGate, scopeChecks, noFailFast, retryRed, DEFAULT_GATE_WAIT_SECONDS, DEFAULT_GATE_CHECK_SECONDS } from './lib/gate.js';
import { taskTree } from './lib/board.js';

const usage = `Usage:
  gate.js [--task <id>] [--project <dir>]
                      without --task, or when the task has code: runs every check of gateCommands (name + command, in order; all are run and reported, any red fails)
                      or the single testCommand when gateCommands is not set
                      with --task, the checks run in the task's worktree when the board records one (g28)
                      a task marked code: no (board entry or brief) is checked on its report file instead:
                      the file named by the brief's "Output: <path>" line exists, has a verdict line
                      (Verdict: GO | GO-WITH-CHANGES | NO-GO) and an acceptance criteria section
                      before the checks run, the gate waits up to gateWaitSeconds (default 300) while another process runs one
                      of the check programs (for example a cargo test left in the background); still running then: busy + note (g31)
                      each check has gateCheckSeconds (default 1200, 0 = none); past it the check is stopped with its process tree
                      and reported red with timedOut, its last lines and hung + hangNote (g54)
                      with --task, cargo test and cargo clippy run only on the packages changed since the task's
                      "chore(team): <id> start" commit and the packages that depend on them; anything outside a package
                      runs the whole workspace; scope in the result says which (g55)
                      cargo test runs with --no-fail-fast; a test check red only on gateKnownRed tests (team/config.json:
                      { test, finding, reason } each) counts as green and names them in knownRed; a listed test that passes
                      is named in knownRedPassed; a build error is never a known red. A red check runs again gateRetry times
                      (default 1, 0 to 3); red then green is reported in flaky and is not a round (g64)
                      a red test check names its failed tests in failed (check: test) and the first lines of each
                      one's panic in checks[].failures (g65)
  gate.js --task <id> --full
                      the same over the whole workspace (also gateScope: "full" in team/config.json); the milestone
                      and phase end run gate.js without --task
  gate.js --task <id> --fix
                      when only checks with a fix command are red (fixable: true; a check's "fix", or the write form of
                      cargo fmt / ruff format / black / prettier --check): runs the fixes, commits them as style(<id>) and
                      runs the gate again; not a round (g44). Refused with uncommitted changes outside team/.
`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runCli(usage, { task: { type: 'string' }, fix: { type: 'boolean' }, full: { type: 'boolean' } }, ({ values, root }) => {
  if (values.fix && values.task === undefined) throw new UsageError('--fix needs --task <id>: the style commit is named after the task');
  if (values.task !== undefined && isCodeless(root, values.task)) {
    const doc = checkDocGate(root, values.task);
    if (!doc.ok) process.exitCode = 1;
    return doc;
  }
  const config = loadConfig({ pluginRoot, projectRoot: root });
  validateConfig(config);
  const allChecks = gateChecks(config);
  if (allChecks.length === 0) {
    throw new UsageError('No testCommand in team/config.json. The planner records it in phase 4; ask the owner if it is unknown.');
  }
  const tree = values.task === undefined ? root : taskTree(root, values.task);
  // g55: with --task, cargo test and clippy run only on the changed packages and their dependents
  const scoped = values.task !== undefined && !values.full && config.gateScope !== 'full'
    ? scopeChecks(tree, values.task, allChecks)
    : { checks: allChecks, scope: { full: values.task === undefined ? 'no --task' : values.full ? '--full' : 'gateScope: full' } };
  // g64: cargo test runs every test binary, so a known environmental red does not hide the tests after it
  const checks = scoped.checks.map((c) => ({ ...c, command: noFailFast(c.command) }));
  const knownRed = config.gateKnownRed ?? [];
  // g31: wait while another run of a check program loads the machine; report it when it outlasts gateWaitSeconds
  // (NAC_GATE_WAIT_SECONDS overrides it for one run; the test suite sets 0)
  const env = process.env.NAC_GATE_WAIT_SECONDS;
  const idle = waitForIdle(checks, { seconds: /^\d+$/.test(env ?? '') ? Number(env) : config.gateWaitSeconds ?? DEFAULT_GATE_WAIT_SECONDS });
  // g54: each check gets gateCheckSeconds (NAC_GATE_CHECK_SECONDS for one run); a hang comes back red with timedOut
  const limit = process.env.NAC_GATE_CHECK_SECONDS;
  const seconds = /^\d+$/.test(limit ?? '') ? Number(limit) : config.gateCheckSeconds ?? DEFAULT_GATE_CHECK_SECONDS;
  // g64: a red check runs again before it counts; red then green is reported as flaky, not a round
  const first = retryRed(tree, checks, runGate(tree, checks, { seconds, knownRed }), { retries: config.gateRetry ?? 1, seconds, knownRed });
  const result = values.fix ? fixGate(tree, checks, first, { id: values.task, seconds, knownRed }) : { ...first, ...(fixable(first, checks) ? { fixable: true } : {}) };
  if (!result.ok) process.exitCode = 1;
  const busy = idle.busy.length
    ? { busy: idle.busy, note: `other runs of the check programs were still running after ${idle.waited}s; a red check may come from the load. Find who started them, wait for them to end and run the gate again before you count a round.` }
    : {};
  const hung = result.checks?.filter((c) => c.timedOut).map((c) => c.name) ?? [];
  const hang = hung.length
    ? { hung, hangNote: `${hung.join(', ')} gave no result in ${seconds}s and was stopped with its process tree. This is a hang (deadlock, a wait that never ends), not a failing assertion: find the test from the last lines of the output, run it alone, and count the fix as a round.` }
    : {};
  // g65: the failed test names of every red check, so the lead and the developer start from them
  const failed = result.checks?.flatMap((c) => (c.failed ?? []).map((t) => `${c.name}: ${t}`)) ?? [];
  const known = result.checks?.flatMap((c) => c.knownRed ?? []) ?? [];
  const stale = result.checks?.flatMap((c) => c.knownRedPassed ?? []) ?? [];
  const knownNote = {
    ...(known.length ? { knownRed: known, knownRedNote: `only gateKnownRed tests failed (${known.join(', ')}): environmental, each a recorded finding; the check counts as green.` } : {}),
    ...(stale.length ? { knownRedPassed: stale, knownRedPassedNote: `${stale.join(', ')} passed: remove it from gateKnownRed in team/config.json and close its finding.` } : {}),
  };
  return { ...result, tree, scope: scoped.scope, ...(failed.length ? { failed } : {}), ...knownNote, ...hang, ...(idle.waited ? { waited: idle.waited } : {}), ...busy };
});
