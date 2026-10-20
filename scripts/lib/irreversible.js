// g23: an owner "go" question for an irreversible or spending step (tag --irreversible) is refused unless the task's
// brief names a go-path test command (a stub runner proving the go flag reaches the executor), that command exits 0
// when run here, and the gate is green. Seen live: a dry run printed the plan and "Nothing was started"; no test ever
// exercised the go path. Naming a test file was not enough either: nothing showed it had run (F6), so the brief now
// carries a command and this check runs it.
// This is a gate check, so it fails closed: any problem or internal error refuses the question.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { teamPaths } from './paths.js';
import { loadConfig } from './config.js';
import { runGate, gateChecks } from './gate.js';

const GO_PATH_LINE = /^[ \t]*(?:[-*][ \t]+)?\**go-path test(?::\**|\**:)[ \t]*(.*)$/im;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const TAIL_LINES = 30;

// "Go-path test: `cmd` (note)" or "Go-path test: cmd": the backticked part when there is one, else the rest of the line.
function commandOf(line) {
  const ticked = /`([^`]+)`/.exec(line);
  return (ticked ? ticked[1] : line).trim();
}

export function irreversibleProblems(root, task, { pluginRoot, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  try {
    const briefFile = path.join(teamPaths(root).tasks, `${task}.md`);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(task) || !fs.existsSync(briefFile)) return [`The brief team/work/tasks/${task}.md does not exist.`];
    const line = GO_PATH_LINE.exec(fs.readFileSync(briefFile, 'utf8'))?.[1];
    const command = line === undefined ? '' : commandOf(line);
    if (!command) return [`The brief of ${task} names no go-path test: add a line "Go-path test: <command>", a command that runs an automated test of the go path with a stub runner (the go flag reaches the executor) and exits 0.`];
    const asFile = path.resolve(root, command);
    if (!/\s/.test(command) && fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
      return [`The go-path test ${command} in the brief is a file, not a command. Write the command that runs it, for example "Go-path test: cargo test --test go_path" (the check runs the command and needs exit 0).`];
    }
    const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    if (r.error?.code === 'ETIMEDOUT') return [`The go-path command '${command}' timed out after ${Math.round(timeoutMs / 1000)}s.`];
    if (r.error) return [`The go-path command '${command}' could not run (${r.error.message}).`];
    if (r.status !== 0) {
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');
      return [`The go-path command '${command}' exited with code ${r.status ?? r.signal}; it must exit 0.${tail ? `\n${tail}` : ''}`];
    }
    const checks = gateChecks(loadConfig({ pluginRoot, projectRoot: root }));
    if (!checks.length) return ['No gate command is configured, so the gate cannot be green on the go-path test.'];
    const gate = runGate(root, checks);
    if (!gate.ok) return [`The gate is not green (${gate.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')} red): fix it first, then ask.`];
    return [];
  } catch (e) {
    return [`The go-path check could not run (${e.message}).`];
  }
}
