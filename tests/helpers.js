// Test helpers shared by several test files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Tests never write into the real ~/.claude/nac/metrics.md (cost.js saves a line there).
process.env.NAC_METRICS_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), 'nac metrics home '));
// The gate's wait for other runs of its check programs (g31) is off: parallel test files run the same commands.
process.env.NAC_GATE_WAIT_SECONDS ??= '0';

// Deterministic git for the whole suite (F7): fixed identity, fixed dates and no background maintenance, for the
// test processes and for every git child they start. Commits made through makeGitProject get strictly increasing
// explicit dates, so nothing depends on the wall clock, on the load of the machine or on two commits in one second.
const BASE_TIME = Date.UTC(2026, 0, 1);
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'gc.auto', GIT_CONFIG_VALUE_0: '0',
  GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false',
  GIT_CONFIG_KEY_2: 'core.fsmonitor', GIT_CONFIG_VALUE_2: 'false',
});

export function makeProject(prefix = 'nac project ') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'team', 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  return root;
}

// A NAC project that is also a git repository. commit(name) makes a commit and returns its short hash.
export function makeGitProject() {
  const root = makeProject();
  let tick = 0;
  const git = (...a) => {
    const date = new Date(BASE_TIME + (++tick) * 1000).toISOString();
    return execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'gc.auto', '0');
  git('config', 'maintenance.auto', 'false');
  const commit = (name) => {
    fs.writeFileSync(path.join(root, name), name);
    git('add', name);
    git('commit', '-q', '-m', name);
    return git('log', '-1', '--format=%h');
  };
  return { root, git, commit };
}
