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

// Item 3: guard blind spots.
const { checkDestructive } = await import('../scripts/lib/destructive.js');
const WIN = { platform: 'win32', root: 'C:\\proj', cwd: 'C:\\proj', home: 'C:\\Users\\u', tmpDirs: ['C:\\Users\\u\\AppData\\Local\\Temp'], canonicalize: false };
const POSIX = { platform: 'linux', root: '/home/u/proj', cwd: '/home/u/proj', home: '/home/u', tmpDirs: ['/tmp'], canonicalize: false };
const check = (env, command, toolName = 'Bash') => checkDestructive(command, { ...env, toolName });
const blocked = (env, commands, toolName = 'Bash') => {
  for (const c of commands) assert.match(check(env, c, toolName) ?? '', /^NAC destructive-command guard: blocked a recursive delete/, `should be blocked: ${c}`);
};
const allowed = (env, commands, toolName = 'Bash') => {
  for (const c of commands) assert.equal(check(env, c, toolName), null, `should be allowed: ${c}`);
};

test('git clean with -x or -X plus -f or -d is blocked in any flag order; dry runs and plain clean stay allowed', () => {
  blocked(POSIX, ['git clean -fdx', 'git clean -f -d -x', 'git clean -xfd', 'git clean -fX', 'git clean -x -f', 'git clean -dx', 'git -C sub clean -fdx', 'git clean --force -x', 'git clean -fd -x -e keep']);
  allowed(POSIX, ['git clean -n', 'git clean -fdxn', 'git clean -fd -x --dry-run', 'git clean -fd', 'git clean -f', 'git status', 'git clean -n -x']);
});

test('inline interpreters that delete a blocked path are blocked; an allowed explicit path stays allowed', () => {
  blocked(POSIX, [
    `node -e "require('fs').rmSync('/', {recursive: true})"`, `node --eval "fs.rmSync(process.env.HOME, {recursive:true})"`, `node -p "fs.rmSync('/home/u', {recursive:true,force:true})"`,
    `node -e "require('fs').rmSync('.', {recursive: true, force: true})"`, `node -e "fs.rmdirSync('/tmp', {recursive:true})"`, `node -e "fs.rm(dir, {recursive:true}, () => {})"`,
    `python -c "import shutil; shutil.rmtree('/')"`, `python3 -c "import shutil; shutil.rmtree(d)"`, `py -c "import shutil; shutil.rmtree('/home/u')"`,
    `python3 -c "import shutil; shutil.rmtree('/home/u/proj')"`, `perl -e 'use File::Path; rmtree("/")'`, `ruby -e 'FileUtils.rm_rf("/")'`,
    `python -c "import os; os.system('rm -rf /')"`, `node -e "require('child_process').execSync('rm -rf ~')"`,
  ]);
  blocked(WIN, ['powershell -Command "Remove-Item -Recurse -Force C:\\"', 'pwsh -c "Remove-Item -Recurse -Force $HOME"']);
  allowed(POSIX, [
    `node -e "require('fs').rmSync('build', {recursive: true, force: true})"`, `python -c "import shutil; shutil.rmtree('/tmp/x')"`, `python3 -c "import shutil; shutil.rmtree('./out')"`,
    `perl -e 'use File::Path; rmtree("build")'`, `ruby -e 'FileUtils.rm_rf("/tmp/x")'`, `node -e "console.log(1)"`, `python -c "print('rm -rf /')"`,
    `node -e "require('child_process').execSync('rm -rf build')"`,
  ]);
});

test('-EncodedCommand is decoded and checked; undecodable text is blocked', () => {
  const enc = (text) => Buffer.from(text, 'utf16le').toString('base64');
  for (const flag of ['-EncodedCommand', '-enc', '-e', '-ec']) {
    blocked(WIN, [`powershell -NoProfile ${flag} ${enc('Remove-Item -Recurse -Force C:\\')}`, `pwsh ${flag} ${enc('rm -r ~')}`]);
    allowed(WIN, [`powershell ${flag} ${enc('Remove-Item -Recurse -Force build')}`, `pwsh ${flag} ${enc('Get-Date')}`]);
  }
  blocked(WIN, ['powershell -enc !!notbase64!!', 'powershell -EncodedCommand', `powershell -enc ${Buffer.from([0xff, 0xfe, 0xfd]).toString('base64')}`]);
  assert.match(check(WIN, 'powershell -enc !!notbase64!!'), /EncodedCommand/);
});

// Real files: the project and the scratchpad are scanned, the plugin and missing or large files are not.
const realEnv = (root) => ({ root, cwd: root });
const fwd = (p) => p.replace(/\\/g, '/');
function withScripts(fn) {
  const root = fs.realpathSync(makeProject());
  const write = (name, text) => { fs.writeFileSync(path.join(root, name), text); return `"${fwd(root)}/${name}"`; };
  return fn(root, write);
}

