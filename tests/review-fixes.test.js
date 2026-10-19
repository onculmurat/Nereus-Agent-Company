// Regression tests for the final-review findings (O-I* Important, O-M* Minor) on nac-v1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeProject } from './helpers.js';
import { pluginRoot, runHook, fixture } from './hooks/run-hook.js';
import { addQuestion, decide, readDecisions } from '../scripts/lib/decisions.js';
import { addEntry, readBoard, incrementRound } from '../scripts/lib/board.js';
import { buildResumeSummary } from '../scripts/lib/summary.js';
import { writeMessage, listInbox, closeThread } from '../scripts/lib/mailbox.js';
import { parseFrontmatter } from '../scripts/lib/frontmatter.js';
import { loadConfig, validateConfig } from '../scripts/lib/config.js';
import { planSetup, planGlobalModelPointer } from '../scripts/lib/setup.js';
import { teamPaths } from '../scripts/lib/paths.js';

const config = loadConfig({ pluginRoot, userConfigPath: null, projectRoot: null });
const cli = (name, args, opts = {}) => execFileSync(process.execPath, [path.join(pluginRoot, 'scripts', `${name}.js`), ...args], { encoding: 'utf8', ...opts });
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const q = (root, thread = 't') => addQuestion(root, { title: 'Which DB?', source: 's', status: 'd', impact: 'i', blocking: 'no', thread });

// O-I1
test('O-I1 a multi-line answer and title survive later writes', () => {
  const root = makeProject();
  const first = q(root);
  decide(root, first.id, { answer: 'PostgreSQL.\nReason: JSONB and row-level security.' });
  addQuestion(root, { title: 'Two\n## lines', source: 's', status: 'd', impact: 'i', blocking: 'no', thread: 'u' });
  const d = readDecisions(root);
  assert.equal(d.decided[0].answer, 'PostgreSQL.\nReason: JSONB and row-level security.');
  assert.equal(d.open[0].title, 'Two\n## lines');
  assert.equal(d.open.length, 1);
});

// O-I2
test('O-I2 setup tells the owner to /clear before phase 0', () => {
  assert.match(read('commands', 'setup.md'), /\/clear/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac fix '));
  assert.match(cli('setup', ['--project', dir, '--apply']), /\/clear/);
  for (const f of ['README.md', 'README.tr.md']) assert.match(read(f), /\/clear/);
});

// O-I3
test('O-I3 a teammate session gets a teammate reminder, not the lead prompt', async () => {
  const root = makeProject();
  const r = runHook('session-start', await fixture('session-start-startup', { cwd: root, agent_id: 'a1', agent_type: 'architect' }));
  assert.equal(r.status, 0);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /# NAC lead instructions/);
  assert.match(ctx, /not the team lead/);
});

test('O-I3 lead prompt tells a teammate to ignore it', () => {
  assert.match(read('prompts', 'lead.md'), /If you were spawned as a teammate/);
});

// O-I4
test('O-I4 resume summary is bounded and git status has a timeout', () => {
  const root = makeProject();
  for (let i = 0; i < 60; i++) addEntry(root, { title: `Task ${i}`, owner: 'backend-developer', model: 'sonnet' });
  const git = Array.from({ length: 40 }, (_, i) => ` M src/file-${i}.js`).join('\n');
  const s = buildResumeSummary(root, { gitStatus: git });
  assert.match(s, /and 40 more/);
  assert.match(s, /and 20 more/);
  assert.ok(s.length < 3000, `summary is ${s.length} characters`);
  assert.match(read('scripts', 'lib', 'summary.js'), /timeout:/);
});

test('O-I4 session-start context stays under 10,000 characters on a busy project', async () => {
  const root = makeProject();
  for (let i = 0; i < 80; i++) addEntry(root, { title: `A fairly long task title number ${i}`, owner: 'backend-developer', model: 'sonnet' });
  const r = runHook('session-start', await fixture('session-start-startup', { cwd: root }));
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.length < 10000, `context is ${ctx.length} characters`);
  assert.doesNotMatch(ctx, /marketing-strategist/);
});

