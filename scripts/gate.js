#!/usr/bin/env node
// Test gate CLI: runs gateCommands (or testCommand) from team/config.json in the project root. Exits 1 when the tests fail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig, checkDeleteRoots } from './lib/config.js';
import { pruneTaskBuilds, freeBytes, maintenanceState } from './lib/worktree.js';
import { runGate, gateChecks, isCodeless, checkDocGate, waitForIdle, fixable, fixGate, scopeChecks, noFailFast, retryRed, alwaysRunChecks, expectedGateSeconds, recordGateTimes, DEFAULT_GATE_SPLIT_SECONDS, DEFAULT_GATE_WAIT_SECONDS, DEFAULT_GATE_CHECK_SECONDS, DEFAULT_GATE_MIN_FREE_GB, diskFull } from './lib/gate.js';
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
                      gateTmp (team/config.json, a folder) sets TMP, TEMP and TMPDIR for every check (g77) to a gate-<pid>-<time>
                      folder in it that is removed when the run ends (g81)
                      below gateMinFreeGB (default 10, 0 = no check) free on the drive, the done tasks' build dirs are removed
                      first (worktree.js prune); still below, the checks do not run: disk + diskNote, not a round. A red whose
                      output says the drive is full has diskFull (g90)
                      a scoped gate also runs gateAlwaysRun ({ name, command } list in team/config.json), checks that read
                      every package (a cross-target build policy test) and so are in no changed package (g66)
  gate.js --task <id> --full
                      the same over the whole workspace (also gateScope: "full" in team/config.json); the milestone
                      and phase end run gate.js without --task
  gate.js --task <id> --fix
                      when only checks with a fix command are red (fixable: true; a check's "fix", or the write form of
                      cargo fmt / ruff format / black / prettier --check): runs the fixes, commits them as style(<id>) and
                      runs the gate again; not a round (g44). Refused with uncommitted changes outside team/.
  gate.js [--task <id>] --check <name> [--check <name> ...]
                      runs only the named checks (the same scope and settings); the gate is green when every check
                      is green, each in its own call (g104)
                      each run records how long each check command took (team/work/packs/gate-times.json); when the
                      recorded total of the checks to run passes gateSplitSeconds (team/config.json, default 500, 0 =
                      never), a gate without --check runs nothing and returns splitRequired, the checks and their
                      seconds and one --check command per check: not a round. --no-split runs them all anyway
