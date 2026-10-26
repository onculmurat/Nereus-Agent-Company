// Test gate: runs the project's test command between implement and review, so failing code never reaches a reviewer.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { teamPaths } from './paths.js';
import { readBoard } from './board.js';
import { acceptanceCriteria } from './pack.js';

const TAIL_LINES = 60;
export const DEFAULT_GATE_WAIT_SECONDS = 300;
export const DEFAULT_GATE_MIN_FREE_GB = 20;
// g90: the forms a full drive takes in cargo, rustc, git and node output (Windows os error 112)
export const diskFull = (output) => /no space left on device|ENOSPC|os error 112|not enough space on the disk/i.test(output ?? '');
export const DEFAULT_GATE_CHECK_SECONDS = 1200;
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-bounded.js');

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

// g54: each check has a deadline (gateCheckSeconds, 1200 by default; 0 = none). A check past it is stopped with its
// process tree and reported red with timedOut and its last lines, so the lead sees a hang and where it stopped
// instead of waiting on a gate that never returns.
export function runTestGate(root, command, { seconds = DEFAULT_GATE_CHECK_SECONDS, knownRed = [], expect = [] } = {}) {
  const r = spawnSync(process.execPath, [RUNNER, String(seconds), root, command], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  let run;
  try { run = JSON.parse(r.stdout); } catch { return { ok: false, exitCode: null, skipped: 0, output: r.error?.message ?? `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }; }
  const all = run.output.trimEnd();
  const tail = all.split('\n').slice(-TAIL_LINES).join('\n');
  if (run.timedOut) {
    return { ok: false, exitCode: null, timedOut: true, skipped: parseSkipped(all), output: `${tail}\n[NAC gate: no result after ${seconds}s; the check was stopped with its process tree. A hang, not a red assertion: the lines above show where it stopped.]` };
  }
  // g69: an isolated rerun is green only when every expected test ran and passed; a filter that matched nothing exits 0
  const missing = expect.filter((name) => !new RegExp(`^test ${escapeRe(name)} \\.\\.\\. ok\\s*$`, 'm').test(all));
  if (run.status === 0 && missing.length) return { ok: false, exitCode: 0, skipped: parseSkipped(all), notRun: missing, output: `${tail}\n[NAC gate: ${missing.join(', ')} did not run in the isolated rerun.]` };
  return withFailures(knownRedCheck({ ok: run.status === 0, exitCode: run.status, skipped: parseSkipped(all), output: tail }, all, knownRed), all);
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// g69: the rerun of a red cargo test check ran the whole check again under the same parallel load, so a timing test
// went red twice (Memory Agent T-062: two masker ReDoS budget tests, a developer dispatch for a base red). The rerun
// now runs only the failed tests, one at a time; null when the check is not cargo test or a name is unusual.
export function isolatedCommand(command, names) {
  if (!/^\s*cargo\s+test\b/.test(command) || !names.length || !names.every((n) => /^[\w:]+$/.test(n))) return null;
  const filter = `${names.join(' ')} --exact --test-threads=1`;
  const at = command.indexOf(' -- ');
  return at < 0 ? `${command} -- ${filter}` : `${command.slice(0, at)} -- ${filter} ${command.slice(at + 4)}`;
}

// g65: with --no-fail-fast the output is long and its tail names only the red test binaries (Memory Agent T-060:
// "2 targets failed: hygiene, unsafe_policy"), so a round went on finding the test names. A red check names its
// failed tests and the first lines of each one's panic from cargo's "---- <name> stdout ----" block.
const FAILURE_LINES = 8;
const FAILURES_SHOWN = 10;
export function failureExcerpts(output, names) {
  const lines = output.split('\n');
  const out = {};
  for (const name of names.slice(0, FAILURES_SHOWN)) {
    const at = lines.findIndex((l) => l.trim() === `---- ${name} stdout ----`);
    if (at < 0) continue;
    const body = [];
    for (const l of lines.slice(at + 1)) {
      if (/^---- \S+ stdout ----$/.test(l.trim()) || /^(failures|successes):\s*$/.test(l.trim()) || body.length === FAILURE_LINES) break;
      if (l.trim()) body.push(l.trimEnd());
    }
    out[name] = body.join('\n');
  }
  return out;
}

function withFailures(result, all) {
  if (result.ok || result.timedOut) return result;
  const failed = failedTests(all);
  if (!failed.length) return result;
  const failures = failureExcerpts(all, failed);
  return { ...result, failed, ...(Object.keys(failures).length ? { failures } : {}) };
}

// g64: names of the failed tests in a test run's output (cargo "test x ... FAILED", pytest "FAILED path::x"), and
// whether a build failed: a compile error is never a known red.
export function failedTests(output) {
  const names = new Set();
  for (const m of output.matchAll(/^test (\S+) \.\.\. FAILED\s*$/gm)) names.add(m[1]);
  for (const m of output.matchAll(/^FAILED (\S+)/gm)) names.add(m[1]);
  return [...names];
}
const BUILD_FAILED = /^error(?:\[E\d+\])?: (?:could not compile|aborting due to)/m;
const sameTest = (name, known) => name === known || name.endsWith(`::${known}`);

// A red check whose only failures are gateKnownRed tests comes back ok with knownRed; a known test that passed now
// is reported in knownRedPassed, so its entry can go.
function knownRedCheck(result, all, knownRed) {
  if (!knownRed.length) return result;
  const passed = knownRed.filter((k) => new RegExp(`^test (?:\\S+::)?${k.test.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\.\\.\\. ok\\s*$`, 'm').test(all)).map((k) => k.test);
  const extra = passed.length ? { knownRedPassed: passed } : {};
  if (result.ok || result.timedOut || BUILD_FAILED.test(all)) return { ...result, ...extra };
  const failed = failedTests(all);
  if (!failed.length || !failed.every((f) => knownRed.some((k) => sameTest(f, k.test)))) return { ...result, ...extra };
  return { ...result, ok: true, knownRed: failed, ...extra };
}

// g64: cargo test stops at the first red test binary, so a known environmental red hid every test after it
// (Memory Agent T-058: the gate stopped at data_dir c4_broad_write_acl_warns). The gate runs them all.
export function noFailFast(command) {
  const m = /^(\s*cargo\s+test)\b(.*)$/.exec(command);
  if (!m || /\s--no-fail-fast\b/.test(m[2])) return command;
  return `${m[1]} --no-fail-fast${m[2]}`;
}

// g64: a red check runs again (gateRetry times, 1 by default) before it counts; green on a later run is a flake, not
// a round (Memory Agent T-097: a parallel task's cargo held the package lock, the developer found nothing to fix).
// g69: a red cargo test check with named failures reruns only those tests, one at a time (isolatedCommand).
export function retryRed(root, checks, first, { retries = 1, ...opts } = {}) {
  if (first.ok || retries < 1) return first;
  let result = first;
  const flaky = [];
  for (let i = 0; i < retries; i++) {
    const red = result.checks.filter((c) => !c.ok && !c.timedOut).map((c) => c.name);
    if (!red.length) break;
    const again = new Map(checks.filter((c) => red.includes(c.name)).map((c) => {
      const failed = result.checks.find((r) => r.name === c.name).failed ?? [];
      const alone = isolatedCommand(c.command, failed);
      return [c.name, alone ? { name: c.name, ...runTestGate(root, alone, { ...opts, expect: failed }), isolated: failed } : { name: c.name, ...runTestGate(root, c.command, opts) }];
    }));
    for (const [name, c] of again) if (c.ok) flaky.push(c.isolated ? `${name} (${c.isolated.join(', ')} alone)` : name);
    result = combine(result.checks.map((c) => again.get(c.name) ?? c));
  }
  return flaky.length ? { ...result, flaky, flakyNote: `${flaky.join(', ')} was red and then green with no change: a flake (load, a lock, timing), not a round. Record a finding when it repeats.` } : result;
}

// g18: the gate runs every configured check, not only the tests. gateCommands is an ordered list of
// { name, command }; testCommand stays as an alias for a single "test" entry.
export function gateChecks(config) {
  if (config.gateCommands !== undefined) return config.gateCommands;
  return config.testCommand === undefined ? [] : [{ name: 'test', command: config.testCommand }];
}

// Runs all checks in order (a red one does not stop the later ones) and reports each. The top-level fields keep
// the single-command shape: exitCode and output come from the first red check, or from the last one when all pass.
export function runGate(root, checks, opts) {
  return combine(checks.map((c) => ({ name: c.name, ...runTestGate(root, c.command, opts) })));
}

function combine(checks_) {
  const red = checks_.filter((c) => !c.ok);
  const shown = red[0] ?? checks_[checks_.length - 1];
  const output = checks_.length === 1 ? shown.output : (red.length ? red : [shown]).map((c) => `[${c.name}]\n${c.output}`).join('\n');
  return { ok: red.length === 0, exitCode: shown.exitCode, skipped: checks_.reduce((n, c) => n + c.skipped, 0), output, checks: checks_ };
}

// g44: a gate red on format alone cost a full round (T-081, T-084: the developer dispatched again for whitespace).
// A check can carry `fix`, the command that repairs what it reports; the common format checks get one without it.
const FIX_RULES = [
  [/^(cargo\s+fmt\b.*?)\s+--check\b(.*)$/, (m) => `${m[1]}${m[2]}`],
  [/^(ruff\s+format\b.*?)\s+--check\b(.*)$/, (m) => `${m[1]}${m[2]}`],
  [/^(black\b.*?)\s+--check\b(.*)$/, (m) => `${m[1]}${m[2]}`],
  [/^((?:npx\s+)?prettier\b.*?)\s+(?:--check|-c)\b(.*)$/, (m) => `${m[1]} --write${m[2]}`],
];
export function fixCommand(check) {
  if (typeof check.fix === 'string' && check.fix.trim()) return check.fix;
  const command = check.command.trim();
  for (const [re, to] of FIX_RULES) {
    const m = re.exec(command);
    if (m) return to(m).trim();
  }
  return null;
}

// True when the gate is red and every red check has a fix command: the lead runs `gate.js --fix`, not a round.
export const fixable = (result, checks) => !result.ok && result.checks.filter((c) => !c.ok).every((c) => !c.timedOut && fixCommand(checks.find((k) => k.name === c.name)) !== null);

// Runs the fix commands of the red checks in `tree`, commits what they changed as style(<id>) and runs the gate
// again. Refused when a red check has no fix or the tree holds uncommitted changes outside team/ (they would be swept
// into the style commit).
export function fixGate(tree, checks, first, { id, seconds, knownRed = [] }) {
  const git = (...args) => execFileSync('git', args, { cwd: tree, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  if (first.ok) return { ...first, fixed: [] };
  if (!fixable(first, checks)) throw new Error(`gate --fix: red checks without a fix command: ${first.checks.filter((c) => !c.ok && !fixCommand(checks.find((k) => k.name === c.name))).map((c) => c.name).join(', ')}; this is a round for the implementer`);
  const dirty = git('status', '--porcelain', '--', '.', ':(exclude)team');
  if (dirty) throw new Error(`gate --fix: uncommitted changes outside team/ in ${tree}; the implementer commits them first:\n${dirty}`);
  const red = first.checks.filter((c) => !c.ok).map((c) => checks.find((k) => k.name === c.name));
  const fixes = red.map((c) => ({ name: c.name, command: fixCommand(c), ...runTestGate(tree, fixCommand(c), { seconds }) }));
  const failed = fixes.filter((f) => !f.ok);
  if (failed.length) throw new Error(`gate --fix: the fix command failed: ${failed.map((f) => `[${f.name}] ${f.command}\n${f.output}`).join('\n')}`);
  let commit = null;
  if (git('status', '--porcelain', '--', '.', ':(exclude)team')) {
    git('add', '-u', '--', '.', ':(exclude)team');
    git('commit', '-q', '-m', `style(${id}): ${red.map((c) => c.name).join(', ')} (gate --fix)`);
    commit = git('rev-parse', '--short', 'HEAD');
  }
  const again = runGate(tree, checks, { seconds, knownRed });
  return { ...again, fixed: red.map((c) => c.name), fixCommit: commit };
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

// g55: with --task the gate tests only what the task changed. A Rust gate ran the whole workspace (6 crates, 10-20
// minutes) for every task and every round, also when the task touched one leaf crate. The task's base is its
// `chore(team): <id> start` commit; the changed files since then (committed and not, team/ left out) map to their
// workspace packages, and the packages that depend on them are added, so a change still meets every test it can
// break. `cargo test` and `cargo clippy` then run with -p for those packages; the other checks run as they are.
// Anything outside a package (root manifests, lock file, .cargo, CI) or no base found means the whole workspace.
// The milestone and phase end run the gate without --task.
// Files no test or lint reads: documents, editor and agent settings, CI definitions.
const NOT_BUILT = /^(?:\.claude\/|\.github\/|\.vscode\/|\.gitignore$|\.gitattributes$)|(^|\/)(docs?\/|[^/]+\.md$)/i;

export function taskBase(tree, id) {
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%H', '--fixed-strings', `--grep=chore(team): ${id} start`], { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

export function changedFiles(tree, base) {
  const git = (...args) => execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const committed = git('diff', '--name-only', base, '--').split('\n');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n');
  return [...new Set([...committed, ...untracked].map((f) => f.trim()).filter((f) => f && !f.startsWith('team/')))];
}

// packages: [{ name, dir (relative, '/'-separated), deps: [workspace package names] }]
export function cargoPackages(tree) {
  const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, timeout: 120000 }));
  const names = new Set(meta.packages.map((p) => p.name));
  return meta.packages.map((p) => ({
    name: p.name,
    dir: path.relative(tree, path.dirname(p.manifest_path)).split(path.sep).join('/'),
    deps: [...new Set(p.dependencies.filter((d) => d.path && names.has(d.name)).map((d) => d.name))],
  }));
}

// Returns { packages } with the changed packages and their dependents, or { full: <reason> }.
export function scopePackages(files, packages) {
  if (files.length === 0) return { full: 'no changed files since the task start' };
  const owner = (file) => packages.filter((p) => p.dir === '' || file === p.dir || file.startsWith(`${p.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
  const changed = new Set();
  for (const file of files) {
    const p = owner(file);
    if (p && p.dir !== '') changed.add(p.name);
    else if (!NOT_BUILT.test(file)) return { full: `${file} is outside a workspace package` };
  }
  if (changed.size === 0) return { full: 'only documents and settings changed' };
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of packages) if (!changed.has(p.name) && p.deps.some((d) => changed.has(d))) { changed.add(p.name); grew = true; }
  }
  if (changed.size >= packages.length) return { full: 'every workspace package is changed or depends on a changed one' };
  return { packages: packages.map((p) => p.name).filter((n) => changed.has(n)) };
}

const CARGO_SCOPED = /^(\s*cargo\s+(?:test|clippy))\b(.*)$/;
export function scopeCommand(command, packages) {
  const m = CARGO_SCOPED.exec(command);
  if (!m) return command;
  const rest = m[2].replace(/\s--(?:workspace|all)(?=\s|$)/g, '');
  return `${m[1]}${packages.map((p) => ` -p ${p}`).join('')}${rest}`;
}

// g66: the gateAlwaysRun checks a gate runs beside its own: all of them when the gate is scoped to packages, none
// when it runs the whole workspace (they are part of it then).
export function alwaysRunChecks(scope, list = []) {
  return scope?.packages ? list : [];
}

// The scope for `gate.js --task`: { checks, scope } where scope is { base, packages } or { full: reason }.
export function scopeChecks(tree, id, checks) {
  if (!checks.some((c) => CARGO_SCOPED.test(c.command)) || !fs.existsSync(path.join(tree, 'Cargo.toml'))) return { checks, scope: { full: 'no cargo test or clippy check' } };
  const base = taskBase(tree, id);
  if (!base) return { checks, scope: { full: `no "chore(team): ${id} start" commit to diff from` } };
  let scope;
  try {
    scope = scopePackages(changedFiles(tree, base), cargoPackages(tree));
  } catch (e) {
    return { checks, scope: { full: `could not read the workspace: ${e.message.split('\n')[0]}` } };
  }
  if (scope.full) return { checks, scope };
  return { checks: checks.map((c) => ({ ...c, command: scopeCommand(c.command, scope.packages) })), scope: { base: base.slice(0, 7), packages: scope.packages } };
}
