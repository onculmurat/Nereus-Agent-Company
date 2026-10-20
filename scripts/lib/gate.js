// Test gate: runs the project's test command between implement and review, so failing code never reaches a reviewer.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { teamPaths } from './paths.js';
import { readBoard } from './board.js';
import { acceptanceCriteria } from './pack.js';

const TAIL_LINES = 60;
export const DEFAULT_GATE_WAIT_SECONDS = 300;

// g31: a developer's `cargo test` left running in the background (turn budget reached) loaded the machine, and the
// lead's gate went red twice on timing tests. Before it runs, the gate waits while a process of one of its own check
// programs (program + first argument, for example "cargo test") is running, and says so when it could not wait it out.
function splitArgs(line) {
  const out = [];
  for (const m of String(line).matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2]);
  return out;
}
const programName = (token) => path.basename(String(token).replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

// [{ program, args }] for every command segment of the checks; env assignments and cd segments are skipped. A
// subcommand ("cargo test", "pytest tests") matches on the program and that word; a check whose first argument is a
// flag ("node -e ...", "node --test") matches only the same command, so unrelated runs of a common program never count.
export function checkPrograms(checks) {
  const out = [];
  for (const c of checks) {
    for (const seg of c.command.split(/&&|\|\||;|\|/)) {
      const words = splitArgs(seg);
      while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
      if (!words.length || programName(words[0]) === 'cd') continue;
      const rest = words.slice(1);
      const p = { program: programName(words[0]), args: rest.length && rest[0].startsWith('-') ? rest : rest.slice(0, 1) };
      if (!out.some((o) => o.program === p.program && o.args.join('\0') === p.args.join('\0'))) out.push(p);
    }
  }
  return out;
}

// The processes (from listProcesses) that run one of the programs, leaving out `exclude` pids.
export function busyProcesses(programs, processes, exclude = []) {
  return processes.filter((p) => {
    if (exclude.includes(p.pid) || !p.cmd) return false;
    const [first, ...rest] = splitArgs(p.cmd);
    return programs.some((g) => programName(first) === g.program && g.args.every((a, i) => rest[i] === a));
  });
}

// [{ pid, ppid, cmd }] of the running processes; [] when they cannot be listed (the gate then runs as before).
export function listProcesses() {
  try {
    if (process.platform === 'win32') {
      const json = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
      return [].concat(JSON.parse(json)).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, cmd: p.CommandLine ?? '' }));
    }
    return execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }));
  } catch {
    return [];
  }
}

// This process and its ancestors: the gate's own shell or caller never counts as busy.
function selfAndAncestors(processes) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const out = [process.pid];
  for (let pid = process.ppid; pid && !out.includes(pid); pid = byPid.get(pid)?.ppid) out.push(pid);
  return out;
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Waits up to `seconds` while a check program is running. Returns { waited: seconds waited, busy: [{ pid, cmd }] still running }.
// seconds 0 turns the check off.
export function waitForIdle(checks, { seconds = DEFAULT_GATE_WAIT_SECONDS, pollMs = 5000, list = listProcesses, sleep = sleepSync, clock = Date.now } = {}) {
  if (seconds === 0) return { waited: 0, busy: [] };
  const programs = checkPrograms(checks);
  const start = clock();
  for (;;) {
    const procs = list();
    const busy = busyProcesses(programs, procs, selfAndAncestors(procs));
    const waited = Math.round((clock() - start) / 1000);
    if (!busy.length || waited >= seconds) return { waited, busy: busy.map(({ pid, cmd }) => ({ pid, cmd })) };
    sleep(pollMs);
  }
}

