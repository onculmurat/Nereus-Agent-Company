import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProject } from './helpers.js';
import { addEntry, updateEntry } from '../scripts/lib/board.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(pluginRoot, ...p), 'utf8');

test('to-lead means decide, re-plan or escalate; the implementation round goes to the owning role (both skills)', () => {
  for (const f of ['task-loop', 'escalation']) {
    const t = read('skills', f, 'SKILL.md');
    assert.match(t, /`to-lead` means[^\n]*decide[^\n]*re-plan[^\n]*escalate/i, `${f} lacks the to-lead meaning`);
    assert.match(t, /owning role[^\n]*delta pack[^\n]*--paths/i, `${f} lacks the delta pack rule`);
    assert.match(t, /decision id/i);
    assert.match(t, /never (the )?(source|test) (or test )?code|never source or test code/i);
  }
});

test('the old wording that let the lead implement a to-lead round is gone everywhere', () => {
  const files = ['skills/task-loop/SKILL.md', 'skills/escalation/SKILL.md', 'prompts/lead.md', 'README.md', 'README.tr.md'];
  for (const f of files) {
    const t = read(...f.split('/'));
    assert.doesNotMatch(t, /takes a round only when/, f);
    assert.doesNotMatch(t, /you take one round yourself/, f);
    assert.doesNotMatch(t, /only case where you take a fix round yourself/, f);
    assert.doesNotMatch(t, /the lead takes one only when the ladder says/, f);
    assert.doesNotMatch(t, /lider yalnız merdiven `to-lead` dediğinde tur alır/, f);
    assert.doesNotMatch(t, /you take a round yourself/, f);
  }
  assert.match(read('prompts', 'lead.md'), /`to-lead` \(you decide, re-plan or escalate/);
});

test('the lead owns no code task on the board', () => {
  const root = makeProject();
  for (const owner of ['lead', 'team-lead', 'nac:team-lead']) {
    assert.throws(() => addEntry(root, { title: 'x', owner, model: 'opus' }), /lead.*code task|code task.*lead/i);
  }
  assert.throws(() => addEntry(root, { title: 'x', owner: 'lead', model: 'opus', code: 'yes' }), /code task/);
  assert.equal(addEntry(root, { title: 'notes', owner: 'lead', model: 'opus', code: 'no' }).owner, 'lead');
  const e = addEntry(root, { title: 'y', owner: 'backend-developer', model: 'sonnet' });
  assert.throws(() => updateEntry(root, e.id, { owner: 'lead' }), /code task/);
  assert.equal(updateEntry(root, e.id, { owner: 'frontend-developer' }).owner, 'frontend-developer');
  assert.equal(updateEntry(root, e.id, { owner: 'lead', code: 'no' }).owner, 'lead');
  const docs = addEntry(root, { title: 'docs', owner: 'lead', model: 'opus', code: 'no' });
  assert.throws(() => updateEntry(root, docs.id, { code: 'yes' }), /code task/);
});
