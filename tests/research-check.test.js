import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { checkResearch } from '../scripts/lib/research-check.js';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'research-check.js');

const SOURCES = `# Sources

| Id | URL | Note |
|---|---|---|
| S1 | https://github.com/acme/tool | README |
| S2 | https://acme.dev/pricing | pricing page |
| F1 | https://cloud.example.com/pricing | hosting |
`;

const COSTS = `# Costs

Hosting is 5 USD a month [F1].

## Competitor pricing

| Competitor | Price | Sources | Pages checked |
|---|---|---|---|
| acme | 30 USD/month | [S2] | https://acme.dev/pricing |
`;

const RECOMMENDATIONS = `# Recommendations

## Gaps
acme measures with its own harness only [S1].

## Differentiation
Independent measurement.

## Directions
A, B, C.

## Recommendation
B.
`;

function project(files = {}) {
  const root = makeProject();
  const dir = path.join(root, 'team', 'research');
  fs.mkdirSync(dir, { recursive: true });
  const all = { 'sources.md': SOURCES, 'costs.md': COSTS, 'recommendations.md': RECOMMENDATIONS, 'competitors.md': 'acme is open core [S1, S2].\n', ...files };
  for (const [name, text] of Object.entries(all)) if (text !== null) fs.writeFileSync(path.join(dir, name), text);
  return root;
}

test('complete research passes', () => {
  assert.deepEqual(checkResearch(project()), []);
});

test('missing sources, costs or recommendations are reported', () => {
  const problems = checkResearch(project({ 'sources.md': null, 'costs.md': null, 'recommendations.md': null }));
  for (const f of ['sources.md', 'costs.md', 'recommendations.md']) assert.ok(problems.some((p) => p.includes(f)), f);
});

test('every source row needs an https URL and a unique id', () => {
  const problems = checkResearch(project({ 'sources.md': `${SOURCES}| S3 | see README | x |\n| S1 | https://other.dev | dup |\n` }));
  assert.ok(problems.some((p) => /S3/.test(p) && /https/.test(p)));
  assert.ok(problems.some((p) => /S1/.test(p) && /more than once/.test(p)));
});

test('real-world formats pass: a URL with a note, a clone note, a labelled citation, plain ids in the pricing table', () => {
  const sources = `${SOURCES}| S4 | https://acme.dev/ (also https://acme.dev/pro) | current |\n| S5 | acme source, read-only clone via clone.js | main |\n`;
  const pricing = COSTS.replace('| [S2] |', '| S2, S4 |');
  assert.deepEqual(checkResearch(project({ 'sources.md': sources, 'costs.md': pricing, 'competitors.md': '[FACT, S4, S5] acme indexes with FTS5.\n' })), []);
});

test('a cited id must exist in sources.md', () => {
  const problems = checkResearch(project({ 'competitors.md': 'acme is open core [S1, S9].\n' }));
  assert.ok(problems.some((p) => /competitors\.md/.test(p) && /S9/.test(p)));
});

test('a report file that cites nothing is reported; hand-offs are exempt', () => {
  const problems = checkResearch(project({ 'technology.md': 'tree-sitter is mature.\n', 'handoff-researcher.md': 'done\n' }));
  assert.ok(problems.some((p) => /technology\.md/.test(p) && /no source/.test(p)));
  assert.ok(!problems.some((p) => /handoff/.test(p)));
});

test('costs.md needs a competitor pricing table with a source on every row', () => {
  assert.ok(checkResearch(project({ 'costs.md': 'Hosting [F1].\n' })).some((p) => /Competitor pricing/.test(p)));
  const row = '| beta | 10 USD/month |  | https://beta.dev/pricing |\n';
  assert.ok(checkResearch(project({ 'costs.md': COSTS + row })).some((p) => /beta/.test(p) && /source/.test(p)));
});

// Seen live: a price was written as not published after reading only the GitHub README.
test('a price marked not published must name an official page checked outside the repository host', () => {
  const readmeOnly = '| beta | not published | [S1] | https://github.com/acme/tool |\n';
  assert.ok(checkResearch(project({ 'costs.md': COSTS + readmeOnly })).some((p) => /beta/.test(p) && /official/.test(p)));
  const checked = '| beta | not published | [S1] | https://github.com/acme/tool, https://beta.dev/pricing |\n';
  assert.deepEqual(checkResearch(project({ 'costs.md': COSTS + checked })), []);
});

test('recommendations.md needs gaps, differentiation, directions and a recommendation', () => {
  const problems = checkResearch(project({ 'recommendations.md': '# Recommendations\n\n## Gaps\nx [S1].\n' }));
  for (const h of ['Differentiation', 'Directions', 'Recommendation']) assert.ok(problems.some((p) => p.includes(h)), h);
});

test('the CLI prints the problems and exits 1, or ok and exits 0', () => {
  const good = project();
  assert.deepEqual(JSON.parse(execFileSync('node', [cli, '--project', good], { encoding: 'utf8' })), { ok: true, problems: [] });
  const bad = project({ 'recommendations.md': null });
  let out;
  assert.throws(() => execFileSync('node', [cli, '--project', bad], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), (e) => { out = e; return e.status === 1; });
  assert.equal(JSON.parse(out.stdout).ok, false);
});
