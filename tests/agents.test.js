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
  'researcher', 'finance-analyst',
  'architect', 'planner', 'backend-developer', 'frontend-developer', 'database-engineer', 'test-engineer',
  'code-reviewer', 'final-reviewer', 'security-reviewer', 'doc-writer', 'assistant',
];
const REVIEWERS = ['code-reviewer', 'final-reviewer', 'security-reviewer'];
const READ_ONLY = [...REVIEWERS, 'assistant'];
const RESEARCH = ['researcher', 'finance-analyst'];
const HEADINGS = ['## Responsibility', '## Before you start', '## Working rules', '## Questions for the owner', '## When you finish', '## Stuck'];

test('exactly the thirteen v1.1 agents exist', () => {
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(files, [...ROLES].sort());
});

for (const role of RESEARCH) {
  test(`${role} can search the web and writes sourced output to team/research/`, () => {
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, `${role}.md`), 'utf8'));
    const tools = String(data.tools).split(',').map((t) => t.trim());
    assert.ok(tools.includes('WebSearch') && tools.includes('WebFetch'), `${role} lacks web tools`);
    assert.match(body, /team\/research\//);
    assert.match(body, /source/i);
  });
}

test('researcher covers licenses and reads competitor code without copying it', () => {
  const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, 'researcher.md'), 'utf8'));
  assert.match(body, /licen[cs]e/i);
  assert.match(body, /never copy/i);
});

test('finance-analyst states its assumptions and free-tier limits', () => {
  const { body } = parseFrontmatter(fs.readFileSync(path.join(agentsDir, 'finance-analyst.md'), 'utf8'));
  assert.match(body, /assumption/i);
  assert.match(body, /free tier/i);
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
