// Test gate: runs the project's test command between implement and review, so failing code never reaches a reviewer.
import { spawnSync } from 'node:child_process';

const TAIL_LINES = 60;

export function runTestGate(root, command) {
  const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, exitCode: null, output: r.error.message };
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd().split('\n');
  return { ok: r.status === 0, exitCode: r.status, output: lines.slice(-TAIL_LINES).join('\n') };
}
