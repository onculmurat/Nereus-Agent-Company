import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assembleContext, CONTEXT_LIMIT } from '../scripts/lib/start-context.js';
import { makeProject, makeGitProject } from './helpers.js';
import { runHook, fixture } from './hooks/run-hook.js';

// g51: Claude Code saves hook context over 10,000 characters to a file and shows only a ~2 KB preview. The marker sat
// at character 7182, so a new lead session said "NAC is not loaded" and never saw its prompt, rules, proxy or resume.
const PREVIEW = 2000;
const ctxOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

test('the marker comes first, and the lead prompt stays inline while everything fits', () => {
  const text = assembleContext({ marker: 'NAC-LEAD-ACTIVE', sections: ['## Owner proxy\n\np'], lead: '# NAC lead instructions\n\nbody', leadFile: '/x/lead.md' });
  assert.ok(text.startsWith('NAC-LEAD-ACTIVE'));
  assert.match(text, /body/);
  assert.doesNotMatch(text, /\/x\/lead\.md/);
});

test('over the limit the lead prompt becomes a pointer to its file and the other sections stay whole', () => {
  const sections = ['## Owner proxy\n\nproxy-x', `## Resume\n\n${'r'.repeat(2500)}`];
  const text = assembleContext({ marker: 'NAC-LEAD-ACTIVE', sections, lead: 'L'.repeat(7000), leadFile: '/x/lead.md' });
  assert.ok(text.length <= CONTEXT_LIMIT);
  assert.ok(text.startsWith('NAC-LEAD-ACTIVE'));
  assert.match(text, /Read \/x\/lead\.md in full/);
  assert.doesNotMatch(text, /LLLL/);
  assert.match(text, /proxy-x/);
  assert.ok(text.includes('r'.repeat(2500)));
});

test('a resume too long even for the pointer form is cut with a note, never pushed past the limit', () => {
  const text = assembleContext({ marker: 'NAC-LEAD-ACTIVE', sections: [`## Resume\n\n${'r'.repeat(20000)}`], lead: 'L', leadFile: '/x/lead.md' });
  assert.ok(text.length <= CONTEXT_LIMIT);
  assert.ok(text.startsWith('NAC-LEAD-ACTIVE'));
  assert.match(text, /cut here/);
});

test('session start on a small project keeps the lead prompt inline, marker first, under the limit', async () => {
  const text = ctxOf(runHook('session-start', await fixture('session-start-startup', { cwd: makeProject() })));
  assert.ok(text.length <= CONTEXT_LIMIT, `${text.length}`);
  assert.ok(text.slice(0, PREVIEW).includes('NAC-LEAD-ACTIVE'));
  assert.match(text, /# NAC lead instructions\n\nYou are the team lead/);
});

test('session start with a proxy and a long resume stays under the limit with the marker and proxy in the preview', async () => {
  const { root } = makeGitProject();
  fs.writeFileSync(path.join(root, 'team', 'config.json'), JSON.stringify({ ownerProxy: { session: 'agent-team-e4' } }));
  for (let i = 0; i < 25; i += 1) fs.writeFileSync(path.join(root, `untracked-file-with-a-long-name-${i}-${'x'.repeat(90)}.txt`), '');
  const text = ctxOf(runHook('session-start', await fixture('session-start-startup', { cwd: root })));
  assert.ok(text.length <= CONTEXT_LIMIT, `${text.length}`);
  const preview = text.slice(0, PREVIEW);
  assert.ok(preview.includes('NAC-LEAD-ACTIVE'));
  assert.ok(preview.includes('agent-team-e4'));
  assert.match(text, /Read .*prompts[\\/]lead\.md in full/);
  assert.match(text, /## Resume/);
  assert.match(text, /## Resolved rules/);
});