`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runCli(usage, { task: { type: 'string' }, fix: { type: 'boolean' }, full: { type: 'boolean' }, check: { type: 'string', multiple: true }, 'no-split': { type: 'boolean' } }, ({ values, root }) => {
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
  // g66: gateAlwaysRun checks run beside a scoped gate; a full gate already runs the whole workspace
  const always = alwaysRunChecks(scoped.scope, config.gateAlwaysRun);
  const every = [...scoped.checks, ...always].map((c) => ({ ...c, command: noFailFast(c.command) }));
  // g104: --check runs only the named checks, so a gate past the tool timeout runs one check per call
  const only = values.check ?? [];
  const unknown = only.filter((n) => !every.some((c) => c.name === n));
  if (unknown.length) throw new UsageError(`No gate check named ${unknown.join(', ')}; the checks are: ${every.map((c) => c.name).join(', ')}`);
  const checks = only.length ? every.filter((c) => only.includes(c.name)) : every;
  const knownRed = config.gateKnownRed ?? [];
  const splitAt = config.gateSplitSeconds ?? DEFAULT_GATE_SPLIT_SECONDS;
  const splitCommands = () => checks.map((c) => `node "${path.join(pluginRoot, 'scripts', 'gate.js')}"${values.task === undefined ? '' : ` --task ${values.task}`}${values.full ? ' --full' : ''} --check ${c.name}`);
  if (!only.length && !values['no-split'] && splitAt > 0 && checks.length > 1) {
    const expected = expectedGateSeconds(root, checks);
    if (expected && expected.total > splitAt) {
      process.exitCode = 1;
      return { ok: false, splitRequired: true, expectedSeconds: expected.total, checkSeconds: expected.checks, commands: splitCommands(), splitNote: `the last runs of these checks took ${expected.total}s in all, past gateSplitSeconds ${splitAt}: one call would outlive the 600 s tool timeout and move to the background (g71). Nothing ran; this is not a round. Run each command in its own foreground call, one after the other; the gate is green when every check is green.` };
    }
  }
  // g90: D: filled up with five tasks building at once and the gate reported the ENOSPC reds as test failures. Below
  // gateMinFreeGB the done tasks' build dirs go first; still below, the gate does not run and it is not a round.
  // (NAC_GATE_MIN_FREE_GB overrides it for one run; the test suite sets 0)
  const minEnv = process.env.NAC_GATE_MIN_FREE_GB;
  const minFree = (/^\d+(?:\.\d+)?$/.test(minEnv ?? '') ? Number(minEnv) : config.gateMinFreeGB ?? DEFAULT_GATE_MIN_FREE_GB) * 1024 ** 3;
  let pruned = [];
  if (minFree > 0 && (freeBytes(tree) ?? Infinity) < minFree) {
    let roots = [];
    try { roots = checkDeleteRoots(config.deleteRoots); } catch { /* a bad list removes nothing there */ }
    pruned = pruneTaskBuilds(root, { worktreeRoot: config.worktreeRoot, deleteRoots: roots }).removed;
    const free = freeBytes(tree) ?? Infinity;
    if (free < minFree) {
      process.exitCode = 1;
      const gb = (n) => Math.round(n / 1024 ** 3 * 10) / 10;
      return { ok: false, disk: { freeGB: gb(free), minGB: gb(minFree), pruned }, diskNote: `only ${gb(free)} GB free on the drive of ${tree} (gateMinFreeGB ${gb(minFree)}), after removing the done tasks' build dirs. The checks did not run: this is not a round. Do not start builds or developers; ask the owner to free space (the largest build dirs are the shared target dirs), then run the gate again.` };
    }
  }
  // g77: the checks inherit TMP/TEMP from the caller; a lead on the PowerShell tool has the Windows user value (C:),
  // so gateTmp sends the tests' temporary files to a folder the owner chose
  // g81: the tests left their temporary folders behind (Memory Agent: ~10 GB in gateTmp, 38k folders on C:); each run
  // gets its own folder under gateTmp and removes it at the end, so parallel gates never delete each other's files
  let runTmp;
  if (config.gateTmp) {
    runTmp = path.join(config.gateTmp, `gate-${process.pid}-${Date.now()}`);
    fs.mkdirSync(runTmp, { recursive: true });
    for (const k of ['TMP', 'TEMP', 'TMPDIR']) process.env[k] = runTmp;
  }
  try {
    return runChecks();
  } finally {
    if (runTmp) {
      try { fs.rmSync(runTmp, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a locked file stays; the next run has its own folder */ }
    }
  }
  function runChecks() {
  // g31: wait while another run of a check program loads the machine; report it when it outlasts gateWaitSeconds
  // (NAC_GATE_WAIT_SECONDS overrides it for one run; the test suite sets 0)
  const env = process.env.NAC_GATE_WAIT_SECONDS;
  const idle = waitForIdle(checks, { seconds: /^\d+$/.test(env ?? '') ? Number(env) : config.gateWaitSeconds ?? DEFAULT_GATE_WAIT_SECONDS });
  // g54: each check gets gateCheckSeconds (NAC_GATE_CHECK_SECONDS for one run); a hang comes back red with timedOut
  const limit = process.env.NAC_GATE_CHECK_SECONDS;
  const seconds = /^\d+$/.test(limit ?? '') ? Number(limit) : config.gateCheckSeconds ?? DEFAULT_GATE_CHECK_SECONDS;
  // g64: a red check runs again before it counts; red then green is reported as flaky, not a round
  const firstRun = runGate(tree, checks, { seconds, knownRed });
  recordGateTimes(root, checks, firstRun);
  const took = (firstRun.checks ?? []).reduce((n, c) => n + (c.tookSeconds ?? 0), 0);
  const split = !only.length && splitAt > 0 && checks.length > 1 && took > splitAt
    ? { tookSeconds: took, splitNote: `the checks took ${took}s in all, past gateSplitSeconds ${splitAt} (g104). From the next run on, gate.js without --check asks for one check per call: ${splitCommands().join(' ; ')}` }
    : {};
  const first = retryRed(tree, checks, firstRun, { retries: config.gateRetry ?? 1, seconds, knownRed });
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
  // g90: a red from a full drive is not the code's
  const disk = !result.ok && diskFull(result.output) ? { diskFull: true, diskNote: 'the output says the drive is full (no space left on device): the red does not come from the code and is not a round. Free space (worktree.js prune removes the build dirs of done tasks), then run the gate again.' } : {};
  // g91: the gate still runs while the queue drains; the result says the routine is due
  const maint = maintenanceState(root, config);
  return { ...result, ...disk, ...(maint.due ? { maintenance: maint } : {}), ...(pruned.length ? { pruned } : {}), ...(only.length ? { only } : {}), ...split, tree, scope: always.length ? { ...scoped.scope, alwaysRun: always.map((c) => c.name) } : scoped.scope, ...(failed.length ? { failed } : {}), ...knownNote, ...hang, ...(idle.waited ? { waited: idle.waited } : {}), ...busy };
  }
});
