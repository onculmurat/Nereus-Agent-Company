// Locates the NAC project root and maps the team/ layout.
import fs from 'node:fs';
import path from 'node:path';

export function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'team', 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function teamPaths(root) {
  const team = path.join(path.resolve(root), 'team');
  const work = path.join(team, 'work');
  return {
    team,
    config: path.join(team, 'config.json'),
    brief: path.join(team, 'brief.md'),
    decisions: path.join(team, 'decisions.md'),
    contracts: path.join(team, 'contracts'),
    glossary: path.join(team, 'glossary.md'),
    spec: path.join(team, 'spec.md'),
    threatModel: path.join(team, 'threat-model.md'),
    work,
    tasks: path.join(work, 'tasks'),
    packs: path.join(work, 'packs'),
    board: path.join(work, 'board.md'),
    handoffs: path.join(work, 'handoffs'),
    escalations: path.join(work, 'escalations'),
    mailbox: path.join(work, 'mailbox'),
    archive: path.join(work, 'archive'),
  };
}
