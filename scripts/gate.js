#!/usr/bin/env node
// Test gate CLI: runs gateCommands (or testCommand) from team/config.json in the project root. Exits 1 when the tests fail.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, UsageError } from './lib/cli.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { runGate, gateChecks, isCodeless, checkDocGate, waitForIdle, fixable, fixGate, DEFAULT_GATE_WAIT_SECONDS } from './lib/gate.js';
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
  gate.js --task <id> --fix
                      when only checks with a fix command are red (fixable: true; a check's "fix", or the write form of
                      cargo fmt / ruff format / black / prettier --check): runs the fixes, commits them as style(<id>) and
                      runs the gate again; not a round (g44). Refused with uncommitted changes outside team/.
`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

runCli(usage, { task: { type: 'string' }, fix: { type: 'boolean' } }, ({ values, root }) => {
  if (values.fix && values.task === undefined) throw new UsageError('--fix needs --task <id>: the style commit is named after the task');
  if (values.task !== undefined && isCodeless(root, values.task)) {
    const doc = checkDocGate(root, values.task);
    if (!doc.ok) process.exitCode = 1;
    return doc;
  }
  const config = loadConfig({ pluginRoot, projectRoot: root });
  validateConfig(config);
  const checks = gateChecks(config);
  if (checks.length === 0) {
    throw new UsageError('No testCommand in team/config.json. The planner records it in phase 4; ask the owner if it is unknown.');
  }
  const tree = values.task === undefined ? root : taskTree(root, values.task);
  // g31: wait while another run of a check program loads the machine; report it when it outlasts gateWaitSeconds
  // (NAC_GATE_WAIT_SECONDS overrides it for one run; the test suite sets 0)
  const env = process.env.NAC_GATE_WAIT_SECONDS;
  const idle = waitForIdle(checks, { seconds: /^\d+$/.test(env ?? '') ? Number(env) : config.gateWaitSeconds ?? DEFAULT_GATE_WAIT_SECONDS });
  const first = runGate(tree, checks);
  const result = values.fix ? fixGate(tree, checks, first, { id: values.task }) : { ...first, ...(fixable(first, checks) ? { fixable: true } : {}) };
  if (!result.ok) process.exitCode = 1;
  const busy = idle.busy.length
    ? { busy: idle.busy, note: `other runs of the check programs were still running after ${idle.waited}s; a red check may come from the load. Find who started them, wait for them to end and run the gate again before you count a round.` }
    : {};
  return { ...result, tree, ...(idle.waited ? { waited: idle.waited } : {}), ...busy };
});
