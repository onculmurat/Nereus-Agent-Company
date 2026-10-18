// Mechanical guard for the phase 1 research roles. They read untrusted web pages and cloned code, so
// a prompt injection must find nothing to steal and no way to act: reads stay in team/ and the clone
// folder, writes stay in team/research/ and hand-offs, and Bash runs only NAC's own scripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const RESEARCH_ROLES = { researcher: ['mailbox.js', 'clone.js'], 'finance-analyst': ['mailbox.js'] };
const OPEN_TOOLS = new Set(['WebFetch', 'WebSearch', 'SendMessage']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

export function researchTmpRoot() {
  return path.join(os.tmpdir(), 'nac-research');
}

// `nac:researcher` and `researcher` are the same role; any other agent (or the lead) is not guarded.
export function researchRole(agentType) {
  if (typeof agentType !== 'string') return null;
  const role = agentType.replace(/^.*:/, '');
  return Object.hasOwn(RESEARCH_ROLES, role) ? role : null;
}

// Resolves symlinks of the longest existing prefix, so a link cannot point a check at one place and
// the read at another.
function realPath(p) {
  let head = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(head)) {
    const parent = path.dirname(head);
    if (parent === head) break;
    rest.unshift(path.basename(head));
    head = parent;
  }
  const real = fs.existsSync(head) ? fs.realpathSync.native(head) : head;
  return path.join(real, ...rest);
}

function inside(p, dir) {
  const rel = path.relative(realPath(dir), realPath(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const unsafePattern = (s) => typeof s === 'string' && (s.includes('..') || path.isAbsolute(s) || /^([A-Za-z]:|~)/.test(s));

function checkBash(command, allowed, pluginRoot) {
  if (typeof command !== 'string') return 'Bash needs a command.';
  const m = /^node "([^"]+)"((?: [A-Za-z0-9._:/=@+-]+)*)$/.exec(command.trim());
  const script = m && m[1].replace(/^\$\{CLAUDE_PLUGIN_ROOT\}/, pluginRoot);
  if (!m || /[$`]/.test(script)) return `Bash may run only: node "\${CLAUDE_PLUGIN_ROOT}/scripts/<${allowed.join('|')}>" <args>.`;
  const ok = allowed.some((name) => path.relative(path.join(pluginRoot, 'scripts', name), path.resolve(script)) === '');
  return ok ? null : `Bash may run only NAC's ${allowed.join(' and ')} scripts.`;
}

// Returns null when the call is allowed, otherwise the reason it is blocked.
export function checkResearchTool({ role, toolName, toolInput, root, pluginRoot, tmpRoot = researchTmpRoot() }) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const team = path.join(root, 'team');
  if (OPEN_TOOLS.has(toolName)) return null;
  if (toolName === 'Bash') return checkBash(input.command, RESEARCH_ROLES[role], pluginRoot);
  if (READ_TOOLS.has(toolName)) {
    const target = toolName === 'Read' ? input.file_path : input.path;
    if (typeof target !== 'string' || !target) return `${toolName} needs an explicit path inside team/ or the clone folder.`;
    if (toolName === 'Glob' && unsafePattern(input.pattern)) return 'Glob patterns must be relative and must not contain "..".';
    if (toolName === 'Grep' && input.glob !== undefined && unsafePattern(input.glob)) return 'Grep globs must be relative and must not contain "..".';
    const p = path.resolve(root, target);
    return inside(p, team) || inside(p, tmpRoot) ? null : 'Reads are limited to team/ and the clone folder.';
  }
  if (WRITE_TOOLS.has(toolName)) {
    if (typeof input.file_path !== 'string' || !input.file_path) return `${toolName} needs a file path.`;
    const p = path.resolve(root, input.file_path);
    return inside(p, path.join(team, 'research')) || inside(p, path.join(team, 'work', 'handoffs'))
      ? null
      : 'Writes are limited to team/research/ and team/work/handoffs/.';
  }
  return `${toolName} is not available to research roles.`;
}

// Only plain public https repository URLs: no credentials, no local hosts, nothing git reads as an option.
export function cloneTarget(url, base, now = Date.now()) {
  const m = typeof url === 'string' && /^https:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)$/.exec(url);
  if (!m || url.includes('..') || /^\d+(\.\d+){3}$/.test(m[1]) || /^localhost$/i.test(m[1])) {
    throw new Error('Only a plain https repository URL can be cloned.');
  }
  const slug = `${m[1]}-${m[2].replace(/\.git$/, '').replaceAll('/', '-')}`;
  return path.join(base, `${slug}-${now}`);
}

export function cloneArgs(url, dir) {
  return [
    '-c', 'core.symlinks=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
    'clone', '--depth', '1', '--no-recurse-submodules', '--no-tags', '--', url, dir,
  ];
}
