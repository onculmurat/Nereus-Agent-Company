// Test helpers shared by several test files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Tests never write into the real ~/.claude/nac/metrics.md (cost.js saves a line there).
process.env.NAC_METRICS_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), 'nac metrics home '));

export function makeProject(prefix = 'nac project ') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'team', 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  return root;
}

// A NAC project that is also a git repository. commit(name) makes a commit and returns its short hash.
export function makeGitProject() {
  const root = makeProject();
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  const commit = (name) => {
    fs.writeFileSync(path.join(root, name), name);
    git('add', name);
    git('commit', '-q', '-m', name);
    return git('log', '-1', '--format=%h');
  };
  return { root, git, commit };
}
