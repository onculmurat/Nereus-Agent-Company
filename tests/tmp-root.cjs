// Preloaded into every test process (package.json: node --require ./tests/tmp-root.cjs --test).
// g82: the tests made ~34,000 temp folders and never removed them. Every folder a test process makes with
// mkdtemp is recorded; when the whole run ends, the first process (the test runner) removes them, with the
// "<folder>-wt*" worktrees the tests add beside them. TMP stays where it was: pointing it at a run or per-process
// folder, or removing folders while other test files still ran, made git fail more often with "Permission denied"
// on .git/objects.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');

const mkdtempSync = fs.mkdtempSync;
const runner = !process.env.NAC_TEST_RUN;
if (runner) process.env.NAC_TEST_RUN = mkdtempSync(path.join(os.tmpdir(), 'nac-test-run-'));
const list = path.join(process.env.NAC_TEST_RUN, `${process.pid}.txt`);

const made = [];
fs.mkdtempSync = function (...args) {
  const dir = mkdtempSync.apply(this, args);
  made.push(dir);
  return dir;
};
const mkdtemp = fs.promises.mkdtemp;
fs.promises.mkdtemp = async function (...args) {
  const dir = await mkdtemp.apply(this, args);
  made.push(dir);
  return dir;
};
syncBuiltinESMExports();

process.on('exit', () => {
  try {
    if (made.length) fs.appendFileSync(list, made.map((d) => `${d}\n`).join(''));
    if (!runner) return;
    const run = process.env.NAC_TEST_RUN;
    const dirs = fs.readdirSync(run).flatMap((f) => fs.readFileSync(path.join(run, f), 'utf8').split('\n').filter(Boolean));
    for (const dir of dirs) {
      const parent = path.dirname(dir);
      const base = path.basename(dir);
      let siblings = [];
      try { siblings = fs.readdirSync(parent).filter((n) => n.startsWith(`${base}-wt`)); } catch { /* parent is gone */ }
      for (const d of [dir, ...siblings.map((n) => path.join(parent, n))]) {
        try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a locked file must not fail the run */ }
      }
    }
    fs.rmSync(run, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* cleanup must not fail the run */ }
});
