import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { cloneTarget, cloneArgs, cloneEnv, isPrivateAddress, tmpRootProblem } from '../scripts/lib/research.js';

test('cloneTarget rejects numeric and hex hosts', () => {
  for (const url of ['https://127.1/a/b', 'https://0x7f.1/a/b', 'https://10.1/a/b', 'https://1.2.3/a/b', 'https://[::1]/a/b']) {
    assert.throws(() => cloneTarget(url, base, 1), /plain https/, url);
  }
});

test('isPrivateAddress flags loopback, private, link-local, CGNAT and unique-local addresses', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['140.82.112.3', '172.32.0.1', '8.8.8.8', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('cloneArgs refuses redirects, credential helpers and templates; cloneEnv ignores user and system git config', () => {
  const args = cloneArgs('https://github.com/a/b', path.join(base, 'x'));
  for (const a of ['http.followRedirects=false', 'credential.helper=', '--template=']) assert.ok(args.includes(a), a);
  const env = cloneEnv({ HOME: 'h' });
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_CONFIG_GLOBAL, os.devnull);
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

test('tmpRootProblem rejects a clone root that is a link', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-root-'));
  const real = path.join(parent, 'real');
  fs.mkdirSync(real);
  assert.equal(tmpRootProblem(real), null);
  assert.equal(tmpRootProblem(path.join(parent, 'missing')), null);
  const link = path.join(parent, 'link');
  fs.symlinkSync(real, link, 'junction');
  assert.match(tmpRootProblem(link), /link/);
});

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
