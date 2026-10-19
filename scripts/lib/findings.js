// team/findings/<module>.md: non-blocking review findings collected per module and fixed in one pinpoint round.
// One table row per finding. Only the lead writes it (through scripts/findings.js).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { teamPaths } from './paths.js';
import { loadConfig } from './config.js';
import { nextId } from './sections.js';

export const SEVERITIES = ['blocker', 'hardening', 'minor'];
// Findings that count toward the hardening threshold: open, not minor, not migrated in bulk, not from a hardening task.
export const counts = (f) => f.status === 'open' && f.severity !== 'minor' && !f.migrated && f.origin !== 'hardening';
export const ORIGINS = ['hardening'];
export const CLASSES = ['observed', 'known', 'theoretical'];
const MODULE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ID_RE = /^F-\d{3,}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const COLUMNS = ['id', 'status', 'severity', 'class', 'task', 'location', 'symbol', 'text', 'commit', 'origin', 'migrated'];
const MAX_SITES = 40;

const findingsDir = (root) => path.join(teamPaths(root).team, 'findings');
const fileOf = (root, module) => path.join(findingsDir(root), `${module}.md`);
const cell = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const uncell = (v) => v.trim().replace(/\\\|/g, '|');

function checkModule(module) {
  if (!MODULE_RE.test(module ?? '')) throw new Error(`Invalid module "${module}": letters, digits, dot, dash and underscore only`);
}

function parseRow(line, module) {
  if (!/^\| F-\d+ \|/.test(line)) return null;
  const cells = line.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(uncell);
  const f = Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i] ?? '']));
  const at = f.location.lastIndexOf(':');
  return { id: f.id, module, status: f.status, severity: f.severity, class: f.class, task: f.task, file: f.location.slice(0, at), line: Number(f.location.slice(at + 1)), symbol: f.symbol, text: f.text, commit: f.commit, origin: f.origin, migrated: f.migrated === 'yes' };
}

function readModule(root, module) {
  const file = fileOf(root, module);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => parseRow(l, module)).filter(Boolean);
}

function writeModule(root, module, rows) {
  fs.mkdirSync(findingsDir(root), { recursive: true });
  const head = [`# Findings: ${module}`, '', `| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`];
  const body = rows.map((f) => `| ${[f.id, f.status, f.severity, f.class, f.task, `${f.file}:${f.line}`, f.symbol, f.text, f.commit, f.origin, f.migrated ? 'yes' : ''].map(cell).join(' | ')} |`);
  fs.writeFileSync(fileOf(root, module), `${[...head, ...body].join('\n')}\n`);
}

export function listFindings(root, { module, open = false } = {}) {
  let modules = [];
  if (module !== undefined) {
    checkModule(module);
    modules = [module];
  } else if (fs.existsSync(findingsDir(root))) {
    modules = fs.readdirSync(findingsDir(root)).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).sort();
  }
  const all = modules.flatMap((m) => readModule(root, m));
  return open ? all.filter((f) => f.status === 'open') : all;
}

// A finding's file must lie inside the project (the pack reads it).
function inside(root, file) {
  const abs = path.resolve(root, file);
  const rel = path.relative(path.resolve(root), abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? abs : null;
}

export function addFinding(root, { module, file, line, symbol = '', severity, class: cls, task, text, origin = '', migrated = false, pluginRoot }) {
  checkModule(module);
  if (!SEVERITIES.includes(severity)) throw new Error(`--severity must be one of ${SEVERITIES.join(', ')}; got "${severity}"`);
  if (!CLASSES.includes(cls)) throw new Error(`--class must be one of ${CLASSES.join(', ')}; got "${cls}"`);
  if (origin && !ORIGINS.includes(origin)) throw new Error(`--origin must be ${ORIGINS.join(' or ')}; got "${origin}"`);
  if (!/^\d+$/.test(String(line)) || Number(line) < 1) throw new Error(`--line must be a positive number; got "${line}"`);
  if (!inside(root, file)) throw new Error(`--file "${file}" must be a path inside the project`);
  if (!String(text ?? '').trim()) throw new Error('--text must not be empty');
  const all = listFindings(root);
  const f = { id: nextId('F', all.map((x) => x.id)), module, status: 'open', severity, class: cls, task, file: file.replace(/\\/g, '/'), line: Number(line), symbol, text: String(text).replace(/\r?\n/g, ' ').trim(), commit: '', origin, migrated: Boolean(migrated) };
  writeModule(root, module, [...readModule(root, module), f]);
  const inModule = [...all.filter((x) => x.module === module), f];
  const open = inModule.filter((x) => x.status === 'open').length;
  const counted = inModule.filter(counts).length;
  const batch = loadConfig({ pluginRoot, projectRoot: root }).findingsBatch;
  return { ...f, open, counted, hardeningDue: counted >= batch, findingsBatch: batch };
}

export function closeFinding(root, id, { commit }) {
  if (!ID_RE.test(id ?? '')) throw new Error(`Invalid finding id "${id}"`);
  if (!SHA_RE.test(commit ?? '')) throw new Error(`"${commit}" is not a commit sha (7-40 hex characters). Read it from git: git log -1 --format=%h`);
  const f = listFindings(root).find((x) => x.id === id);
  if (!f) throw new Error(`No finding ${id}`);
  const rows = readModule(root, f.module);
  const row = rows.find((x) => x.id === id);
  row.status = 'closed';
  row.commit = commit;
  writeModule(root, f.module, rows);
  return row;
}

// ---- Hardening pack: the open findings of one module with the lines around them and what else uses the symbol. ----

export const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.|_test\./;
const FN_RES = [/\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/, /\bfn\s+([A-Za-z_]\w*)/, /\bdef\s+([A-Za-z_]\w*)/, /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/];

// The function that holds the line, found by a plain look upwards; '' when nothing looks like one.
function enclosingName(lines, line) {
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    for (const re of FN_RES) {
      const m = re.exec(lines[i]);
      if (m) return m[1];
    }
  }
  return '';
}

