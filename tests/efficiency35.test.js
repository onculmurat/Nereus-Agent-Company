// 1.3.44: g85, a PowerShell here-string no longer reads as an unbalanced quote to the destructive guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDestructive } from '../scripts/lib/destructive.js';
import { makeProject } from './helpers.js';

const ps = (root, command) => checkDestructive(command, { toolName: 'PowerShell', cwd: root, root, deleteRoots: [] });

// Seen live (Memory Agent T-078 close, 10-26): $j = @'...'@ with JSON findings, then a Remove-Item of the temp file,
// was blocked as "the command has an unbalanced quote".
test('g85: a here-string with quotes in its body and a delete of a project file passes', () => {
  const root = makeProject();
  for (const command of [
    "$j = @'\nhello\n'@\nRemove-Item x.json",
    "$j = @'\nit's -Name:'x' and '' escape\n'@\n$j | Out-File x.json\nRemove-Item x.json -Confirm:$false",
    '$j = @"\nit\'s "q"\n"@\nRemove-Item x.json',
  ]) assert.equal(ps(root, command) ?? null, null, command);
});

test('g85: a delete after the closing quote on the same line is still checked', () => {
  const root = makeProject();
  assert.match(ps(root, "$j = @'\nbody\n'@; Remove-Item -Recurse -Force C:\\Windows\\x") ?? '', /blocked a recursive delete/);
  assert.match(ps(root, "$j = @'\nbody\n'@\nRemove-Item -Recurse -Force C:\\Windows\\x") ?? '', /blocked a recursive delete/);
});
