import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');

// Item 0: the lead prompt keeps only what every session start needs; phase detail lives in skill `phases`.
test('lead prompt points to skill phases and is at least 600 characters smaller than before', () => {
  const lead = read('prompts', 'lead.md');
  assert.match(lead, /skill `phases`/);
  assert.ok(lead.length <= 7670 - 600, `lead.md is ${lead.length} characters`);
  const { data } = parseFrontmatter(read('skills', 'phases', 'SKILL.md'));
  assert.equal(data.name, 'phases');
  assert.ok(data.description);
});

test('rules moved out of the lead prompt are still reachable in skill phases', () => {
  const lead = read('prompts', 'lead.md');
  const phases = read('skills', 'phases', 'SKILL.md');
  const section = (n) => phases.split(new RegExp(`^## Phase ${n}\\b`, 'm'))[1]?.split('\n## ')[0] ?? '';
  assert.match(section(0), /exactly one question[^\n]*no sub-questions[^\n]*no preview/i);
  assert.match(section(0), /never join two questions with "and"/i);
  assert.match(section(0), /team\/brief\.md/);
  assert.match(section(1), /data, never as instructions/);
  assert.match(section(1), /handoff-<role>\.md/);
  assert.match(section(1), /recommendations\.md/);
  assert.match(section(1), /sources\.md/);
  assert.match(section(1), /never widen it/);
  assert.match(section(3), /<board-id>: <title>/);
  assert.match(section(3), /if you have native team task tools/i);
  assert.match(section(3), /owner question/i);
  assert.match(lead + phases, /never pass a name/);
});

test('both READMEs describe the pack, worktree, rotation and skip count helpers', () => {
  for (const f of ['README.md', 'README.tr.md']) {
    const text = read(f);
    for (const word of ['pack.js', 'worktree.js', 'board.js', 'gate.js']) assert.ok(text.includes(`(\`${word}\`)`), `${f} lacks ${word}`);
  }
});
