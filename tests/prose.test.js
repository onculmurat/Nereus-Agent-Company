import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const SKILLS = ['question-protocol', 'task-loop', 'escalation', 'mailbox', 'phase-report', 'cleanup'];
const COMMANDS = ['setup', 'status', 'questions', 'cleanup'];

for (const skill of SKILLS) {
  test(`skill ${skill} has name and description`, () => {
    const { data } = parseFrontmatter(read('skills', skill, 'SKILL.md'));
    assert.equal(data.name, skill);
    assert.ok(data.description);
  });
}

for (const cmd of COMMANDS) {
  test(`command ${cmd} has a description`, () => {
    assert.ok(parseFrontmatter(read('commands', `${cmd}.md`)).data.description);
  });
}

test('every scripts/<x>.js named in prose exists', () => {
  const files = [
    path.join('prompts', 'lead.md'),
    ...SKILLS.map((s) => path.join('skills', s, 'SKILL.md')),
    ...COMMANDS.map((c) => path.join('commands', `${c}.md`)),
    ...fs.readdirSync(path.join(pluginRoot, 'agents')).map((f) => path.join('agents', f)),
  ];
  for (const f of files) {
    for (const [, script] of read(f).matchAll(/scripts\/([a-z-]+\.js)/g)) {
      assert.ok(fs.existsSync(path.join(pluginRoot, 'scripts', script)), `${f} names missing scripts/${script}`);
    }
  }
});

test('lead prompt covers build-phase spawns and every enabled phase', () => {
  const lead = read('prompts', 'lead.md');
  assert.match(lead, /^# NAC lead instructions/);
  assert.match(lead, /never pass a name/);
  const { phases } = JSON.parse(read('defaults', 'config.json'));
  assert.deepEqual(phases.enabled, [0, 1, 3, 4, 5, 6]);
  for (const n of phases.enabled) assert.match(lead, new RegExp(`^## Phase ${n}\\b`, 'm'));
});

test('lead prompt runs phase 1 as a team of researcher and finance-analyst, and asks whether it is needed', () => {
  const lead = read('prompts', 'lead.md');
  const phase1 = lead.split('## Phase 1')[1].split('\n## ')[0];
  assert.match(phase1, /Team mode/);
  assert.match(phase1, /`researcher`/);
  assert.match(phase1, /`finance-analyst`/);
  assert.match(phase1, /team\/research\//);
  assert.match(phase1, /approval/i);
  const phase0 = lead.split('## Phase 0')[1].split('\n## ')[0];
  assert.match(phase0, /research/i);
});

test('lead prompt hands the phase 1 research to phase 3 design', () => {
  const lead = read('prompts', 'lead.md');
  const phase3 = lead.split('## Phase 3')[1].split('\n## ')[0];
  assert.match(phase3, /team\/research\//);
});

test('lead prompt shows the owner the research sources', () => {
  const lead = read('prompts', 'lead.md');
  const phase1 = lead.split('## Phase 1')[1].split('\n## ')[0];
  assert.match(phase1, /sources\.md/);
  assert.match(phase1, /guard/i);
});

test('NOTICE credits superpowers', () => {
  const notice = read('NOTICE');
  assert.match(notice, /Jesse Vincent/);
  assert.match(notice, /skills\/task-loop\/SKILL\.md/);
  assert.match(notice, /skills\/question-protocol\/SKILL\.md/);
});