// O-I5
test('O-I5 a thread outcome can be recorded without a question, so cleanup can archive it', () => {
  const root = makeProject();
  writeMessage(root, { from: 'architect', to: 'planner', thread: 'api-split', body: 'done', date: '2026-01-01T00:00:00Z' });
  const rec = JSON.parse(cli('decisions', ['record', '--thread', 'api-split', '--outcome', 'Split into two services', '--project', root]));
  assert.match(rec.id, /^D-\d{3}$/);
  closeThread(root, 'api-split');
  assert.match(cli('cleanup', ['--dry-run', '--project', root]), /archive\s+api-split/);
  assert.doesNotMatch(read('skills', 'mailbox', 'SKILL.md'), /--link` or the question/);
  assert.match(read('skills', 'mailbox', 'SKILL.md'), /decisions\.js" record/);
});

// O-I6
test('O-I6 TaskCompleted block sends the teammate to the lead, not to the board', async () => {
  const root = makeProject();
  addEntry(root, { title: 'Build the API', owner: 'backend-developer', model: 'sonnet' });
  const r = runHook('task-completed', await fixture('task-completed.synthetic', { cwd: root }));
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /board\.js/);
  assert.match(r.stderr, /only the lead/i);
  assert.match(read('prompts', 'lead.md'), /<board-id>: <title>/);
});

// Live test A1: the lead asked one "question" with three sub-questions and a preview of the next ones.
test('A1 one question per message is spelled out in phase 0 and the question protocol', () => {
  const rule = /exactly one question[^\n]*no sub-questions[^\n]*no preview/i;
  const phase0 = read('prompts', 'lead.md').split('## Phase 0')[1].split('\n## ')[0];
  assert.match(phase0, rule);
  assert.match(read('skills', 'question-protocol', 'SKILL.md'), rule);
});

// Live test: in all three runs the lead first called record with --title and no --thread.
test('record accepts --title and derives the thread from it when --thread is missing', () => {
  const root = makeProject();
  const rec = JSON.parse(cli('decisions', ['record', '--title=Proje lisansı', '--outcome=MIT, telif: murat', '--project', root]));
  assert.equal(rec.title, 'Proje lisansı');
  assert.equal(rec.answer, 'MIT, telif: murat');
  assert.equal(rec.thread, 'proje-lisansi');
  const withThread = JSON.parse(cli('decisions', ['record', '--title=Push', '--thread=license', '--outcome=No push', '--project', root]));
  assert.equal(withThread.thread, 'license');
  assert.equal(JSON.parse(cli('decisions', ['record', '--outcome=Şöyle', '--project', root])).thread, 'soyle');
  assert.equal(readDecisions(root).decided.length, 3);
});

// Live test A1, second run: "Who will use it and what sets it apart?" is still two questions.
test('A1 a question asks about one thing and phase 0 topics are single', () => {
  const rule = /never join two questions with "and"/i;
  const phase0 = read('prompts', 'lead.md').split('## Phase 0')[1].split('\n## ')[0];
  assert.match(phase0, rule);
  assert.match(read('skills', 'question-protocol', 'SKILL.md'), rule);
  assert.doesNotMatch(phase0, /who has the problem and why now/);
});

// Seen live (Memory Agent, phase 3): questions sat at the end of long status messages, and a re-ask said only "waiting for your answer to Q-010".
test('a question gets its own message and is always asked in full, never by id', () => {
  const protocol = read('skills', 'question-protocol', 'SKILL.md');
  assert.match(protocol, /no status report/i);
  assert.match(protocol, /in full[^\n]*never[^\n]*by its id/i);
  assert.match(protocol, /one after another/i);
  assert.match(read('commands', 'questions.md'), /in full/i);
});

// Live test C3: after a restart the lead asked Q-001 at once and never told the owner about an unread message.
test('C3 after a restart the lead reports the state, unread messages included, before asking', () => {
  const restart = read('prompts', 'lead.md').split('## After a restart')[1].split('\n## ')[0];
  assert.match(restart, /before anything else[^\n]*short status summary/i);
  assert.match(restart, /every unread message[^\n]*who sent it and what it says/i);
  assert.match(restart, /blocking questions only after/i);
});

// Live test L6: no session offered native task tools, so TaskCompleted never fired.
test('L6 task titles are asked for only when task tools exist, and the limit is documented', () => {
  const lead = read('prompts', 'lead.md');
  for (const line of lead.split('\n').filter((l) => l.includes('<board-id>: <title>'))) {
    assert.match(line, /if you have native team task tools/i, line.slice(0, 80));
  }
  assert.match(read('README.md'), /TaskCompleted[^\n]*task tools/);
  assert.match(read('README.tr.md'), /TaskCompleted[^\n]*görev araçları/);
});

// O-M1
test('O-M1 front matter with a UTF-8 BOM parses', () => {
  assert.equal(parseFrontmatter('\uFEFF---\nid: x\n---\nbody').data.id, 'x');
});

// O-M2
test('O-M2 an invalid from in the header is recorded as unknown, not dropped', async () => {
  const root = makeProject();
  const p = await fixture('post-send-message-teammate', { cwd: root });
  p.tool_input = { ...p.tool_input, to: 'team-lead', message: '[thread:t1 from:team.lead] hello' };
  const r = runHook('post-send-message', p);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const files = fs.readdirSync(path.join(teamPaths(root).mailbox, 't1'));
  assert.equal(files.length, 1);
  assert.match(files[0], /-unknown-to-team-lead/);
});

// O-M3
test('O-M3 broadcasts reach every inbox', () => {
  const root = makeProject();
  writeMessage(root, { from: 'team-lead', to: 'all', thread: 't', body: 'standup' });
  assert.equal(listInbox(root, 'architect').length, 1);
});

// O-M4
test('O-M4 the documented --body=<text> form accepts text starting with a dash', () => {
  const root = makeProject();
  cli('mailbox', ['send', '--from', 'team-lead', '--to', 'planner', '--thread', 't', '--body=- item one', '--project', root]);
  assert.equal(listInbox(root, 'planner')[0].body.trim(), '- item one');
  assert.match(read('skills', 'mailbox', 'SKILL.md'), /--body=/);
});

// O-M5
test('O-M5 two helper sends of the same text are two messages', () => {
  const root = makeProject();
  writeMessage(root, { from: 'team-lead', to: 'planner', thread: 't', body: 'Proceed.', date: '2026-10-18T10:00:00Z' });
  const second = writeMessage(root, { from: 'team-lead', to: 'planner', thread: 't', body: 'Proceed.', date: '2026-10-18T10:00:20Z' });
  assert.equal(second.created, true);
});

test('O-M5 a helper send without --thread uses the header thread', () => {
  const root = makeProject();
  const { path: p } = writeMessage(root, { from: 'architect', to: 'planner', body: '[thread:api-split from:architect] hi' });
  assert.equal(path.basename(path.dirname(p)), 'api-split');
});

// O-M6
test('O-M6 a long multi-byte message arrives intact through stdin', async () => {
  const root = makeProject();
  const body = 'ş'.repeat(70000);
  const p = await fixture('post-send-message-teammate', { cwd: root });
  p.tool_input = { ...p.tool_input, to: 'team-lead', message: `[thread:t1 from:architect] ${body}` };
  runHook('post-send-message', p);
  const msgs = listInbox(root, 'team-lead', { state: 'read' });
  assert.equal(msgs[0].body.trim(), body);
});

// O-M7, O-M8
test('O-M7/M8 README wording and local install', () => {
  const en = read('README.md');
  assert.doesNotMatch(en, /Setup shows a dry run and asks before applying/);
  assert.doesNotMatch(en, /cannot edit (files|code)/);
  assert.match(en, /claude plugin marketplace add "D:\\Projects\\Agent Team"|marketplace add "<path to/);
});

// O-M9
test('O-M9 an existing numeric 1 for agent teams is not a conflict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac fix '));
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: 1 } }));
  assert.deepEqual(planSetup(dir, { pluginRoot, config }).settings.conflicts, []);
});

// O-M10
test('O-M10 global pointer does not store the versioned plugin path', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac fix ')), 'CLAUDE.md');
  const { after } = planGlobalModelPointer(file, { pluginRoot });
  assert.ok(!after.includes(pluginRoot));
  assert.match(after, /defaults\/config\.json/);
});

// O-M11
test('O-M11 lead prompt has the team-mode fallback', () => {
  assert.match(read('prompts', 'lead.md'), /fall back to subagents/);
});

// O-M12
test('O-M12 cleanup settings are validated', () => {
  assert.throws(() => validateConfig({ ...config, cleanup: { mode: 'remove', closedThreadMaxAgeDays: 30 } }), /cleanup\.mode/);
  assert.throws(() => validateConfig({ ...config, cleanup: { mode: 'archive', closedThreadMaxAgeDays: -1 } }), /closedThreadMaxAgeDays/);
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ cleanup: { mode: 'remove' } }));
  assert.throws(() => cli('cleanup', ['--dry-run', '--project', root], { stdio: 'pipe' }), /cleanup\.mode/);
});

// O-M13
test('O-M13 setup in a subfolder of a NAC project sets up the subfolder and names it', () => {
  const parent = makeProject();
  const sub = path.join(parent, 'apps', 'web');
  fs.mkdirSync(sub, { recursive: true });
  const out = cli('setup', ['--dry-run'], { cwd: sub });
  assert.match(out.split('\n')[0], new RegExp(`^Project: ${sub.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`));
});

// O-M14
test('O-M14 a live message is stored as read, so idle is not blocked by a copy', async () => {
  const root = makeProject();
  const p = await fixture('post-send-message-teammate', { cwd: root });
  p.tool_input = { ...p.tool_input, to: 'planner', message: '[thread:t1 from:architect] hi' };
  runHook('post-send-message', p);
  assert.equal(listInbox(root, 'planner').length, 0);
  const idle = runHook('teammate-idle', await fixture('teammate-idle.synthetic', { cwd: root, teammate_name: 'planner' }));
  assert.equal(idle.status, 0);
});

// O-M16
test('O-M16 at the top model tier the ladder retries instead of a no-op raise', () => {
  const root = makeProject();
  const e = addEntry(root, { title: 'x', owner: 'architect', model: 'opus' });
  incrementRound(root, e.id, config);
  const { next } = incrementRound(root, e.id, config);
  assert.equal(next.action, 'retry');
  assert.ok(!fs.existsSync(path.join(teamPaths(root).escalations, `${e.id}-r2.md`)));
  assert.equal(readBoard(root).entries[0].model, 'opus');
});
