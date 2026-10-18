// Mechanical guard for the phase 1 research roles. They read untrusted web pages and cloned code, so
// a prompt injection must find nothing to steal and no way to act: reads stay in team/ and the clone
// folder, writes stay in team/research/ and hand-offs, and Bash runs only NAC's own scripts, with
// fixed arguments.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const RESEARCH_ROLES = { researcher: ['mailbox.js', 'clone.js'], 'finance-analyst': ['mailbox.js'] };
const OPEN_TOOLS = new Set(['WebFetch', 'WebSearch', 'SendMessage']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

export function researchTmpRoot() {
  return path.join(os.tmpdir(), 'nac-research');
}

// The clone root must be a real folder of ours: on a shared /tmp another user could plant a link
// there and turn the allowed read root into any folder.
export function tmpRootProblem(dir) {
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) return 'the clone root is a link';
  if (!st.isDirectory()) return 'the clone root is not a folder';
  if (typeof process.getuid === 'function') {
    if (st.uid !== process.getuid()) return 'the clone root belongs to another user';
    if (st.mode & 0o022) return 'the clone root is writable by others';
  }
  return null;
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

// Arguments are fixed per script: the mailbox only lists the caller's own inbox (messages go out
// through SendMessage), and clone takes exactly one URL, which clone.js validates.
function argsProblem(name, args, role) {
  if (name === 'mailbox.js') {
    const ok = args.length >= 3 && args.length <= 4 && args[0] === 'inbox' && args[1] === '--role' && args[2] === role
      && (args.length === 3 || args[3] === '--mark-read');
    return ok ? null : `the mailbox script may only run: inbox --role ${role} [--mark-read].`;
  }
  return args.length === 1 ? null : 'the clone script takes exactly one URL.';
}

function checkBash(command, role, pluginRoot) {
  const allowed = RESEARCH_ROLES[role];
  if (typeof command !== 'string') return 'Bash needs a command.';
  const m = /^node "([^"]+)"((?: [A-Za-z0-9._:/=@+-]+)*)$/.exec(command.trim());
  const script = m && m[1].replace(/^\$\{CLAUDE_PLUGIN_ROOT\}/, pluginRoot);
  if (!m || /[$`]/.test(script)) return `Bash may run only: node "\${CLAUDE_PLUGIN_ROOT}/scripts/<${allowed.join('|')}>" <args>.`;
  const name = allowed.find((n) => path.relative(path.join(pluginRoot, 'scripts', n), path.resolve(script)) === '');
  if (!name) return `Bash may run only NAC's ${allowed.join(' and ')} scripts.`;
  return argsProblem(name, m[2].split(' ').filter(Boolean), role);
}

// Returns null when the call is allowed, otherwise the reason it is blocked.
export function checkResearchTool({ role, toolName, toolInput, root, pluginRoot, tmpRoot = researchTmpRoot() }) {
  if (!root) return 'research roles work only inside a NAC project.';
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const team = path.join(root, 'team');
  const cloneRoot = tmpRootProblem(tmpRoot) ? null : tmpRoot;
  if (OPEN_TOOLS.has(toolName)) return null;
  if (toolName === 'Bash') return checkBash(input.command, role, pluginRoot);
  if (READ_TOOLS.has(toolName)) {
    const target = toolName === 'Read' ? input.file_path : input.path;
    if (typeof target !== 'string' || !target) return `${toolName} needs an explicit path inside team/ or the clone folder.`;
    if (toolName === 'Glob' && unsafePattern(input.pattern)) return 'Glob patterns must be relative and must not contain "..".';
    if (toolName === 'Grep' && input.glob !== undefined && unsafePattern(input.glob)) return 'Grep globs must be relative and must not contain "..".';
    const p = path.resolve(root, target);
    return inside(p, team) || (cloneRoot && inside(p, cloneRoot)) ? null : 'Reads are limited to team/ and the clone folder.';
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

// Only plain public https repository URLs: a DNS name ending in a letters-only label, no credentials,
// no IP literals in any notation, nothing git reads as an option. clone.js also checks the resolved
// addresses with isPrivateAddress.
export function cloneTarget(url, base, now = Date.now()) {
  const m = typeof url === 'string' && /^https:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,63})\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)$/.exec(url);
  if (!m || url.includes('..') || /^localhost$/i.test(m[1])) {
    throw new Error('Only a plain https repository URL can be cloned.');
  }
  const slug = `${m[1]}-${m[2].replace(/\.git$/, '').replaceAll('/', '-')}`;
  return path.join(base, `${slug}-${now}`);
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

export function cloneArgs(url, dir) {
  return [
    '-c', 'core.symlinks=false', '-c', `core.hooksPath=${os.devnull}`, '-c', 'core.fsmonitor=false',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false',
    '-c', 'credential.helper=',
    'clone', '--template=', '--depth', '1', '--no-recurse-submodules', '--no-tags', '--', url, dir,
  ];
}

// The user's and the system's git config (credential helpers, url.insteadOf, filters) must not apply.
export function cloneEnv(base = process.env) {
  return { ...base, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devnull };
}
