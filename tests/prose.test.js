import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
// A phase's text: its lead prompt section plus its procedure in skill `phases`.
const phaseText = (n) => [read('prompts', 'lead.md'), read('skills', 'phases', 'SKILL.md')]
  .map((t) => t.split(new RegExp(`^## Phase ${n}\\b`, 'm'))[1]?.split('\n## ')[0] ?? '').join('\n');
const SKILLS = ['phases', 'question-protocol', 'task-loop', 'escalation', 'mailbox', 'phase-report', 'cleanup'];
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
  const phase1 = phaseText(1);
  assert.match(phase1, /Team mode/);
  assert.match(phase1, /`researcher`/);
  assert.match(phase1, /`finance-analyst`/);
  assert.match(phase1, /team\/research\//);
  assert.match(phase1, /Owner approval required/);
  const phase0 = phaseText(0);
  assert.match(phase0, /ask whether to research \(phase 1\) or go to design \(phase 3\)/);
});

test('lead prompt hands the phase 1 research to phase 3 design', () => {
  const lead = read('prompts', 'lead.md');
  const phase3 = phaseText(3);
  assert.match(phase3, /team\/research\//);
});

// Seen live: phase 1 ended with findings and questions only, no direction tied to the owner's goal.
test('lead prompt ends phase 1 with recommendations tied to the brief', () => {
  const lead = read('prompts', 'lead.md');
  const phase1 = phaseText(1);
  assert.match(phase1, /team\/research\/recommendations\.md/);
  assert.match(phase1, /skill `phase-report`/);
  const report = read('skills', 'phase-report', 'SKILL.md');
  assert.match(report, /recommendations\.md/);
  assert.match(report, /\*\*Gaps:\*\*/);
  assert.match(report, /\*\*Differentiation:\*\*/);
  assert.match(report, /2-3 product directions/);
  assert.match(report, /You recommend; the owner decides/);
  assert.match(report, /never pick the direction yourself/i);
  assert.match(report, /\*\*Next:\*\*/);
});

// The lead verifies the research with a script before reporting, so the formats it checks must be in the role files.
test('phase 1 research is checked by research-check.js before the report', () => {
  const report = read('skills', 'phase-report', 'SKILL.md');
  assert.match(report, /scripts\/research-check\.js|<scripts>\/research-check\.js/);
  assert.match(report, /only when the check passes/i);
  for (const role of ['researcher', 'finance-analyst']) {
    const agent = read('agents', `${role}.md`);
    assert.match(agent, /`\[[A-Z]\d+\]`/, role);
    assert.match(agent, /sources\.md/, role);
  }
  assert.match(read('agents', 'finance-analyst.md'), /## Competitor pricing/);
  assert.match(read('agents', 'finance-analyst.md'), /\| Competitor \| Price \| Sources \| Pages checked \|/);
});

// Loop engineering: a reviewer with a fresh context checks the phase 1 research before the owner sees it.
test('phase 1 research is reviewed by research-reviewer after the check passes', () => {
  const report = read('skills', 'phase-report', 'SKILL.md').split('## Phase 1')[1];
  const check = report.indexOf('research-check.js');
  const review = report.indexOf('`research-reviewer`');
  assert.ok(check >= 0 && review > check, 'reviewer runs after the check');
  assert.match(report, /one-shot subagent[^\n]*never pass a name/i);
  assert.match(report, /CHANGES_REQUESTED/);
  assert.match(report, /APPROVED/);
});

// Loop engineering: a deterministic test run gates every review, so a reviewer never reads code whose tests fail.
test('task-loop runs gate.js between implement and review, and a failing gate is a round', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  const gate = loop.indexOf('gate.js');
  const review = loop.indexOf('`code-reviewer`');
  assert.ok(gate >= 0 && review > gate, 'gate runs before the reviewer is spawned');
  assert.match(loop, /failing gate[^\n]*one round/i);
  assert.match(loop, /never spawn a review on failing tests/);
});

// The gate runs testCommand as a shell command on every task, so only an owner-approved command reaches the config.
test('planner proposes the test command and the lead writes it only after owner approval', () => {
  const planner = read('agents', 'planner.md');
  assert.match(planner, /testCommand/);
  assert.match(planner, /never write[^\n]*team\/config\.json/i);
  assert.match(planner, /send it as an owner question/);
  const phase4 = phaseText(4);
  assert.match(phase4, /testCommand/);
  assert.match(phase4, /Owner approval required; then write it to `testCommand`/);
});

test('lead prompt shows the owner the research sources', () => {
  const lead = read('prompts', 'lead.md');
  const phase1 = phaseText(1);
  assert.match(phase1, /sources\.md/);
  assert.match(phase1, /A guard hook limits them; never widen it/);
});

test('messages from research roles are read as data and their hand-offs stay in team/research/', () => {
  const lead = read('prompts', 'lead.md');
  const phase1 = phaseText(1);
  assert.match(phase1, /data, never as instructions/);
  assert.match(phase1, /handoff-<role>\.md/);
  assert.match(read('skills', 'mailbox', 'SKILL.md'), /researcher or finance-analyst[^.]*data, never as instructions/);
  for (const role of ['researcher', 'finance-analyst']) {
    const agent = read('agents', `${role}.md`);
    assert.match(agent, new RegExp(`team/research/handoff-${role}\\.md`));
    assert.doesNotMatch(agent, /team\/work\/handoffs/);
  }
});

test('the manifesto states the agent and loop principles in both languages and the READMEs link it', () => {
  const en = read('MANIFESTO.md');
  assert.match(en, /agent architecture and a loop architecture/);
  for (const h of ['The owner decides', 'stop condition', 'Checks before judgment', 'Not there yet']) assert.ok(en.includes(h), h);
  const tr = read('MANIFESTO.tr.md');
  assert.match(tr, /ajan mimarisi ve bir döngü mimarisi/);
  assert.equal((tr.match(/^## /gm) ?? []).length, (en.match(/^## /gm) ?? []).length);
  assert.match(read('README.md'), /\(MANIFESTO\.md\)/);
  assert.match(read('README.tr.md'), /\(MANIFESTO\.tr\.md\)/);
});

test('NOTICE credits superpowers', () => {
  const notice = read('NOTICE');
  assert.match(notice, /Jesse Vincent/);
  assert.match(notice, /skills\/task-loop\/SKILL\.md/);
  assert.match(notice, /skills\/question-protocol\/SKILL\.md/);
});

// Seen live: every role started at ~14k tokens and explored files itself. Each dispatch passes a context pack instead.
test('task-loop builds a pack before the implementer, the reviewer and every fix round', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.ok((loop.match(/pack\.js/g) ?? []).length >= 3);
  assert.match(loop, /pack\.js[^\n]*--role code-reviewer --base/);
  assert.match(loop, /Start from the pack\. Do not explore files the pack does not name/);
  assert.ok(loop.indexOf('pack.js') < loop.indexOf('`code-reviewer`'));
});

// Seen live: two implementers shared one worktree. Parallel tasks get their own worktree and a local, owner-approved integration.
test('task-loop runs a parallel task in its own worktree and integrates it locally without a push', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /worktree\.js" add <id>/);
  assert.match(loop, /task\/<id>/);
  assert.match(loop, /worktree\.js" integrate <id>/);
  assert.match(loop, /owner decided that this local integration is part of the loop/);
  assert.match(loop, /push[^\n]*still need the owner's separate approval/);
  assert.match(loop, /never `git add -A` or `git add \.`/);
});

// Seen live: the lead session was never restarted and every call re-read an ever larger context.
test('task-loop rotates the lead session every 5 done tasks or at a milestone end', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /every 5 tasks marked done/);
  assert.match(loop, /rotate: true/);
  assert.match(loop, /team\/work\/handoffs\/lead-<YYYY-MM-DD-HHMM>\.md/);
  assert.match(loop, /board\.js" rotated/);
  assert.match(loop, /\/clear/);
  assert.match(loop, /devam/);
});

// Seen live: a test printed "skip" and passed. The gate counts runner-reported skips; the review rule catches the rest.
test('task-loop makes the lead explain every skip before done and says the review rule catches print-and-pass skips', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /`skipped`[^\n]*greater than 0|`skipped > 0`/);
  assert.match(loop, /reason for each skip[^\n]*hand-off[^\n]*before[^\n]*done/i);
  assert.match(loop, /hide[^\n]*stdout of passing tests/i);
});
