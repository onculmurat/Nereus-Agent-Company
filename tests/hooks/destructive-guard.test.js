import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProject } from '../helpers.js';
import { runHook, fixture, pluginRoot } from './run-hook.js';
import { checkDestructive } from '../../scripts/lib/destructive.js';

// Unit level: fixed fake machines, so the same table runs on any OS the tests are started on.
const WIN = { platform: 'win32', root: 'C:\\proj', cwd: 'C:\\proj', home: 'C:\\Users\\u', tmpDirs: ['C:\\Users\\u\\AppData\\Local\\Temp'], canonicalize: false };
const POSIX = { platform: 'linux', root: '/home/u/proj', cwd: '/home/u/proj', home: '/home/u', tmpDirs: ['/tmp'], canonicalize: false };
const check = (env, command, toolName = 'Bash') => checkDestructive(command, { ...env, toolName });

function assertBlocked(env, commands, toolName = 'Bash') {
  for (const c of commands) {
    const r = check(env, c, toolName);
    assert.ok(r, `should be blocked: ${c}`);
    assert.match(r, /^NAC destructive-command guard: blocked a recursive delete/, c);
    assert.match(r, /ask the lead, who asks the owner/, c);
  }
}
function assertAllowed(env, commands, toolName = 'Bash') {
  for (const c of commands) assert.equal(check(env, c, toolName), null, `should be allowed: ${c}`);
}

test('rm -r on a root, a drive, home or the parent is blocked in every spelling', () => {
  assertBlocked(WIN, [
    'rm -rf /', 'rm -rf /*', 'rm -rf C:', 'rm -rf C:/', 'rm -rf C:\\', 'rm -rf c:\\*', 'rm -rf /c/', 'rm -rf /c', 'rm -rf /cygdrive/c/',
    'rm -rf ~', 'rm -rf ~/', 'rm -rf ~/*', 'rm -rf $HOME', 'rm -rf "$HOME/projects"', 'rm -rf ${HOME}',
    'rm -r -f /', 'rm -fr /', 'rm -Rf /', 'rm -R /', 'rm --recursive --force /', 'rm -rf -- /', 'rm -rfv /', 'rm -r /',
    'rm -rf ..', 'rm -rf ../x', 'rm -rf ../../..', 'rm -rf ./..', 'rm -rf /etc', "rm -rf '/'", 'rm -rf "/"', 'rm -rf "C:\\"', 'rm -rf "C:\\Users"',
    'rm -rf /home', 'rm -rf C:/Users/u', 'rm -rf C:/Windows', 'rm -rf D:/', 'rm -rf proj/../..',
  ]);
  assertBlocked(POSIX, ['rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf ~/', 'rm -rf $HOME', 'rm -rf /home/u', 'rm -rf /home/u/other', 'rm -rf /home/u/proj/../..',
    'rm -rf /etc', 'rm -rf ..', 'rm -rf /tmp', 'rm -rf /tmp/', 'rm -rf /tmp/../etc', 'rm -rf /var', 'rm -rf -- /']);
});

test('the project root itself and the temp folder itself are blocked, their children are not', () => {
  assertBlocked(POSIX, ['rm -rf .', 'rm -rf ./', 'rm -rf /home/u/proj', 'rm -rf /tmp', 'rm -rf $TMPDIR', 'rm -rf $CLAUDE_PROJECT_DIR']);
  assertAllowed(POSIX, ['rm -rf *', 'rm -rf ./*', 'rm -rf /tmp/*', 'rm -rf /tmp/x', 'rm -rf $TMPDIR/x', 'rm -rf $CLAUDE_PROJECT_DIR/out', 'rm -rf $PWD/out']);
});

test('a target that cannot be resolved is blocked: variables, substitutions, patterns that match ..', () => {
  assertBlocked(POSIX, [
    'rm -rf $UNKNOWN', 'rm -rf $UNKNOWN/x', 'rm -rf "$dir"', 'rm -rf ${dir}/x', 'rm -rf $(echo /)', 'rm -rf `echo /`', 'rm -rf "$(pwd)/.."',
    'rm -rf .*', 'rm -rf .?', 'rm -rf .[.]', 'rm -rf ""', 'rm -rf ~other', 'rm -rf build/*/../../..',
    'ls | xargs rm -rf', 'ls | xargs -I{} rm -rf {}', 'find . -name x | xargs rm -rf build',
  ]);
  assertBlocked(WIN, ['rm -rf %SOMEDIR%', 'rm -rf %USERPROFILE%', 'rm -rf C:foo']);
});

