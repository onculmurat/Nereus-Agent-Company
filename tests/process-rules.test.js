// Batch 3 prose rules: they bind every role and the lead the same way (the owner principle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const agents = fs.readdirSync(path.join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md'));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

// The exact sentences every agent file carries in its working rules.
const ROLE_RULES = {
  automate: 'Automate first: try the scripted path (scripts, CLI, launching the program, capturing its output to a file) before you hand anything to the owner. Hand over only what truly needs a human (keystrokes in a GUI or terminal, visual judgement, credentials), through the lead, each as one exact minimal action.',
  paths: 'Paths in tools: give Glob and Grep an absolute `path`; on Windows use forward slashes or quote the path; search inside the project root only.',
  append: 'Add to an existing file with the Edit or Write tool, never with `echo >>` or a heredoc through Bash.',
  outside: 'Do not read files outside the project root (other projects, home directories) without an owner question first, sent through the lead.',
  commit: 'Before you put a commit hash in a report or hand-off note, read it from git (`git log -1 --format=%h`); never write it from memory.',
  batch: 'Batch edits: one Edit or Write per file change set, not many micro-edits or scripted in-place patches.',
  filtered: 'While iterating run the filtered test (`cargo test <filter>`, `npm test -- <file>`); run the full suite once before you commit. Run tests and builds in the foreground and wait for them; never leave one running in the background when you report (g31: a left-over test run loads the machine and turns the gate red).',
  reread: 'Do not re-read a file that is in the pack or that you already read in this dispatch, unless it changed.',
  hardening: "On a hardening task read only the pack's addresses and impact sites; do not scan the rest of the module. A review of it covers only the pack items and the diff.",
  rounds: "The board's `rounds` field is the only round count. Do not keep or report your own count.",
};

test('every agent carries the ten shared working rules, word for word', () => {
  assert.equal(agents.length, 14);
  for (const file of agents) {
    const text = read('agents', file);
    for (const [name, sentence] of Object.entries(ROLE_RULES)) {
      assert.ok(text.includes(`- ${sentence}`), `${file} is missing the ${name} rule as a bullet`);
    }
  }
});

test('the shared rules sit in the Working rules section of each agent', () => {
  for (const file of agents) {
    const text = read('agents', file);
    const start = text.indexOf('## Working rules');
    const end = text.indexOf('\n## ', start + 1);
    assert.ok(start >= 0, file);
    const section = text.slice(start, end < 0 ? undefined : end);
    for (const sentence of Object.values(ROLE_RULES)) assert.ok(section.includes(sentence), `${file}: ${sentence.slice(0, 30)}`);
  }
});

test('the lead prompt states the same rules in its own words and stays short', () => {
  const lead = read('prompts', 'lead.md');
  assert.match(lead, /Try the automated path first[^\n]*only steps that truly need a human[^\n]*one exact minimal action/);
  assert.match(lead, /Never read files outside the project root[^\n]*without asking the owner first/);
  assert.match(lead, /Read every commit hash from git[^\n]*git log -1 --format=%h/);
  assert.match(lead, /`to-lead` \(you decide, re-plan or escalate/);
  assert.match(lead, /never fix a role's output yourself/);
  assert.match(lead, /absolute paths in Glob and Grep/);
  assert.ok(lead.length < 7200, `lead.md is ${lead.length} characters`);
});

test('task-loop and escalation: fixes go to the owning role, to-lead means decide or escalate', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /The lead never fixes a role's output itself/);
  assert.match(loop, /`to-lead` means you decide, re-plan or escalate/);
  const esc = read('skills', 'escalation', 'SKILL.md');
  assert.match(esc, /The lead never fixes a role's output itself/);
  assert.match(esc, /`retry`: re-dispatch the same role[^\n]*the owning role fixes/);
  assert.match(esc, /`to-lead`: you decide, re-plan or escalate[^\n]*you do not write the fix/);
});

test('task-loop and question-protocol: automation first, owner steps as exact minimal actions', () => {
  for (const [skill, heading] of [['task-loop', '## Automation first'], ['question-protocol', '## Manual steps for the owner']]) {
    const text = read('skills', skill, 'SKILL.md');
    const at = text.indexOf(heading);
    assert.ok(at >= 0, `${skill} has no "${heading}" section`);
    const section = text.slice(at, text.indexOf('\n## ', at + 1) < 0 ? undefined : text.indexOf('\n## ', at + 1));
    assert.match(section, /scripts, CLI, launching the program, capturing (?:its )?output to files?/);
    assert.match(section, /keystrokes in a GUI or terminal, visual judgement, credentials/);
    assert.match(section, /exact minimal action/);
  }
});

test('the board rounds field is the only round count: skills say so and nothing tells a role to count', () => {
  assert.match(read('skills', 'escalation', 'SKILL.md'), /`rounds` field of the board entry is the only round count/);
  assert.match(read('skills', 'task-loop', 'SKILL.md'), /`rounds` field of the board entry is the only round count/);
  const files = [...walk(path.join(pluginRoot, 'agents')), ...walk(path.join(pluginRoot, 'skills')), ...walk(path.join(pluginRoot, 'templates')), ...walk(path.join(pluginRoot, 'prompts'))];
  const offenders = [];
  for (const file of files) {
    read(path.relative(pluginRoot, file)).split('\n').forEach((line, i) => {
      // a sentence that tells the reader (a role) to count, keep or number rounds
      if (/\b(?:you|each role|the role|roles)\b[^.\n]*\b(?:count|keep|track|number|record)\w*\b[^.\n]*\brounds?\b/i.test(line) && !/do not keep or report your own count/i.test(line)) offenders.push(`${path.relative(pluginRoot, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
  assert.ok(files.length > 30, 'the scan covered the agents, skills, templates and prompts');
});

test('commands/questions.md follows the batching rule', () => {
  const text = read('commands', 'questions.md');
  assert.doesNotMatch(text, /one at a time/i);
  assert.match(text, /Blocking questions are asked at once/);
  assert.match(text, /up to 4 per `AskUserQuestion` call/);
  assert.match(text, /skill `question-protocol`/);
  assert.match(text, /full shape/);
});

test('task-loop tells the lead to read commit hashes from git', () => {
  const loop = read('skills', 'task-loop', 'SKILL.md');
  assert.match(loop, /git log -1 --format=%h/);
  assert.match(loop, /reachable from HEAD/);
});

test('both READMEs describe the destructive-command guard, code: no tasks and the weighted cost ranking', () => {
  for (const file of ['README.md', 'README.tr.md']) {
    const text = read(file);
    assert.match(text, /`rm -r`, `Remove-Item -Recurse`, `rmdir \/s`, `rd \/s`, `del \/s`/, file);
    assert.match(text, /`code: no`; `gate\.js --task <id>`/, file);
    assert.match(text, /`weighted` = /, file);
    assert.match(text, /`--help`/, file);
  }
});
