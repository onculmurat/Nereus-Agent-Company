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