test('deletes inside the project or the temp folder are allowed', () => {
  assertAllowed(POSIX, [
    'rm -rf build', 'rm -rf ./dist/', 'rm -rf node_modules', 'rm -rf src/*.o', 'rm -rf build/*', 'rm -rf "build dir"', "rm -rf 'a b'", 'rm -rf /home/u/proj/out',
    'rm -rf /tmp/x/y', 'rm -rf /tmp/a', 'rm -rf build/{a,b}', 'rm -rf --no-preserve-root build', 'rm -rf -- build', 'rm -rf .git',
    'rm -r build; echo done', 'rm -rf a b c', 'rm -rf build && mkdir build', 'rm -rf *.o', 'rm -rf ./src/../build',
  ]);
  assertAllowed(WIN, [
    'rm -rf build', 'rm -rf C:/proj/out', 'rm -rf C:\\proj\\out', 'rm -rf /tmp/x', 'rm -rf /c/proj/out', 'rm -rf C:/Users/u/AppData/Local/Temp/x',
    'rm -rf $TMPDIR/x', 'rm -rf $env:TEMP/x', 'rm -rf %TEMP%/x', 'rm -rf "C:\\proj\\a b"',
  ]);
});

test('commands that only mention a delete, or delete without recursion, are not blocked', () => {
  assertAllowed(POSIX, [
    'echo "rm -rf /"', "echo 'rm -rf /' > notes.txt", 'git commit -m "remove rm -rf /"', 'grep -r "rm -rf" .', 'ls -r /', 'rm file.txt', 'rm -f /etc/hosts',
    'rmdir /tmp/x', 'rmdir emptydir', 'cat README.md', 'git rm -r --cached build', 'npm run clean', 'node -e "console.log(1)"', 'rm', 'rm -rf',
    'cat <<EOF\nrm -rf /\nEOF', "cat <<'EOF' > script.sh\nrm -rf ~\nEOF\necho done", 'git clean -n',
  ]);
});

test('separators, chains, wrappers, shells and substitutions do not hide a delete', () => {
  assertBlocked(POSIX, [
    'echo hi && rm -rf /', 'echo hi; rm -rf /', 'false || rm -rf /', 'echo hi | rm -rf /', 'echo hi & rm -rf /', 'echo a\nrm -rf /', 'echo a\r\nrm -rf /',
    'sudo rm -rf /', 'sudo -u root rm -rf /', 'command rm -rf /', 'env FOO=1 rm -rf /', 'FOO=1 rm -rf /', 'nohup rm -rf / &', 'time rm -rf /',
    '/bin/rm -rf /', '\\rm -rf /', 'if true; then rm -rf /; fi', 'for d in a; do rm -rf /; done', '(rm -rf /)', '{ rm -rf /; }',
    'bash -c "rm -rf /"', "sh -c 'rm -rf ~'", 'bash -lc "echo a; rm -rf /"', 'eval "rm -rf /"', 'echo $(rm -rf /)', 'echo `rm -rf /`', 'x=$(rm -rf /)',
    'bash -c "bash -c \\"rm -rf /\\""',
  ]);
  assertAllowed(POSIX, ['cd build && rm -rf out', 'cd src && rm -rf ../build', 'cd /tmp && rm -rf x', 'echo "$(ls)" && rm -rf build', 'bash -c "rm -rf build"', 'echo a 2>&1 | cat']);
});

test('cd is followed: the relative target is resolved from where the command is', () => {
  assertBlocked(POSIX, ['cd / && rm -rf x', 'cd .. && rm -rf proj2', 'cd ~ && rm -rf work', 'cd && rm -rf work', 'cd $SOMEWHERE && rm -rf x', 'cd - && rm -rf x', 'pushd .. ; rm -rf x']);
  assertAllowed(POSIX, ['cd build && rm -rf out', 'cd /tmp/x && rm -rf y', 'cd ./src; rm -rf ../out']);
});

test('find -delete and find -exec rm -r are checked on their start folders', () => {
  assertBlocked(POSIX, ['find / -delete', 'find ~ -name x -delete', 'find / -name core -exec rm -rf {} +', 'find .. -name x -delete', 'find /home/u -type d -exec rm -rf {} \\;']);
  assertAllowed(POSIX, ['find . -name "*.pyc" -delete', 'find build -type d -exec rm -rf {} +', 'find /tmp/x -delete', 'find / -name x', 'find / -name x -exec cat {} \\;']);
});