// Skipped tests as the runners report them, summed over the whole output:
// cargo "N ignored", node --test "skipped N" / "todo N", pytest "N skipped", jest and vitest "N skipped" / "N todo".
// A test that prints "skip" and returns passes silently; no runner counts it, so the review rule catches that form.
export function parseSkipped(output) {
  const text = String(output).replace(/\u001b\[[0-9;]*m/g, '');
  let total = 0;
  for (const m of text.matchAll(/\b(\d+) ignored;/g)) total += Number(m[1]);
  for (const m of text.matchAll(/^(?:ℹ|#)\s+(?:skipped|todo)\s+(\d+)\s*$/gm)) total += Number(m[1]);
  for (const line of text.split('\n')) {
    if (/\bin \d/.test(line) && /\b\d+ (?:passed|failed|errors?)\b/.test(line)) total += Number(/\b(\d+) skipped\b/.exec(line)?.[1] ?? 0);
    if (/^\s*Tests:?\s/.test(line)) for (const m of line.matchAll(/\b(\d+) (?:skipped|todo)\b/g)) total += Number(m[1]);
  }
  return total;
}

export function runTestGate(root, command) {
  const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, exitCode: null, skipped: 0, output: r.error.message };
  const all = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd();
  return { ok: r.status === 0, exitCode: r.status, skipped: parseSkipped(all), output: all.split('\n').slice(-TAIL_LINES).join('\n') };
}

// g18: the gate runs every configured check, not only the tests. gateCommands is an ordered list of
// { name, command }; testCommand stays as an alias for a single "test" entry.
export function gateChecks(config) {
  if (config.gateCommands !== undefined) return config.gateCommands;
  return config.testCommand === undefined ? [] : [{ name: 'test', command: config.testCommand }];
}

// Runs all checks in order (a red one does not stop the later ones) and reports each. The top-level fields keep
// the single-command shape: exitCode and output come from the first red check, or from the last one when all pass.
export function runGate(root, checks) {
  const checks_ = checks.map((c) => ({ name: c.name, ...runTestGate(root, c.command) }));
  const red = checks_.filter((c) => !c.ok);
  const shown = red[0] ?? checks_[checks_.length - 1];
  const output = checks_.length === 1 ? shown.output : (red.length ? red : [shown]).map((c) => `[${c.name}]\n${c.output}`).join('\n');
  return { ok: red.length === 0, exitCode: shown.exitCode, skipped: checks_.reduce((n, c) => n + c.skipped, 0), output, checks: checks_ };
}

// Default checks per detected stack, for setup. Fails open: an unreadable manifest just means no suggestion.
export function detectGateCommands(root) {
  const out = [];
  try {
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
      out.push({ name: 'test', command: 'cargo test' }, { name: 'clippy', command: 'cargo clippy --all-targets -- -D warnings' }, { name: 'fmt', command: 'cargo fmt --check' });
      if (fs.existsSync(path.join(root, 'deny.toml'))) out.push({ name: 'deny', command: 'cargo deny check' });
    } else if (fs.existsSync(path.join(root, 'package.json'))) {
      const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^﻿/, '')).scripts ?? {};
      if (scripts.test) out.push({ name: 'test', command: 'npm test' });
      if (scripts.lint) out.push({ name: 'lint', command: 'npm run lint' });
    }
  } catch {
    return [];
  }
  return out;
}

// Tasks that produce no code (spikes, research, docs only) have no tests to run. The board entry or the brief marks
// them `code: no`; the brief names the report with an `Output: <path>` line, and the gate checks that file instead.
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const CODE_NO = /^\s*(?:[-*]\s+)?\**code(?::\**|\**:)\s*no\b/im;
const OUTPUT_LINE = /^\s*(?:[-*]\s+)?\**(?:output|report)(?::\**|\**:)\s*`?([^`\n]+?)`?\s*$/im;
const VERDICT_LINE = /^\s*(?:[-*]\s+)?\**[Vv]erdict(?::\**|\**:)\s*(GO-WITH-CHANGES|NO-GO|GO)\s*\**\s*$/m;

const briefPath = (root, id) => {
  if (!ID_RE.test(id ?? '')) throw new Error(`Invalid task id "${id}"`);
  return path.join(teamPaths(root).tasks, `${id}.md`);
};
const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

export function isCodeless(root, id) {
  if (readBoard(root).entries.find((e) => e.id === id)?.code === 'no') return true;
  return CODE_NO.test(readIf(briefPath(root, id)) ?? '');
}

export function checkDocGate(root, id) {
  const problems = [];
  const result = (extra = {}) => ({ ok: problems.length === 0, mode: 'document', task: id, ...extra, problems });
  const brief = readIf(briefPath(root, id));
  if (brief === null) {
    problems.push(`The brief team/work/tasks/${id}.md does not exist, so the report file is unknown.`);
    return result();
  }
  const named = OUTPUT_LINE.exec(brief)?.[1].trim();
  if (!named) {
    problems.push('The brief has no "Output: <path>" line naming the report file.');
    return result();
  }
  const file = path.resolve(root, named);
  const rel = path.relative(path.resolve(root), file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    problems.push(`The report file ${named} must be inside the project.`);
    return result({ file });
  }
  const text = readIf(file);
  if (text === null) {
    problems.push(`The report file ${named} does not exist.`);
    return result({ file });
  }
  const verdict = VERDICT_LINE.exec(text)?.[1] ?? null;
  if (!verdict) problems.push('The report has no verdict line ("Verdict: GO", "Verdict: GO-WITH-CHANGES" or "Verdict: NO-GO").');
  const criteria = acceptanceCriteria(text);
  if (!criteria || criteria.split('\n').slice(1).every((l) => !l.trim())) problems.push('The report has no acceptance criteria section (a heading naming them, with content).');
  return result({ file, verdict });
}
