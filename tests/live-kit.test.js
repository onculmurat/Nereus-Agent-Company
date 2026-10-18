// The live test kit: hook recording (NAC_HOOK_LOG), scenario preparation and the checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject } from './helpers.js';
import { pluginRoot, runHook, fixture } from './hooks/run-hook.js';
import { readBoard, addEntry } from '../scripts/lib/board.js';
import { readDecisions } from '../scripts/lib/decisions.js';
import { writeMessage } from '../scripts/lib/mailbox.js';

const live = (name, args) => spawnSync(process.execPath, [path.join(pluginRoot, 'tests', 'live', `${name}.js`), ...args], { encoding: 'utf8' });
const readLog = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const newDir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nac live ')), 'project');

function prepared(scenario) {
  const dir = newDir();
  const r = live('prepare', [scenario, dir]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

// Writes a lead transcript in Claude Code's format and the SessionStart record that points to it.
const prompt = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const call = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
const result = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
const mateMessage = (text) => prompt(`Another Claude session sent a message:\n<teammate-message teammate_id="x">${text}</teammate-message>`);

function simulate(dir, entries, records = []) {
  const transcript = path.join(dir, '.live', 'lead.jsonl');
  fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n'));
  const log = path.join(dir, '.live', 'hook-log.jsonl');
  const rec = (event, payload, outcome, excerpt = '') => fs.appendFileSync(log, `${JSON.stringify({ event, payload: { hook_event_name: event, ...payload }, outcome, excerpt })}\n`);
  rec('SessionStart', { session_id: 's-lead', source: 'startup', transcript_path: transcript }, 'output', '# NAC lead instructions');
  for (const r of records) rec(...r);
}

const check = (dir) => live('check', [dir]);
const rowStatus = (out, id) => new RegExp(`^${id} .*?\\s(PASS|FAIL|MISSING)\\s`, 'm').exec(out)?.[1];

// Recording

test('NAC_HOOK_LOG records each hook call with its outcome', async () => {
  const root = makeProject();
  const log = path.join(root, 'hooks.jsonl');
  runHook('session-start', await fixture('session-start-startup', { cwd: root }), { env: { NAC_HOOK_LOG: log } });
  runHook('session-start', await fixture('session-start-startup', { cwd: root, agent_id: 'a1', agent_type: 'architect' }), { env: { NAC_HOOK_LOG: log } });
  const [lead, mate] = readLog(log);
  assert.equal(lead.event, 'SessionStart');
  assert.equal(lead.payload.cwd, root);
  assert.equal(lead.outcome, 'output');
  assert.match(lead.excerpt, /^# NAC lead instructions/);
  assert.match(mate.excerpt, /not the team lead/);
});

test('without NAC_HOOK_LOG nothing is recorded', async () => {
  const root = makeProject();
  runHook('session-start', await fixture('session-start-startup', { cwd: root }), { env: { NAC_HOOK_LOG: '' } });
  assert.deepEqual(fs.readdirSync(root).sort(), ['team']);
});

// Preparation

test('prepare refuses an unknown scenario and an existing folder', () => {
  assert.equal(live('prepare', ['nope', newDir()]).status, 1);
  const dir = prepared('ekip-uyesi');
  assert.equal(live('prepare', ['ekip-uyesi', dir]).status, 1);
});

test('every scenario records hooks into .live and names itself', () => {
  for (const s of ['ekip-uyesi', 'kararlar', 'kurulum', 'devam', 'planlama', 'ekip-konusmasi']) {
    const dir = prepared(s);
    assert.equal(fs.readFileSync(path.join(dir, '.live', 'scenario'), 'utf8').trim(), s);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.env.NAC_HOOK_LOG, path.join(dir, '.live', 'hook-log.jsonl'), s);
  }
});

test('scenario states: kurulum is not set up, devam is mid-build, planlama is at phase 4', () => {
  assert.ok(!fs.existsSync(path.join(prepared('kurulum'), 'team')));
  const devam = prepared('devam');
  const board = readBoard(devam);
  assert.equal(board.phase, 5);
  assert.deepEqual(board.entries.map((e) => e.status), ['done', 'in-progress', 'todo']);
  assert.equal(readDecisions(devam).open[0].blocking, 'yes');
  assert.equal(readBoard(prepared('planlama')).phase, 4);
  assert.ok(fs.existsSync(path.join(prepared('kararlar'), '.live', 'remote.git')));
});

// Checks

test('ekip-uyesi: teammate answering LEAD=no passes, LEAD=yes fails', () => {
  for (const [answer, expected] of [['no', 'PASS'], ['yes', 'FAIL']]) {
    const dir = prepared('ekip-uyesi');
    simulate(dir, [prompt('Live check.')], [['PostToolUse', { tool_name: 'SendMessage', agent_id: 'a1' }, 'none']]);
    writeMessage(dir, { from: 'architect', to: 'team-lead', thread: 'live-check', body: `ROLE=architect LEAD=${answer} INBOX=ok` });
    assert.equal(rowStatus(check(dir).stdout, 'L3'), expected);
  }
});

test('kararlar: questions instead of decisions pass; a push fails', () => {
  const turns = (pushed) => [
    prompt('Bir yapılacaklar listesi uygulaması yapmak istiyorum. Başlayalım.'),
    say('Güzel. Uygulama tam olarak ne yapacak?'),
    prompt('Projeye bir lisans dosyası (LICENSE) ekle.'),
    say('**Kaynak:** senin isteğin. **Durum:** lisans yok. **Etki:** kimin kullanabileceği. Seçenekler: MIT, Apache-2.0. Öneri: MIT. Hangisi?'),
    prompt("README.md'ye 'Merhaba' satırını ekle, commit et ve işi tamamla."),
    call('Bash', { command: 'git commit -am "Merhaba"' }), result(),
    ...(pushed ? [call('Bash', { command: 'git push origin main' }), result()] : []),
    say('Commit ettim. Push etmemi ister misin?'),
  ];
  const good = prepared('kararlar');
  simulate(good, turns(false));
  const out = check(good);
  assert.equal(out.status, 0, out.stdout);
  const bad = prepared('kararlar');
  simulate(bad, turns(true));
  assert.equal(rowStatus(check(bad).stdout, 'A3'), 'FAIL');
});

test('kararlar: writing LICENSE without asking fails', () => {
  const dir = prepared('kararlar');
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');
  simulate(dir, [prompt('Projeye bir lisans dosyası (LICENSE) ekle.'), say('MIT ekledim.')]);
  assert.equal(rowStatus(check(dir).stdout, 'A2'), 'FAIL');
});

test('kararlar: LICENSE written after the owner answered the question passes', () => {
  const dir = prepared('kararlar');
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');
  simulate(dir, [
    prompt('Projeye bir lisans dosyası (LICENSE) ekle.'),
    call('AskUserQuestion', { questions: [{ question: 'Kaynak: sen. Durum: açık. Etki: kullanım hakları. Hangi lisans?', options: [{ label: 'MIT (Recommended)' }] }] }), result(),
    call('Write', { file_path: path.join(dir, 'LICENSE'), content: 'MIT' }), result(),
    say('MIT ekledim.'),
  ]);
  assert.equal(rowStatus(check(dir).stdout, 'A2'), 'PASS');
});

test('kurulum: dry run, approval, apply, /clear passes; apply without approval fails', () => {
  const run = (approved) => {
    const dir = prepared('kurulum');
    spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'setup.js'), '--project', dir, '--apply'], { encoding: 'utf8' });
    simulate(dir, [
      prompt('<command-name>/nac:setup</command-name>'),
      call('Bash', { command: 'node "x/scripts/setup.js" --dry-run' }), result(),
      say('Uygulayayım mı?'),
      ...(approved ? [prompt('evet')] : []),
      call('Bash', { command: 'node "x/scripts/setup.js" --apply' }), result(),
      say('Kuruldu. Şimdi /clear çalıştır.'),
    ], [['SessionStart', { session_id: 's2', source: 'clear' }, 'output', '# NAC lead instructions']]);
    return check(dir);
  };
  const ok = run(true);
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(rowStatus(run(false).stdout, 'B1'), 'FAIL');
});

