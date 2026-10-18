import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cloneTarget, cloneArgs } from '../scripts/lib/research.js';

const base = path.join('T', 'nac-research');

test('cloneTarget accepts a plain https repository URL and names a folder under the base', () => {
  const dir = cloneTarget('https://github.com/thedotmack/claude-mem.git', base, 1700000000000);
  assert.equal(path.dirname(dir), base);
  assert.match(path.basename(dir), /^github\.com-thedotmack-claude-mem-1700000000000$/);
});

test('cloneTarget rejects anything but a plain https URL', () => {
  for (const url of [
    'http://github.com/a/b', 'ssh://git@github.com/a/b', 'file:///etc', 'git@github.com:a/b',
    'https://github.com/a/../b', 'https://github.com/a/b c', 'https://github.com/a/b;rm', '--upload-pack=x',
    'https://user:pw@github.com/a/b', 'https://localhost/a/b', 'https://127.0.0.1/a/b', '',
  ]) {
    assert.throws(() => cloneTarget(url, base, 1), /plain https/, url);
  }
});

test('cloneArgs clones shallow, without submodules, tags, hooks or symlinks', () => {
  const args = cloneArgs('https://github.com/a/b', path.join(base, 'x'));
  assert.ok(args.includes('core.symlinks=false'));
  assert.ok(args.includes('core.hooksPath=/dev/null') || args.some((a) => a.startsWith('core.hooksPath=')));
  for (const flag of ['--depth', '--no-recurse-submodules', '--no-tags']) assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(-3), ['--', 'https://github.com/a/b', path.join(base, 'x')]);
});
