// Deterministic checks on the phase 1 research in team/research/, run by the lead before the phase report.
// Formats it relies on (set in the research agent files and skill phase-report):
// - sources.md: table rows "| <id> | <https URL, or a clone note> | ... |", ids like S12 or F3b;
// - citations: ids in brackets, "[S12]", "[S12, F3]" or with a label, "[FACT, S12]";
// - costs.md: a "## Competitor pricing" table "| Competitor | Price | Sources | Pages checked |";
// - recommendations.md: "## Gaps", "## Differentiation", "## Directions", "## Recommendation".
import fs from 'node:fs';
import path from 'node:path';
import { toLines } from './sections.js';

const ID = String.raw`[A-Z]{1,3}\d+[a-z]?`;
const IS_ID = new RegExp(String.raw`^${ID}$`);
const BRACKETS = /\[([^\]\n]{1,200})\]/g;
const SOURCE_ROW = new RegExp(String.raw`^\|\s*(${ID})\s*\|\s*([^|]*?)\s*\|`);
const RECOMMENDATION_HEADINGS = ['Gaps', 'Differentiation', 'Directions', 'Recommendation'];
const REPOSITORY_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'www.npmjs.com', 'pypi.org']);

const idsIn = (list) => list.split(',').map((s) => s.trim()).filter((s) => IS_ID.test(s));
const cited = (text) => [...text.matchAll(BRACKETS)].flatMap((m) => idsIn(m[1]));
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const urls = (text) => text.match(/https:\/\/[^\s,)>\]]+/g) ?? [];
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

function section(text, heading) {
  const lines = toLines(text);
  const start = lines.findIndex((l) => new RegExp(String.raw`^##\s+${heading}\s*$`, 'i').test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##?\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

function checkSources(text, problems) {
  const ids = new Set();
  for (const line of toLines(text)) {
    const m = SOURCE_ROW.exec(line);
    if (!m) continue;
    if (ids.has(m[1])) problems.push(`sources.md: ${m[1]} is defined more than once.`);
    ids.add(m[1]);
    if (!/https:\/\/\S/.test(m[2]) && !/\bclone/i.test(m[2])) problems.push(`sources.md: ${m[1]} needs an https URL (or a clone note) in its second column.`);
  }
  return ids;
}

function checkPricing(text, problems) {
  const rows = section(text, 'Competitor pricing');
  if (!rows) return problems.push('costs.md: no "## Competitor pricing" table (| Competitor | Price | Sources | Pages checked |).');
  for (const line of rows.filter((l) => l.trim().startsWith('|'))) {
    const [name, price = '', sources = '', checked = ''] = cells(line);
    if (!name || /^competitor$/i.test(name) || /^-+$/.test(name.replace(/:/g, ''))) continue;
    if (idsIn(sources.replace(/[[\]]/g, '')).length === 0) problems.push(`costs.md: competitor ${name} has no source id in its Sources column.`);
    if (/not published/i.test(price) && !urls(checked).some((u) => !REPOSITORY_HOSTS.has(hostOf(u)))) {
      problems.push(`costs.md: competitor ${name} is marked "not published" without an official site page in Pages checked (a repository or package page is not enough).`);
    }
  }
}

// Returns a list of problems; empty when the research passes.
export function checkResearch(root) {
  const dir = path.join(root, 'team', 'research');
  const read = (name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : null);
  const problems = [];
  const sources = read('sources.md');
  const ids = sources === null ? new Set() : checkSources(sources, problems);
  if (sources === null) problems.push('sources.md is missing.');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'sources.md' && !f.startsWith('handoff-')) : [];
  for (const f of files.sort()) {
    const text = read(f);
    const refs = cited(text);
    if (refs.length === 0) problems.push(`${f}: cites no source ([S12] style ids from sources.md).`);
    for (const id of new Set(refs)) if (!ids.has(id)) problems.push(`${f}: cites ${id}, which sources.md does not define.`);
  }
  const costs = read('costs.md');
  if (costs === null) problems.push('costs.md is missing.');
  else checkPricing(costs, problems);
  const rec = read('recommendations.md');
  if (rec === null) problems.push('recommendations.md is missing.');
  else for (const h of RECOMMENDATION_HEADINGS) if (!section(rec, h)) problems.push(`recommendations.md: no "## ${h}" section.`);
  return problems;
}
