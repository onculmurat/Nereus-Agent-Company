// The files a task brief names: the code map in the pack (g37) and the scope record at close (1.3.8) read them.
// A brief names them on one line `Files: a/b.rs (new), c/d.rs, ...`; an older brief without it gives its backticked paths.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TEST_RE } from './findings.js';

const MAP_LINES_PER_FILE = 40;
const MAP_LINE_CHARS = 160;
export const MAP_MAX_CHARS = 8000;

const clean = (p) => p.trim().replace(/\s*\(new\)$/i, '').replace(/^`|`$/g, '').replace(/:\d+(-\d+)?$/, '').replace(/\\/g, '/').replace(/^\.\//, '');
const usable = (p) => p && /\//.test(p) || /\.[A-Za-z0-9]+$/.test(p);
const kept = (p) => usable(p) && !/^https?:/.test(p) && !p.startsWith('team/') && !p.startsWith('/') && !p.includes('..') && !/^[A-Za-z]:/.test(p);

// Splits on commas outside parentheses: a note like `a.rs (read only, unless x)` stays one item (g43, T-084).
const splitTop = (s) => {
  const items = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  return [...items, cur];
};
// One Files: item to its path: the notes in parentheses, a leading "new" and backticks are not part of it.
const itemPath = (item) => item.replace(/\([^)]*\)?/g, ' ').replace(/`/g, ' ').trim().replace(/^new\s+/i, '').split(/\s+/)[0] ?? '';

// { line: true|false, files: [...] }: line is true when the brief has a Files: line (the planner's list).
export function briefFiles(brief) {
  const m = /^[ \t]*(?:[-*][ \t]*)?Files:[ \t]*(.+)$/im.exec(brief);
  if (m) return { line: true, files: [...new Set(splitTop(m[1]).map(itemPath).map(clean).filter(kept))] };
  // Backticked text is often a symbol, a call or an env path (`%LOCALAPPDATA%/x`, `store::open(a/b)`): plain paths only.
  const ticked = [...brief.matchAll(/`([^`\s]+)`/g)].map((t) => clean(t[1])).filter((p) => kept(p) && /\//.test(p) && /^[A-Za-z0-9._/-]+$/.test(p));
  return { line: false, files: [...new Set(ticked)] };
}

// Declaration lines per language; a file type without an entry gets no outline.
const DECLS = {
  rs: /^\s*(pub(\([^)]*\))?\s+)?((async|unsafe|const|extern)\s+)*(fn|struct|enum|trait|impl|mod|type|const|static|macro_rules!)[\s<!(]/,
  js: /^(export\s+)?(default\s+)?(async\s+)?(function\*?|class|const|let)\s+[A-Za-z_$]|^\s*(test|describe)\(/,
  ts: /^(export\s+)?(default\s+)?(declare\s+)?(async\s+)?(abstract\s+)?(function\*?|class|interface|type|enum|const|let)\s+[A-Za-z_$]|^\s*(test|describe|it)\(/,
  py: /^\s*(async\s+)?(def|class)\s+\w/,
  go: /^(func|type)\s/,
  md: /^#{1,4}\s/,
};
const LANG = { rs: 'rs', js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', mts: 'ts', py: 'py', go: 'go', md: 'md' };

function outline(abs) {
  const re = DECLS[LANG[path.extname(abs).slice(1).toLowerCase()]];
  if (!re) return null;
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const hits = [];
  lines.forEach((l, i) => { if (re.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, MAP_LINE_CHARS)}`); });
  const more = hits.length > MAP_LINES_PER_FILE ? `\n... ${hits.length - MAP_LINES_PER_FILE} more declarations` : '';
  return { lines: lines.at(-1) === '' ? lines.length - 1 : lines.length, text: hits.slice(0, MAP_LINES_PER_FILE).join('\n') + more };
}

// The pack section: per named file its declaration lines with line numbers, or what it is (new, directory, no outline).
export function codeMap(tree, brief) {
  const { line, files } = briefFiles(brief);
  if (!files.length) return null;
  const parts = [];
  const left = [];
  let size = 0;
  for (const f of files) {
    const abs = path.resolve(tree, f);
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    let part;
    // Only the planner's Files: line declares a new file; a backticked path that does not exist is left out.
    if (!st && !line) continue;
    if (!st) part = `### ${f}\n\nnew file (not in the tree yet)`;
    else if (st.isDirectory()) part = `### ${f}\n\ndirectory`;
    else {
      const o = outline(abs);
      part = o ? `### ${f} (${o.lines} lines)\n\n\`\`\`\n${o.text || '(no declarations found)'}\n\`\`\`` : `### ${f}\n\nno outline for this file type`;
    }
    if (size + part.length > MAP_MAX_CHARS) { left.push(f); continue; }
    size += part.length;
    parts.push(part);
  }
  const source = line ? "the brief's Files: line" : 'the paths the brief names (it has no Files: line)';
  const tail = left.length ? `\n\nNot mapped (size limit): ${left.join(', ')}` : '';
  return `## Code map\n\nDeclarations of the files from ${source}, with line numbers. It is a map, not the code: read only the lines you need. A file the brief does not name is not here.\n\n${parts.join('\n\n')}${tail}`;
}

const LOCK_RE = /(^|\/)(Cargo\.lock|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$/;
const REGISTRATION_RE = /(^|\/)(lib\.rs|mod\.rs|main\.rs|index\.(js|ts|mjs|cjs)|__init__\.py)$/;
const FIXTURE_RE = /(^|\/)(fixtures?|golden|snapshots|__snapshots__|testdata)\//;

export function classify(file) {
  if (LOCK_RE.test(file)) return 'lock';
  if (REGISTRATION_RE.test(file)) return 'registration';
  if (FIXTURE_RE.test(file)) return 'fixture';
  if (TEST_RE.test(file)) return 'test';
  return 'other';
}

const filesOf = (root, sha) => execFileSync('git', ['show', '--name-only', '--format=', sha], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  .split('\n').map((f) => f.trim()).filter(Boolean);

// The scope record of a closed code task: which changed files the brief names, the others by kind, and team/ files
// that went into a code commit. A record, not a check: nothing is refused.
export function scopeRecord(root, { id, commits, brief }) {
  const { line, files } = briefFiles(brief ?? '');
  const changed = new Set();
  const teamFiles = [];
  for (const sha of commits ?? []) {
    for (const f of filesOf(root, sha)) {
      if (f.startsWith('team/')) teamFiles.push(`${sha}: ${f}`);
      else changed.add(f);
    }
  }
  const named = (f) => files.some((n) => f === n || f.startsWith(n.endsWith('/') ? n : `${n}/`));
  const extras = { lock: [], registration: [], fixture: [], test: [], other: [] };
  let covered = 0;
  for (const f of changed) {
    if (named(f)) covered += 1;
    else extras[classify(f)].push(f);
  }
  return {
    id, filesLine: line, named: files.length, changed: changed.size, covered,
    coveragePct: changed.size ? Math.round((covered / changed.size) * 100) : null, extras, teamFiles,
  };
}
