// Runs a hook script with a JSON payload on stdin, like Claude Code does.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function runHook(name, stdin, { root = pluginRoot } = {}) {
  const r = spawnSync(process.execPath, [path.join(root, 'hooks', `${name}.js`)], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export async function fixture(name, patch = {}) {
  const { default: data } = await import(`../fixtures/hooks/${name}.json`, { with: { type: 'json' } });
  return { ...structuredClone(data), ...patch };
}