// Lines of tracked files that mention the symbol: [{ file, line, text }]. Not a git repository: none.
function sitesOf(root, symbol) {
  if (!symbol) return [];
  const word = /^[\w$]+$/.test(symbol);
  try {
    const out = execFileSync('git', ['grep', '-n', '-I', '-F', ...(word ? ['-w'] : []), '-e', symbol], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).map((l) => /^(.*?):(\d+):(.*)$/.exec(l)).filter(Boolean).map((m) => ({ file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) }));
  } catch {
    return [];
  }
}

function section(root, f, n) {
  const abs = inside(root, f.file);
  const lines = abs && fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split(/\r?\n/) : null;
  const out = [`## ${f.id} (${f.severity}, ${f.class}, task ${f.task})`, '', f.text, '', `Address: \`${f.file}:${f.line}\`${f.symbol ? ` symbol \`${f.symbol}\`` : ''}`, ''];
  let symbol = f.symbol;
  if (!lines) {
    out.push(`(file ${f.file} not found)`, '');
  } else {
    const from = Math.max(1, f.line - n);
    const to = Math.min(lines.length, f.line + n);
    out.push('```', ...lines.slice(from - 1, to).map((t, i) => `${String(from + i).padStart(4)}${from + i === f.line ? ' >' : '  '}${t}`), '```', '');
    if (!symbol) symbol = enclosingName(lines, f.line);
  }
  const own = (s) => s.file === f.file && s.line >= f.line - n && s.line <= f.line + n;
  const sites = sitesOf(root, symbol).filter((s) => !own(s));
  const fmt = (s) => `- ${s.file}:${s.line}: ${s.text}`;
  const code = sites.filter((s) => !TEST_RE.test(s.file));
  const tests = sites.filter((s) => TEST_RE.test(s.file));
  out.push(`Impact sites${symbol ? ` for \`${symbol}\`${f.symbol ? '' : ' (enclosing function)'}` : ''}:`, ...(code.length ? code.slice(0, MAX_SITES).map(fmt) : ['- none found']), '');
  out.push('Tests that reference it:', ...(tests.length ? tests.slice(0, MAX_SITES).map(fmt) : ['- none found']), '');
  return out.join('\n');
}

export function packFindings(root, module, { context = 15 } = {}) {
  checkModule(module);
  if (!Number.isInteger(context) || context < 0) throw new Error(`--context must be a whole number of lines, 0 or more; got ${context}`);
  const open = listFindings(root, { module, open: true });
  if (!open.length) throw new Error(`Module ${module} has no open findings`);
  const bad = open.find((f) => !inside(root, f.file));
  if (bad) throw new Error(`${bad.id}: file "${bad.file}" is outside the project`);
  const head = [`# Hardening pack: ${module}`, '', `Open findings: ${open.map((f) => f.id).join(', ')}. Read only the addresses and impact sites below; do not scan the rest of the module. The review covers only these items and the diff.`, ''];
  const text = `${[...head, ...open.map((f) => section(root, f, context))].join('\n')}\n`;
  const dir = teamPaths(root).packs;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${module}-hardening.md`);
  fs.writeFileSync(file, text);
  return { path: file, module, findings: open.map((f) => f.id), chars: text.length };
}
