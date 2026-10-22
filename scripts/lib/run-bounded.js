#!/usr/bin/env node
// Runs one gate check with a deadline: run-bounded.js <seconds> <cwd> <command>. Prints { status, timedOut, output }
// as JSON. Past the deadline it kills the whole process tree, so a test binary started by cargo or npm cannot outlive
// it; 0 seconds means no deadline.
// g54: a hung core test (CPU 0) held T-046's gate for 35 minutes. spawnSync's own timeout kills only the shell and then
// waits for the pipes the hung test still holds, so the check runs here, asynchronously, and the tree is killed.
import { spawn, execFileSync } from 'node:child_process';

const [seconds, cwd, command] = process.argv.slice(2);
const win = process.platform === 'win32';
const child = spawn(command, { cwd, shell: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
let timedOut = false;
child.stdout.on('data', (d) => { output += d; });
child.stderr.on('data', (d) => { output += d; });

function killTree(pid) {
  try {
    if (win) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch {}
}

const limit = Number(seconds);
const timer = limit > 0 ? setTimeout(() => { timedOut = true; killTree(child.pid); }, limit * 1000) : null;
let done = false;
const finish = (status, error) => {
  if (done) return;
  done = true;
  if (timer) clearTimeout(timer);
  process.stdout.write(JSON.stringify({ status: timedOut ? null : status, timedOut, output: error ? `${output}${error.message}` : output }));
};
child.on('error', (error) => finish(null, error));
child.on('close', (status) => finish(status));
