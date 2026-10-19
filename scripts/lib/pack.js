// Context pack: one file that holds everything a role needs for a task, so the role starts from it
// instead of exploring the repo. Brief verbatim, then the spec/contract/threat/decision text the brief names.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { teamPaths } from './paths.js';
import { loadConfig } from './config.js';
import { toLines } from './sections.js';

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const ROLE_RE = /^[a-z][a-z0-9-]{0,63}$/;
const BASE_RE = /^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,127}$/;
const GATE_TAIL_LINES = 60;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const budgetLine = (root) => {
  const n = loadConfig({ pluginRoot, projectRoot: root }).callBudget;
  return `Budget: ${n} tool calls. When you reach it, stop and report what is done, what is left and what you need.`;
};
const uniq = (list) => [...new Set(list)];

// References in a brief header such as:
//   Spec: **5.4** (note), **2.3 adim 2**, **3**; mcp-tools 1.3; threat-model T5, N1.
//   Kararlar: D-086, D-087
export function parseRefs(text) {
  const lines = toLines(text);
  const specSections = [];
  const contracts = [];
  const threats = [];
  for (const line of lines) {
    if (/\bspec\b|contract/i.test(line)) {
      for (const m of line.matchAll(/\*\*(\d+(?:\.\d+)*)\b[^*]*\*\*/g)) specSections.push(m[1]);
      for (const m of line.matchAll(/(?<![\w-])([a-z]+(?:-[a-z]+)+)\s+(\d+(?:\.\d+)*)\b/g)) {
        if (m[1] !== 'threat-model') contracts.push(`${m[1]} ${m[2]}`);
      }
    }
    const t = /threat-model\s+([^;\n]*)/i.exec(line);
    if (t) for (const m of t[1].matchAll(/\b([A-Z]\d{1,3})\b/g)) threats.push(m[1]);
  }
  return {
    specSections: uniq(specSections),
    contracts: uniq(contracts).map((c) => { const [name, section] = c.split(' '); return { name, section }; }),
    threats: uniq(threats),
    decisions: uniq([...text.matchAll(/\bD-\d{3}\b/g)].map((m) => m[0])),
  };
}

// Heading lines outside code fences: [{ index, level, title }].
function headings(lines) {
  const out = [];
  let fence = null;
  lines.forEach((line, index) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) out.push({ index, level: h[1].length, title: h[2] });
  });
  return out;
}

function blockAt(lines, hs, i) {
  const next = hs.slice(i + 1).find((h) => h.level <= hs[i].level);
  return lines.slice(hs[i].index, next ? next.index : lines.length).join('\n').trimEnd();
}

// The section whose heading starts with the number ("5.4"), up to the next heading of the same or a higher level.
export function extractSection(text, number) {
  const lines = toLines(text);
  const hs = headings(lines);
  const i = hs.findIndex((h) => new RegExp(String.raw`^${number.replace(/\./g, '\\.')}\.?(\s|$)`).test(h.title));
  return i < 0 ? null : blockAt(lines, hs, i);
}

function extractDecision(text, id) {
  const lines = toLines(text);
  const hs = headings(lines);
  const i = hs.findIndex((h) => h.title.startsWith(`${id}:`) || h.title === id);
  return i < 0 ? null : blockAt(lines, hs, i);
}

// A threat is a table row "| T5 | ..." (kept with its table header) or a heading "T5 ...".
function extractThreat(text, id) {
  const lines = toLines(text);
  const row = lines.findIndex((l) => new RegExp(String.raw`^\|\s*${id}\s*\|`).test(l));
  if (row >= 0) {
    let top = row;
    while (top > 0 && lines[top - 1].startsWith('|')) top -= 1;
    const header = lines[top + 1] && /^\|[\s:|-]+\|?\s*$/.test(lines[top + 1]) ? [lines[top], lines[top + 1]] : [];
    return [...header, lines[row]].join('\n');
  }
  const hs = headings(lines);
  const i = hs.findIndex((h) => new RegExp(String.raw`^${id}\b`).test(h.title));
  return i < 0 ? null : blockAt(lines, hs, i);
}

const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const fenceFor = (text) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

function gitDiff(root, base) {
  if (!BASE_RE.test(base)) throw new Error(`Invalid base "${base}"`);
  try {
    return execFileSync('git', ['diff', base], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`git diff ${base} failed: ${String(e.stderr || e.message).trim()}`);
  }
}

function gateTail(file) {
  let text = fs.readFileSync(file, 'utf8');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.output === 'string') text = parsed.output;
  } catch { /* plain text output */ }
  return text.trimEnd().split('\n').slice(-GATE_TAIL_LINES).join('\n');
}

export function buildPack(root, { id, role, base, gate }) {
  if (!ID_RE.test(id ?? '')) throw new Error(`Invalid task id "${id}"`);
  if (!ROLE_RE.test(role ?? '')) throw new Error(`Invalid role "${role}"`);
  const p = teamPaths(root);
  const briefFile = path.join(p.work, 'tasks', `${id}.md`);
  const brief = readIf(briefFile);
  if (brief === null) throw new Error(`No task brief at ${briefFile}`);

  const refs = parseRefs(brief);
  const notFound = [];
  const parts = [`# Pack: ${id} for ${role}\n\n${budgetLine(root)}`, `## Task brief\n\n${brief.trimEnd()}`];

  const spec = readIf(p.spec);
  for (const n of refs.specSections) {
    const s = spec === null ? null : extractSection(spec, n);
    if (s) parts.push(`## Spec ${n}\n\n${s}`);
    else notFound.push(`spec ${n}`);
  }
  for (const { name, section } of refs.contracts) {
    const file = path.join(p.contracts, `${name}.md`);
    const text = /^[a-z0-9-]+$/.test(name) ? readIf(file) : null;
    const s = text === null ? null : extractSection(text, section);
    if (s) parts.push(`## Contract ${name} ${section}\n\n${s}`);
    else notFound.push(`contract ${name} ${section}`);
  }
  const threatModel = readIf(p.threatModel);
  for (const t of refs.threats) {
    const s = threatModel === null ? null : extractThreat(threatModel, t);
    if (s) parts.push(`## Threat ${t}\n\n${s}`);
    else notFound.push(`threat ${t}`);
  }
  const decisions = readIf(p.decisions);
  const found = [];
  for (const d of refs.decisions) {
    const s = decisions === null ? null : extractDecision(decisions, d);
    if (s) found.push(s);
    else notFound.push(`decision ${d}`);
  }
  if (found.length) parts.push(`## Decisions\n\n${found.join('\n\n')}`);
  if (notFound.length) parts.push(`## Not found\n\n${notFound.map((n) => `- ${n}`).join('\n')}`);
  if (base !== undefined) {
    const diff = gitDiff(root, base).trimEnd();
    const fence = fenceFor(diff);
    parts.push(`## Diff against ${base}\n\n${fence}diff\n${diff}\n${fence}`);
  }
  if (gate !== undefined) {
    const tail = gateTail(gate);
    const fence = fenceFor(tail);
    parts.push(`## Gate output (tail)\n\n${fence}\n${tail}\n${fence}`);
  }
  return { text: `${parts.join('\n\n')}\n`, notFound };
}

export function writePack(root, opts) {
  const { text, notFound } = buildPack(root, opts);
  const dir = teamPaths(root).packs;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${opts.id}-${opts.role}.md`);
  fs.writeFileSync(file, text);
  return { path: file, chars: text.length, notFound };
}