test('PowerShell: Remove-Item -Recurse and its aliases and parameter forms', () => {
  assertBlocked(WIN, [
    'Remove-Item -Recurse -Force C:\\', 'Remove-Item C:\\ -Recurse', 'Remove-Item -Path C:\\Users -Recurse -Force', 'Remove-Item -LiteralPath "C:\\Users" -Recurse',
    'ri -r -fo C:\\', 'rm -Recurse -Force ~', 'Remove-Item -Recurse $env:USERPROFILE', 'Remove-Item -Recurse -Force $env:USERPROFILE\\Documents',
    'Remove-Item -Recurse -Force $path', 'Remove-Item -Recurse -Force ..\\other', 'Remove-Item -Recurse:$true C:\\', 'Remove-Item -Rec C:\\x', 'remove-item -recurse c:\\',
    "Remove-Item -Recurse -Force 'C:\\Program Files'", 'Remove-Item -Recurse C:\\a,C:\\b', 'Remove-Item -Path .\\a, C:\\ -Recurse', 'del -Recurse C:\\x', 'rmdir -Recurse C:\\x',
    'Get-ChildItem C:\\x | Remove-Item -Recurse', 'Get-ChildItem | ForEach-Object { Remove-Item -Recurse -Force $_ }', 'Remove-Item -Recurse -Force /', 'Remove-Item -Recurse -Force $HOME',
    'Remove-Item -Recurse (Join-Path $env:USERPROFILE x)', 'Remove-Item -Recurse -Force "$env:USERPROFILE"', 'echo a; Remove-Item -Recurse -Force C:\\',
    'powershell -Command "Remove-Item -Recurse -Force C:\\"', 'pwsh -c "rm -r ~"', 'powershell.exe -NoProfile -Command Remove-Item -Recurse C:\\x',
    'Remove-Item -Recurse -Force "$(Get-Location)\\.."', 'Remove-Item * -Recurse -Path C:\\',
  ], 'PowerShell');
  assertAllowed(WIN, [
    'Remove-Item build -Recurse -Force', 'Remove-Item -Path .\\build\\* -Recurse', 'Remove-Item -Recurse -Force $env:TEMP\\x', 'Remove-Item foo.txt', 'Remove-Item -Force foo.txt',
    'ri build -r', 'rm -Force foo', 'Remove-Item -Recurse -Force "C:\\proj\\out"', 'Remove-Item -Recurse -Force .\\a, .\\b', 'Remove-Item -Recurse:$false C:\\',
    'Remove-Item -Recurse -Exclude keep.txt .\\out', 'Get-ChildItem | Select-Object -First 1', 'Write-Output "Remove-Item -Recurse C:\\"', 'Set-Location build; Remove-Item -Recurse out',
    '@\'\nRemove-Item -Recurse C:\\\n\'@ | Set-Content notes.txt', 'git commit -m "Remove-Item -Recurse C:\\"',
  ], 'PowerShell');
});

test('cmd forms: rmdir /s, rd /s, del /s, also through cmd /c and from Bash', () => {
  for (const tool of ['Bash', 'PowerShell']) {
    assertBlocked(WIN, [
      'rmdir /s /q C:\\', 'rmdir /S /Q C:\\', 'rd /s /q C:\\Windows', 'rd /s/q C:\\x', 'rd /q /s C:\\', 'rmdir /s C:\\x', 'del /s /q C:\\*', 'del /s C:\\*.log', 'del /f /s /q %USERPROFILE%',
      'erase /s /q C:\\x', 'rd /s /q %TEMP%', 'rd /s /q %SOMEDIR%\\x', 'cmd /c "rd /s /q C:\\"', 'cmd /c rd /s /q C:\\', 'rd /s /q ..\\other', 'rd /s /q "C:\\Program Files"',
      'del /s /q /f ~\\*', 'rmdir /s /q /',
    ], tool);
    assertAllowed(WIN, ['rd /s /q build', 'rmdir /s /q .\\out', 'del /s /q *.tmp', 'del /q file.txt', 'rd emptydir', 'rmdir emptydir', 'cmd /c "rd /s /q build"', 'del /s /q build\\*'], tool);
  }
});

test('Unix forms of rmdir and rd are not treated as recursive', () => {
  assertAllowed(POSIX, ['rmdir /tmp/x', 'rmdir -p a/b']);
});

test('rimraf is a recursive delete too', () => {
  assertBlocked(POSIX, ['npx rimraf /', 'rimraf ~', 'npx rimraf ../x']);
  assertAllowed(POSIX, ['npx rimraf dist', 'rimraf build/*']);
});

