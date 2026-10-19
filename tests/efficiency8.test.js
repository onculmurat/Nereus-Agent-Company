// Batch 8: question shape, NAC-less session detection, guard blind spots, guard variable resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');
const cli = (script, root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', script), ...args, '--project', root], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const base = ['--title', 'Which', '--source', 's', '--status', 'st', '--impact', 'i', '--blocking', 'no', '--thread', 'which'];
const ask = (root, ...extra) => cli('decisions.js', root, 'ask', ...base, ...extra);

// Item 1: options and a recommendation are required.
test('ask refuses a question without options', () => {
  const r = ask(makeProject(), '--recommend', 'a');
  assert.notEqual(r.status, 0);
  assert.match(r.err, /--options/);
});

test('ask refuses fewer than 2 options', () => {
  const r = ask(makeProject(), '--options', 'a', '--recommend', 'a');
  assert.notEqual(r.status, 0);
  assert.match(r.err, /at least 2/);
});

test('ask refuses a missing or unknown recommendation, deferred or not', () => {
  const root = makeProject();
  assert.match(ask(root, '--options', 'a|b').err, /--recommend/);
  assert.match(ask(root, '--options', 'a|b', '--recommend', 'c', '--defer', '--task', 'T-001').err, /one of the options/);
  assert.equal(ask(root, '--options', 'a|b', '--recommend', 'b').status, 0);
});

test('question-protocol says every question goes through decisions.js ask with options and a recommendation', () => {
  assert.match(read('skills', 'question-protocol', 'SKILL.md'), /every owner question goes through `decisions\.js ask`/i);
});

// Item 2: NAC-less session detection.
const START = '<!-- nac:guard:start -->';
const END = '<!-- nac:guard:end -->';
const setupCli = (...args) => spawnSync(process.execPath, [path.join(pluginRoot, 'scripts', 'setup.js'), ...args], { encoding: 'utf8' });

test('setup --apply writes the guard block into a new CLAUDE.md, and a second run changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac guard '));
  assert.equal(setupCli('--apply', '--project', dir).status, 0);
  const text = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.equal(text.split(START).length, 2);
  assert.match(text, /NAC-LEAD-ACTIVE/);
  assert.match(text, /claude plugin marketplace add "/);
  assert.match(text, /claude plugin install nac@nereus-agent-company/);
  setupCli('--apply', '--project', dir);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), text);
});

test('setup keeps other CLAUDE.md content and replaces only the block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac guard '));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# Mine\n\nkeep this\n\n${START}\nold\n${END}\n\ntail\n`);
  setupCli('--apply', '--project', dir);
  const text = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(text, /^# Mine\n\nkeep this\n\n/);
  assert.match(text, /\n\ntail\n$/);
  assert.doesNotMatch(text, /\nold\n/);
  assert.match(text, /NAC-LEAD-ACTIVE/);
});

test('setup --dry-run lists CLAUDE.md and writes nothing; --guard-block writes only the block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nac guard '));
  assert.match(setupCli('--dry-run', '--project', dir).stdout, /CLAUDE\.md/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(setupCli('--guard-block', '--project', dir).status, 0);
  assert.deepEqual(fs.readdirSync(dir), ['CLAUDE.md']);
});

test('session-start context carries NAC-LEAD-ACTIVE, and the setup hint only while the block is missing', async () => {
  const { runHook, fixture } = await import('./hooks/run-hook.js');
  const root = makeProject();
  const ctxOf = async () => JSON.parse(runHook('session-start', await fixture('session-start-startup', { cwd: root })).stdout).hookSpecificOutput.additionalContext;
  const missing = await ctxOf();
  assert.match(missing, /NAC-LEAD-ACTIVE/);
  assert.match(missing, /--guard-block/);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `${START}\nx\n${END}\n`);
  const present = await ctxOf();
  assert.match(present, /NAC-LEAD-ACTIVE/);
  assert.doesNotMatch(present, /--guard-block/);
});
