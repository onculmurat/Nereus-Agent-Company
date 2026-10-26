// 1.3.45: g86, the context pack brings the decisions whose heading names the task, even when the brief does not cite them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeProject } from './helpers.js';
import { buildPack } from '../scripts/lib/pack.js';

// Seen live (Memory Agent T-087c, 10-26): the owner chose B for S6 on 10-21 (D-263, "(T-087c S6)" in its heading), the
// brief did not name D-263, the developer built A and the task went to a fix round.
function project(brief) {
  const root = makeProject();
  fs.mkdirSync(path.join(root, 'team', 'work', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'work', 'tasks', 'T-087c.md'), brief);
  fs.writeFileSync(path.join(root, 'team', 'decisions.md'), [
    '# Decisions', '',
    '### D-263: Rejected --data-dir spelling the default dir (T-087c S6)', '- answer: Owner: B, read-only checks first.', '',
    '### D-264: Header after failed reconcile (T-087a S2)', '- answer: A.', '',
    '### D-270: Umbrella order (T-087)', '- answer: c before b.', '',
    '### D-271: Cap for T-087c and T-087a', '- answer: 3.', '',
  ].join('\n'));
  return root;
}

test('g86: a decision whose heading names the task comes with the pack without a citation in the brief', () => {
  const { text } = buildPack(project('# T-087c\n\nS6: rejected --data-dir.\n'), { id: 'T-087c', role: 'backend-developer' });
  assert.match(text, /## Decisions[\s\S]*D-263: Rejected --data-dir[\s\S]*Owner: B/);
  assert.match(text, /D-271: Cap for T-087c and T-087a/);
  assert.doesNotMatch(text, /D-264|D-270/, 'another task or the parent task id is not a match');
});

test('g86: a decision cited in the brief and named in its heading appears once', () => {
  const { text } = buildPack(project('# T-087c\n\nDecisions: D-263\n'), { id: 'T-087c', role: 'backend-developer' });
  assert.equal(text.match(/### D-263/g)?.length, 1);
});