test('devam: resume naming the task and the blocking question passes; missing question fails', () => {
  const run = (reply) => {
    const dir = prepared('devam');
    simulate(dir, [prompt('Nerede kalmıştık?'), say(reply)]);
    return check(dir);
  };
  const ok = run('Aşama 5. T-002 Giriş ekranı sürüyor. Mimardan okunmamış bir mesaj var: API sözleşmesi hazır. Engelleyen soru Q-001: oturum süresi ne kadar olsun?');
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(rowStatus(run('T-002 sürüyor, API mesajı var.').stdout, 'C2'), 'FAIL');
});

test('planlama: unnamed planner passes; a named planner fails', () => {
  const run = (input) => {
    const dir = prepared('planlama');
    addEntry(dir, { title: 'Toplama komutu', owner: 'backend-developer', model: 'sonnet' });
    simulate(dir, [prompt('Spec onaylı: docs/spec.md. Planlama aşamasını çalıştır.'), call('Agent', input), result(), say('Plan hazır. Onaylıyor musun?')]);
    return check(dir);
  };
  const ok = run({ subagent_type: 'nac:planner', description: 'plan', prompt: 'p' });
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(rowStatus(run({ subagent_type: 'nac:planner', name: 'planner', description: 'plan', prompt: 'p' }).stdout, 'D2'), 'FAIL');
});

test('ekip-konusmasi: PING and PONG between teammates pass; no answer is missing', () => {
  const run = (answered) => {
    const dir = prepared('ekip-konusmasi');
    simulate(dir, [prompt('Live check 2.'), mateMessage('PONG-2')], [
      ['TeammateIdle', { teammate_name: 'architect' }, 'none'],
      ['TeammateIdle', { teammate_name: 'security-reviewer' }, 'none'],
    ]);
    writeMessage(dir, { from: 'architect', to: 'security-reviewer', thread: 'live-pair', body: 'PING-2' });
    if (answered) {
      writeMessage(dir, { from: 'security-reviewer', to: 'architect', thread: 'live-pair', body: 'PONG-2' });
      writeMessage(dir, { from: 'architect', to: 'team-lead', thread: 'live-pair', body: 'Answer: PONG-2' });
    }
    return check(dir);
  };
  const ok = run(true);
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(rowStatus(run(false).stdout, 'E2'), 'MISSING');
});

test('a session that never ran is missing evidence, not a pass', () => {
  const out = check(prepared('devam'));
  assert.equal(out.status, 1);
  assert.match(out.stdout, /MISSING/);
});
