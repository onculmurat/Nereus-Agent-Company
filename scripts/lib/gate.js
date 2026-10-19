// Test gate: runs the project's test command between implement and review, so failing code never reaches a reviewer.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { teamPaths } from './paths.js';
import { readBoard } from './board.js';
import { acceptanceCriteria } from './pack.js';

const TAIL_LINES = 60;

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