test('a script inside the project that deletes a blocked path is blocked, whatever runs it', () => {
  withScripts((root, write) => {
    const sh = write('bad.sh', '#!/bin/sh\necho start\nrm -rf /\n');
    const ps = write('bad.ps1', 'Remove-Item -Recurse -Force $env:USERPROFILE\n');
    const js = write('bad.js', `import fs from 'node:fs';\nfs.rmSync('/', { recursive: true });\n`);
    const py = write('bad.py', `import shutil\nshutil.rmtree(target)\n`);
    const unknown = write('unk.sh', 'rm -rf "$DIR"\n');
    for (const c of [`bash ${sh}`, `sh ${sh}`, `bash -e ${sh}`, `${sh}`, `node ${js}`, `python ${py}`, `python3 ${py}`, `bash ${unknown}`]) {
      assert.match(checkDestructive(c, { ...realEnv(root), toolName: 'Bash' }) ?? '', /blocked a recursive delete/, c);
    }
    assert.match(checkDestructive(`pwsh ${ps}`, { ...realEnv(root), toolName: 'PowerShell' }) ?? '', /blocked a recursive delete/);
    assert.match(checkDestructive(`bash bad.sh`, { ...realEnv(root), toolName: 'Bash' }) ?? '', /blocked/);
  });
});

test('scripts that delete an allowed path, missing files, large files and plugin scripts are allowed', () => {
  withScripts((root, write) => {
    const ok = write('ok.sh', 'rm -rf build\n');
    const okJs = write('ok.js', `fs.rmSync('build', { recursive: true });\n`);
    const big = write('big.sh', `${'# padding\n'.repeat(8000)}rm -rf /\n`);
    const env = { ...realEnv(root), toolName: 'Bash' };
    assert.ok(fs.statSync(path.join(root, 'big.sh')).size > 64 * 1024);
    for (const c of [`bash ${ok}`, `node ${okJs}`, `bash "${fwd(root)}/missing.sh"`, `bash ${big}`, `node "${fwd(pluginRoot)}/scripts/board.js" show`, `bash "$SOME/x.sh"`]) {
      assert.equal(checkDestructive(c, env), null, c);
    }
  });
});

test('a script outside the project and the temp folder is not read', () => {
  const base = fs.realpathSync(makeProject());
  const root = path.join(base, 'sub');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(base, 'other.sh'), 'rm -rf /\n');
  const env = { root, cwd: root, tmpDirs: [path.join(base, 'tmpd')], toolName: 'Bash' };
  assert.equal(checkDestructive(`bash ${fwd(base)}/other.sh`, env), null);
});

// Item 4: variables assigned a literal value earlier in the same command are resolved.
test('literal assignments in the same command are substituted before the rules apply', () => {
  allowed(POSIX, [
    'S="/tmp/x"; rm -rf "$S"', 'SP=/tmp/sp; rm -rf "$SP"', "P='/tmp/p y'; rm -rf \"$P\"", 'export P=/tmp/e && rm -rf $P', 'D=build; rm -rf ${D}/out',
    'A=/tmp/a; B=/tmp/b; rm -rf "$A" "$B"',
  ]);
  allowed(WIN, ['$Dir = "C:/proj/out"; Remove-Item -Recurse -Force $Dir', "$d = 'C:/proj/o'; Remove-Item -Recurse $d"], 'PowerShell');
  blocked(POSIX, ['P=/; rm -rf "$P"', 'P="$HOME"; rm -rf "$P"', 'P=~; rm -rf $P', 'P=/home/u; rm -rf "$P"', 'P=$(pwd); rm -rf "$P"', 'P=$Q; rm -rf "$P"', 'P=`pwd`; rm -rf "$P"',
    'rm -rf "$UNSET"', 'export P=/; rm -rf $P', 'P=/tmp/x; Q=$P/..; rm -rf "$Q"']);
  blocked(WIN, ['$p = "C:\\"; Remove-Item -Recurse -Force $p', '$p = $env:USERPROFILE; Remove-Item -Recurse $p'], 'PowerShell');
});

test('a reassignment after the delete does not count, and a later one replaces an earlier one', () => {
  blocked(POSIX, ['rm -rf "$S"; S=/tmp/x', 'S=/tmp/x; S=/; rm -rf "$S"', 'S=/tmp/x; rm -rf "$S"; S=/; rm -rf "$S"']);
  allowed(POSIX, ['S=/; S=/tmp/x; rm -rf "$S"']);
});
