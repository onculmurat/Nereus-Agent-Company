// 1.3.33: g72, the destructive-command guard blocked a node -e file edit as an unbalanced quote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDestructive, mentionsDelete } from '../scripts/lib/destructive.js';

const ctx = { toolName: 'Bash', cwd: 'D:/Projects/app', root: 'D:/Projects/app', deleteRoots: [] };

// Seen live (Memory Agent T-100, g72): a developer edited a Rust test with node -e '...'; the JS template literals were
// read as `...` substitutions inside single quotes, and rest.find( as the find command. The edit was blocked, retried
// once unchanged and then redone with four Edit calls.
test('g72: backticks inside single quotes and a .find( method call are not commands', () => {
  const cmd = [
    'cd "D:/Projects/wt/T-100" && node -e \'',
    'const fs=require("fs");let s=fs.readFileSync("a.rs","utf8");',
    'const old=`        if t.replace(\\x27 \\x27, "").contains("panic=abort")`;',
    's=s.replace(old,`        // `panic = "abort"` reads `panic=abort`',
    '        while let Some(p) = rest.find("panic=") {`);',
    'fs.writeFileSync("a.rs",s);\'',
    'cargo test',
  ].join('\n');
  assert.equal(checkDestructive(cmd, ctx), null);
  assert.equal(mentionsDelete('rest.find("x")'), false);
  assert.equal(mentionsDelete('list.remove-item'), false);
});

test('g72: real deletes are still checked', () => {
  assert.ok(checkDestructive('echo `rm -rf /`', ctx));
  assert.ok(checkDestructive('echo "$(rm -rf /)"', ctx));
  assert.ok(checkDestructive("echo 'x' && rm -rf /", ctx));
  assert.ok(checkDestructive("echo \"it's\" `rm -rf C:/Users`", ctx));
  assert.ok(checkDestructive('cd D:/x && find / -delete', ctx));
  assert.ok(mentionsDelete('x && rm -rf y'));
  assert.ok(mentionsDelete('/bin/rm -rf y'));
  assert.ok(mentionsDelete('find . -delete'));
});