test('symlinked or short paths of the real machine compare by their real location', () => {
  const root = fs.realpathSync(makeProject());
  const outside = fs.mkdtempSync(path.join(path.dirname(root), 'nac outside '));
  const env = { root, cwd: root, tmpDirs: [path.join(root, 'tmpdir')], home: path.dirname(root) };
  fs.mkdirSync(env.tmpDirs[0]);
  assert.equal(checkDestructive('rm -rf build', { ...env, toolName: 'Bash' }), null);
  assert.ok(checkDestructive(`rm -rf "${outside}"`, { ...env, toolName: 'Bash' }));
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
  } catch {
    return;
  }
  assert.ok(checkDestructive('rm -rf link/inner', { ...env, toolName: 'Bash' }), 'a junction inside the project that points outside is outside');
});

// ---- the hook itself ------------------------------------------------------------------------------------------

async function call(root, command, tool_name = 'Bash', patch = {}) {
  return runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name, tool_input: { command }, ...patch }));
}

test('the hook blocks with exit 2 and a message that tells the agent to ask the lead', async () => {
  const root = makeProject();
  const r = await call(root, 'rm -rf /');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /NAC destructive-command guard: blocked a recursive delete \(rm -rf \/\)/);
  assert.match(r.stderr, /ask the lead, who asks the owner/);
  assert.equal((await call(root, 'Remove-Item -Recurse -Force C:\\', 'PowerShell')).status, 2);
  assert.equal((await call(root, 'rm -rf $SOMEWHERE/x')).status, 2);
  assert.equal((await call(root, 'rm -rf ..')).status, 2);
  assert.equal((await call(root, 'rd /s /q C:\\', 'PowerShell')).status, 2);
});

test('the hook lets deletes inside the project and the temp folder through', async () => {
  const root = makeProject();
  assert.equal((await call(root, 'rm -rf build dist')).status, 0);
  assert.equal((await call(root, `rm -rf "${path.join(root, 'out')}"`)).status, 0);
  assert.equal((await call(root, `rm -rf "${path.join(os.tmpdir(), 'nac-x')}"`)).status, 0);
  assert.equal((await call(root, 'Remove-Item -Recurse -Force build', 'PowerShell')).status, 0);
  assert.equal((await call(root, 'ls -la')).status, 0);
  assert.equal((await call(root, 'rm file.txt')).status, 0);
});

test('every role and the lead are held the same way', async () => {
  const root = makeProject();
  for (const agent_type of ['nac:backend-developer', 'code-reviewer', 'nac:architect', 'general-purpose', 'researcher']) {
    assert.equal((await call(root, 'rm -rf /', 'Bash', { agent_type })).status, 2, agent_type);
    assert.equal((await call(root, 'rm -rf build', 'Bash', { agent_type })).status, 0, agent_type);
  }
  const lead = await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Bash', tool_input: { command: 'rm -rf ~' } });
  delete lead.agent_type;
  delete lead.agent_id;
  assert.equal(runHook('destructive-guard', lead).status, 2);
});

test('other tools, odd input and a folder that is not a NAC project are left alone', async () => {
  const root = makeProject();
  assert.equal(runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Read', tool_input: { file_path: '/' } })).status, 0);
  assert.equal(runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Write', tool_input: { command: 'rm -rf /' } })).status, 0);
  assert.equal((await call(root, '')).status, 0);
  assert.equal(runHook('destructive-guard', await fixture('pre-tool-use.synthetic', { cwd: root, tool_name: 'Bash', tool_input: {} })).status, 0);
  assert.equal(runHook('destructive-guard', 'not json').status, 0);
  assert.equal(runHook('destructive-guard', '').status, 0);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'not nac '));
  assert.equal((await call(outside, 'rm -rf /')).status, 0);
});

test('the hook resolves relative targets against the cwd of the call', async () => {
  const root = makeProject();
  const sub = path.join(root, 'sub');
  fs.mkdirSync(sub);
  assert.equal((await call(sub, 'rm -rf ../build')).status, 0);
  assert.equal((await call(sub, 'rm -rf ../..')).status, 2);
});

test('hooks.json registers the guard for Bash and PowerShell next to the research guard', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const entry = hooks.find((h) => h.hooks.some((x) => x.command.includes('destructive-guard.js')));
  assert.ok(entry, 'destructive-guard.js is not registered');
  assert.equal(entry.matcher, 'Bash|PowerShell');
  assert.match(entry.hooks[0].command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/destructive-guard\.js"$/);
  assert.ok(hooks.some((h) => h.hooks.some((x) => x.command.includes('research-guard.js'))));
});
