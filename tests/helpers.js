// Test helpers shared by several test files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeProject(prefix = 'nac project ') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'team', 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'team', 'config.json'), '{}');
  return root;
}
