import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const en = fs.readFileSync(path.join(pluginRoot, 'README.md'), 'utf8');
const tr = fs.readFileSync(path.join(pluginRoot, 'README.tr.md'), 'utf8');
const count = (text, re) => (text.match(re) ?? []).length;
const codeBlocks = (text) => [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);

test('both READMEs have the same heading structure', () => {
  assert.ok(count(en, /^## /gm) > 5);
  assert.equal(count(en, /^## /gm), count(tr, /^## /gm));
  assert.equal(count(en, /^### /gm), count(tr, /^### /gm));
});

test('both READMEs have the same code blocks in the same order', () => {
  assert.deepEqual(codeBlocks(tr), codeBlocks(en));
});

test('each README links the other', () => {
  assert.match(en, /\(README\.tr\.md\)/);
  assert.match(tr, /\(README\.md\)/);
});

test('README mentions every command', () => {
  for (const f of fs.readdirSync(path.join(pluginRoot, 'commands'))) {
    const cmd = `/nac:${f.replace(/\.md$/, '')}`;
    assert.ok(en.includes(cmd), `README.md lacks ${cmd}`);
    assert.ok(tr.includes(cmd), `README.tr.md lacks ${cmd}`);
  }
});

test('README lists every agent role', () => {
  for (const f of fs.readdirSync(path.join(pluginRoot, 'agents'))) {
    const role = f.replace(/\.md$/, '');
    assert.ok(en.includes(`| ${role} |`), `README.md lacks ${role}`);
    assert.ok(tr.includes(`| ${role} |`), `README.tr.md lacks ${role}`);
  }
});

test('setup requirements name Node 20 and the agent teams flag', () => {
  const req = fs.readFileSync(path.join(pluginRoot, 'docs', 'setup-requirements.md'), 'utf8');
  assert.match(req, /Node\.js 20/);
  assert.match(req, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/);
});

test('setup requirements name the web tools the research roles use', () => {
  const req = fs.readFileSync(path.join(pluginRoot, 'docs', 'setup-requirements.md'), 'utf8');
  assert.match(req, /WebSearch/);
  assert.match(req, /WebFetch/);
});

test('plugin and package versions match the release the READMEs describe', () => {
  const version = (...p) => JSON.parse(fs.readFileSync(path.join(pluginRoot, ...p), 'utf8')).version;
  assert.equal(version('.claude-plugin', 'plugin.json'), '1.3.19');
  assert.equal(version('package.json'), '1.3.19');
  assert.match(en, /## Changes in 1\.3\.4[\s\S]*g30/);
  assert.match(tr, /## 1\.3\.4 değişiklikleri[\s\S]*g30/);
  assert.match(en, /\*\*v1\.3 scope\.\*\*/);
});

test('both READMEs list team/research/ among the committed files', () => {
  assert.match(en, /`team\/brief\.md`[^\n]*`research\/`[^\n]*committed/);
  assert.match(tr, /`team\/brief\.md`[^\n]*`research\/`[^\n]*commit/);
});

test('both READMEs list every 1.3.0 change with its g-number', () => {
  const section = (text, heading) => text.slice(text.indexOf(heading), text.indexOf('\n## ', text.indexOf(heading) + 1));
  const ids = ['g11', 'g12', 'g13', 'g14', 'g15', 'g16', 'g17', 'g18', 'g19', 'g20', 'g21', 'g22', 'g23', 'g24', 'g25', 'g26', 'D-227'];
  for (const [text, heading] of [[en, '## Changes in 1.3.0'], [tr, '## 1.3.0 değişiklikleri']]) {
    assert.ok(text.includes(heading), heading);
    const body = section(text, heading);
    for (const id of ids) assert.ok(body.includes(`(${id}`), `${heading} lacks ${id}`);
  }
  assert.match(en, /## Changes in 1\.3\.1[\s\S]*\(g27\)[\s\S]*--permissions/);
  assert.match(tr, /## 1\.3\.1 değişiklikleri[\s\S]*\(g27\)[\s\S]*--permissions/);
});
