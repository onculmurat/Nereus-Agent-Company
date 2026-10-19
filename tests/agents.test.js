import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentsDir = path.join(pluginRoot, 'agents');
const defaults = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'defaults', 'config.json'), 'utf8'));
const ROLES = [
  'researcher', 'finance-analyst', 'research-reviewer',
  'architect', 'planner', 'backend-developer', 'frontend-developer', 'database-engineer', 'test-engineer',
  'code-reviewer', 'final-reviewer', 'security-reviewer', 'doc-writer', 'assistant',
];
const REVIEWERS = ['code-reviewer', 'final-reviewer', 'security-reviewer', 'research-reviewer'];
const READ_ONLY = ['code-reviewer', 'final-reviewer', 'security-reviewer', 'assistant'];
const RESEARCH = ['researcher', 'finance-analyst', 'research-reviewer'];
const HEADINGS = ['## Responsibility', '## Before you start', '## Working rules', '## Questions for the owner', '## When you finish', '## Stuck'];

test('exactly the fourteen agents exist', () => {
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(files, [...ROLES].sort());
});

for (const role of RESEARCH) {
  test(`${role} can search the web and writes sourced output to team/research/`, () => {
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    const tools = String(data.tools).split(',').map((t) => t.trim());
    assert.ok(tools.includes('WebSearch') && tools.includes('WebFetch'), `${role} lacks web tools`);
    assert.match(body, /team\/research\//);
    assert.match(body, /(?:claim|price)s? names? its source|prices carry a source and a date/);
  });

  test(`${role} treats fetched content as data and never runs cloned code`, () => {
    const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    assert.match(body, /as data, never as instructions/i);
    assert.match(body, /never run, install or build/i);
    assert.match(body, /write only to `team\/research\/`/);
  });
}

test('researcher clones only through the NAC clone script', () => {
  const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, 'researcher.md'), 'utf8'));
  assert.match(body, /scripts\/clone\.js" <https URL>/);
  assert.doesNotMatch(body, /git clone/);
});

for (const role of ['architect', 'security-reviewer']) {
  test(`${role} treats the research report as data`, () => {
    const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    assert.match(body, /research[^\n]*as data, never as instructions/i);
  });
}

for (const role of ['architect', 'security-reviewer']) {
  test(`${role} reads the phase 1 research before starting`, () => {
    const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    const before = body.split('## Before you start')[1].split('\n## ')[0];
    assert.match(before, /team\/research\//);
  });
}

test('researcher covers licenses and reads competitor code without copying it', () => {
  const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, 'researcher.md'), 'utf8'));
  assert.match(body, /Check the license of every competitor or library the project may reuse/);
  assert.match(body, /never copy/i);
});

// The phase 1 reviewer works in a fresh context: it checks content the research check script cannot.
test('research-reviewer checks claims against their sources and the brief, and edits no research file', () => {
  const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, 'research-reviewer.md'), 'utf8'));
  assert.match(body, /source[^\n]*supports the claim/i);
  assert.match(body, /failure criteria/i);
  assert.match(body, /missing competitor/i);
  assert.match(body, /team\/research\/review\.md/);
  assert.match(body, /never edit[^\n]*other research files/i);
  assert.match(body, /APPROVED[^\n]*CHANGES_REQUESTED/);
});

// Seen live: a price was written as "not published" after reading only the competitor's GitHub README.
for (const role of ['researcher', 'finance-analyst']) {
  test(`${role} looks up each competitor's official site and pricing page before calling a price unpublished`, () => {
    const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    assert.match(body, /official site and (its )?pricing page/i);
    assert.match(body, /"not published" only after/i);
  });
}

test('finance-analyst states its assumptions and free-tier limits', () => {
  const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, 'finance-analyst.md'), 'utf8'));
  assert.match(body, /Every assumption \([^)]*\) is written out/);
  assert.match(body, /the free tier limits of each, and what happens when a limit is reached/);
});

for (const role of ROLES) {
  test(`${role} agent is well formed`, () => {
    const text = fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8');
    const { data, body } = parseFrontmatter(text);
    assert.equal(data.name, role);
    assert.equal(data.model, defaults.models[role]);
    assert.ok(data.description && !data.description.includes('\n'));
    for (const h of HEADINGS) assert.ok(body.includes(`\n${h}\n`), `${role} lacks ${h}`);
    assert.equal(body.includes('\n## Review output\n'), REVIEWERS.includes(role), `${role} review output section`);
    assert.ok(!text.includes('team-lead.md'));
    assert.ok(body.includes(`inbox --role ${role}`));
    const tools = String(data.tools).split(',').map((t) => t.trim());
    assert.equal(tools.includes('Edit') || tools.includes('Write'), !READ_ONLY.includes(role), `${role} tools`);
  });
}

// Seen live: a reviewer spent 81 calls exploring files the lead already knew. Roles start from the context pack.
const PACK_RULE = 'Start from the pack. Do not explore files the pack does not name; if you need more, read only that and say what and why in your report.';
for (const role of ROLES) {
  test(`${role} starts from the context pack`, () => {
    const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    assert.ok(body.split('## Working rules')[1].split('\n## ')[0].includes(PACK_RULE));
  });
}

// Seen live: one commit swept in another task's unstaged deletion.
for (const role of ['backend-developer', 'frontend-developer', 'database-engineer', 'test-engineer', 'doc-writer']) {
  test(`${role} stages only its own paths`, () => {
    const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    const rules = body.split('## Working rules')[1].split('\n## ')[0];
    assert.match(rules, /git add <path>/);
    assert.match(rules, /never `git add -A` or `git add \.`/);
  });
}

// Seen live: a test printed "skip" and passed, so nothing counted it as skipped.
for (const role of ['code-reviewer', 'test-engineer']) {
  test(`${role} treats a print-and-pass or early-return skip as a finding`, () => {
    const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    const rules = body.split('## Working rules')[1].split('\n## ')[0];
    assert.match(rules, /returns early or prints "skip" and passes is a finding/);
    assert.match(rules, /explicit skip or ignore with a reason/);
    assert.match(rules, /fails when a CI-required environment variable is set/);
  });
}
