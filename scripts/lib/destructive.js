// Destructive-command guard: finds recursive deletes in a Bash or PowerShell command and blocks the ones whose target
// could be outside the project and the OS temp folder. It reads the command text only; it cannot see what a script
// or a program the agent runs does inside. The rule: a recursive delete (rm -r, Remove-Item -Recurse, rmdir /s,
// rd /s, del /s, rimraf, find -delete) is allowed only on paths inside the project root or the temp folder.
// A target it cannot resolve (variable, command substitution, glob that can match "..") is blocked, not guessed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_DEPTH = 4;
const MAX_BRACE = 64;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh']);
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', 'time', 'nohup', 'nice', 'exec', 'env', 'call', 'start', 'npx', 'pnpx', 'bunx']);
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', 'foreach-object', '%']);
const CD = new Set(['cd', 'chdir', 'pushd', 'popd', 'set-location', 'sl', 'push-location', 'pop-location']);
const DELETE = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri', 'rimraf']);
const CMD_STYLE = new Set(['rmdir', 'rd', 'del', 'erase']);
const PS_PARAMS = ['force', 'confirm', 'whatif', 'path', 'literalpath', 'include', 'exclude', 'filter', 'credential', 'stream',
  'erroraction', 'warningaction', 'verbose', 'debug', 'recurse'];
const PS_VALUE_PARAMS = ['include', 'exclude', 'filter', 'credential', 'stream', 'erroraction', 'warningaction'];
const PS_RECURSE = /^-r(?:e(?:c(?:u(?:r(?:se?)?)?)?)?)?(?::(.*))?$/i;
const SWITCHES = /^(?:\/[a-zA-Z?])+$/;
const ENV_TMP = ['TMPDIR', 'TEMP', 'TMP'];

// A PowerShell parameter may be shortened to any unambiguous prefix; one letter is too short to tell from rm -f.
const isPrefixOf = (t, names, min = 1) => {
  const w = t.replace(/^-+/, '').replace(/:.*$/, '').toLowerCase();
  return w.length >= min && names.some((n) => n.startsWith(w));
};

// ---- text handling ---------------------------------------------------------------------------------------------

// Heredoc and here-string bodies are data, not commands.
function stripBodies(text, style) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let end = null;
  for (const line of lines) {
    if (end) {
      if (style === 'ps' ? line.startsWith(end) : line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    if (style === 'ps') {
      const h = /@(['"])\s*$/.exec(line);
      if (h) end = `${h[1]}@`;
    } else {
      const h = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line);
      if (h && !/<<</.test(line)) end = h[2];
    }
  }
  return out.join('\n');
}

// Text of $( ... ) substitutions and, for Bash, `...` substitutions, so they are checked as commands too.
function substitutions(text, style) {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && text[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      for (; j < text.length && depth > 0; j += 1) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') depth -= 1;
      }
      found.push(text.slice(i + 2, depth === 0 ? j - 1 : j));
    }
  }
  if (style !== 'ps') for (const m of text.matchAll(/`([^`]*)`/g)) found.push(m[1]);
  return found;
}

// Splits into commands and tokens. A token is { text, quoted }. A command is { tokens, pipe } (pipe: the previous
// separator was "|"). Quotes group; separators inside quotes do not split.
function parse(text, style) {
  const commands = [];
  let tokens = [];
  let cur = '';
  let has = false;
  let quoted = false;
  let quote = null;
  let pipe = false;
  const endToken = () => {
    if (has) tokens.push({ text: cur, quoted });
    cur = '';
    has = false;
    quoted = false;
  };
  const endCommand = (nextPipe = false) => {
    endToken();
    if (tokens.length) commands.push({ tokens, pipe });
    tokens = [];
    pipe = nextPipe;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && style !== 'ps' && (text[i + 1] === '"' || text[i + 1] === '\\')) { cur += text[i + 1]; i += 1; }
      else if (c === '`' && quote === '"' && style === 'ps' && i + 1 < text.length) { cur += text[i + 1]; i += 1; }
      else if (c === "'" && quote === "'" && style === 'ps' && text[i + 1] === "'") { cur += "'"; i += 1; }
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; quoted = true; continue; }
    if (c === '`' && style === 'ps' && i + 1 < text.length) { cur += text[i + 1]; has = true; i += 1; continue; }
    if (c === '\\' && style !== 'ps' && (text[i + 1] === ' ' || text[i + 1] === '"' || text[i + 1] === "'")) { cur += text[i + 1]; has = true; i += 1; continue; }
    if (c === '$' && text[i + 1] === '(') {
      // Keep a whole $( ... ) inside the token; its content is analysed separately.
      let depth = 0;
      let j = i;
      for (; j < text.length; j += 1) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')' && --depth === 0) break;
      }
      cur += text.slice(i, j + 1);
      has = true;
      i = j;
      continue;
    }
    if (c === ';' || c === '\n' || c === '\r') { endCommand(); continue; }
    if (c === '|') { endCommand(true); if (text[i + 1] === '|') { i += 1; pipe = false; } continue; }
    if (c === '&') {
      if (text[i - 1] === '>' || text[i + 1] === '>') { cur += c; has = true; continue; }
      if (text[i + 1] === '&') i += 1;
      endCommand();
      continue;
    }
    if ((c === '(' || c === ')') && !has && style !== 'ps') { endCommand(); continue; }
    if ((c === '{' || c === '}') && !has && (i + 1 >= text.length || /[\s;]/.test(text[i + 1]))) { endCommand(); continue; }
    if (c === ')' && has && style !== 'ps') { endCommand(); continue; }
    if (/\s/.test(c)) { endToken(); continue; }
    cur += c;
    has = true;
  }
  const open = quote !== null;
  endCommand();
  commands.unterminated = open;
  return commands;
}

// {a,b} expansion (one list at a time, nested lists included); {} stays as it is.
function expandBraces(s) {
  const m = /^(.*?)\{([^{}]*)\}(.*)$/s.exec(s);
  if (!m || !m[2].includes(',')) return [s];
  const out = [];
  for (const alt of m[2].split(',')) {
    for (const e of expandBraces(m[1] + alt + m[3])) {
      out.push(e);
      if (out.length > MAX_BRACE) return [s];
    }
  }
  return out;
}

// ---- paths -----------------------------------------------------------------------------------------------------

function makeEnv(opts) {
  const platform = opts.platform ?? process.platform;
  const P = platform === 'win32' ? path.win32 : path.posix;
  const real = platform === process.platform && opts.canonicalize !== false;
  const canon = (p) => {
    if (!real) return p;
    let head = p;
    const rest = [];
    while (!fs.existsSync(head)) {
      const parent = P.dirname(head);
      if (parent === head) return p;
      rest.unshift(P.basename(head));
      head = parent;
    }
    try {
      return P.join(fs.realpathSync.native(head), ...rest);
    } catch {
      return p;
    }
  };
  const root = canon(P.resolve(opts.root));
  const tmpDirs = (opts.tmpDirs ?? [os.tmpdir(), ...(platform === 'win32' ? [] : ['/tmp', '/var/tmp'])]).map((d) => canon(P.resolve(d)));
  const home = canon(P.resolve(opts.home ?? os.homedir()));
  return { platform, P, canon, root, tmpDirs, home, tmpPrimary: tmpDirs[0] };
}

const within = (P, base, target) => {
  const rel = P.relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${P.sep}`) && !P.isAbsolute(rel));
};
const same = (P, a, b) => P.relative(a, b) === '';
const isFsRoot = (P, abs) => same(P, P.parse(abs).root, abs);

// Known variables are replaced; anything else with $, %x% or a substitution is ambiguous (returns null).
function expandVars(raw, env, cwd) {
  const { home, tmpPrimary, root } = env;
  const subs = [];
  for (const n of ENV_TMP) subs.push([new RegExp(`^(?:\\$${n}|\\$\\{${n}\\}|\\$env:${n}|%${n}%)(?=[\\\\/]|$)`, 'i'), tmpPrimary]);
  for (const n of ['HOME', 'USERPROFILE']) subs.push([new RegExp(`^(?:\\$${n}|\\$\\{${n}\\}|\\$env:${n}|%${n}%)(?=[\\\\/]|$)`, 'i'), home]);
  subs.push([/^(?:\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\}|\$env:CLAUDE_PROJECT_DIR|%CLAUDE_PROJECT_DIR%)(?=[\\/]|$)/i, root]);
  if (cwd) subs.push([/^(?:\$PWD|\$\{PWD\})(?=[\\/]|$)/, cwd]);
  let out = raw;
  for (const [re, value] of subs) out = out.replace(re, () => value);
  if (/[$`]|%[A-Za-z_][A-Za-z0-9_]*%/.test(out)) return null;
  return out;
}

// Returns { abs, glob } or { problem }.
function resolveTarget(raw, ctx) {
  const { env } = ctx;
  const { P, platform } = env;
  if (raw === '') return { problem: 'an empty path' };
  let text = expandVars(raw, env, ctx.cwd);
  if (text === null) return { problem: `${raw} contains a variable or command substitution that cannot be resolved` };
  if (/^~[^\\/]/.test(text)) return { problem: `${raw} is another user's home directory` };
  if (text === '~' || /^~[\\/]/.test(text)) text = P.join(env.home, text.slice(1));
  if (/^[A-Za-z]:$/.test(text)) return { problem: `${raw} is a bare drive letter (the current directory of that drive)`, root: true };
  if (/^[A-Za-z]:[^\\/]/.test(text)) return { problem: `${raw} is a drive-relative path` };
  if (platform === 'win32') {
    const drive = /^\/(?:cygdrive\/)?([A-Za-z])(?:\/(.*))?$/.exec(text);
    if (drive) text = `${drive[1].toUpperCase()}:\\${drive[2] ?? ''}`;
    else if (/^\/tmp(?:\/|$)/.test(text)) text = P.join(env.tmpPrimary, text.slice(4));
  }
  if (/[()]/.test(text)) return { problem: `${raw} is an expression that cannot be resolved` };
  // Alternating components and separators; a pattern component can match ".." only when it starts with "." or "[".
  const pieces = text.split(/([\\/]+)/);
  const parts = pieces.filter((_, i) => i % 2 === 0);
  const globAt = parts.findIndex((p) => /[*?[]/.test(p));
  const asRegex = (g) => new RegExp(`^${g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  for (const p of parts) {
    if (/[*?[]/.test(p) && /^[.[]/.test(p) && asRegex(p.replace(/\[[^\]]*\]/g, '?')).test('..')) return { problem: `${raw} has a pattern that can match ".." (the parent folder)` };
  }
  if (globAt >= 0) {
    if (parts.slice(globAt + 1).includes('..')) return { problem: `${raw} has ".." after a pattern` };
    const dirText = pieces.slice(0, globAt * 2).join('');
    const base = env.canon(P.resolve(ctx.cwd ?? '', dirText === '' ? '.' : dirText));
    return { abs: base, glob: true };
  }
  return { abs: env.canon(P.resolve(ctx.cwd ?? '', text)), glob: false };
}

// Why this target must not be deleted recursively, or null when it may be.
// A glob target deletes the children of its folder, so the project root or the temp folder may be that folder.
// With allowRoots (the start folder of a find) the roots themselves are fine too.
function targetProblem(raw, ctx, { allowRoots = false } = {}) {
  const { env } = ctx;
  const { P } = env;
  if (ctx.cwd === null && !P.isAbsolute(raw) && !/^(?:~|\$|%|\/|\\)/.test(raw)) return `${raw} is relative to a directory the guard could not follow`;
  const r = resolveTarget(raw, ctx);
  if (r.problem) return r.problem;
  const { abs, glob } = r;
  if (isFsRoot(P, abs)) return `${raw} is a drive or filesystem root (${abs})`;
  if (same(P, abs, env.home)) return `${raw} is the home directory (${abs})`;
  const inProject = within(P, env.root, abs);
  const inTmp = env.tmpDirs.some((t) => within(P, t, abs));
  if (!inProject && !inTmp) return `${abs} is outside the project and the temp folder`;
  if (!glob && !allowRoots && (same(P, abs, env.root) || env.tmpDirs.some((t) => same(P, t, abs)))) return `${abs} is the project root or the temp folder itself`;
  return null;
}

// ---- commands --------------------------------------------------------------------------------------------------

function parseDelete(name, args) {
  let recursive = name === "rimraf";
  const targets = [];
  let afterDashes = false;
  const cmdStyle = CMD_STYLE.has(name);
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i].text;
    if (!afterDashes && t === '--' && !cmdStyle) { afterDashes = true; continue; }
    if (!afterDashes && cmdStyle && SWITCHES.test(t)) {
      if (/\/[sS]/.test(t)) recursive = true;
      continue;
    }
    if (!afterDashes && t.startsWith('-') && t.length > 1) {
      if (t === '--recursive') { recursive = true; continue; }
      const ps = PS_RECURSE.exec(t);
      if (ps) {
        if (!/^(?:\$false|false|0)$/i.test(ps[1] ?? '')) recursive = true;
        continue;
      }
      if (/^-[a-zA-Z]+$/.test(t) && !isPrefixOf(t, PS_PARAMS) && /[rR]/.test(t) && (name === 'rm' || name === 'rimraf')) { recursive = true; continue; }
      if (isPrefixOf(t, PS_VALUE_PARAMS, 2)) { if (!t.includes(':')) i += 1; continue; }
      const colon = /^-(?:path|literalpath|lp|pspath):(.+)$/i.exec(t);
      if (colon) targets.push(...(name === 'remove-item' || name === 'ri' ? colon[1].split(',') : [colon[1]]));
      continue;
    }
    if ((name === 'remove-item' || name === 'ri') && !args[i].quoted) targets.push(...t.split(',').filter(Boolean));
    else targets.push(t);
  }
  return { recursive, targets };
}

const verbOf = (token) => token.text.replace(/^\\/, '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');

function shellString(name, args) {
  if (name === 'cmd') {
    const i = args.findIndex((a) => /^\/[ck]$/i.test(a.text));
    return i < 0 ? null : args.slice(i + 1).map((a) => (a.quoted && /\s/.test(a.text) ? `"${a.text}"` : a.text)).join(' ');
  }
  if (name === 'powershell' || name === 'pwsh') {
    const i = args.findIndex((a) => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(a.text));
    return i < 0 ? null : args.slice(i + 1).map((a) => a.text).join(' ');
  }
  const i = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a.text));
  return i < 0 ? null : (args[i + 1]?.text ?? null);
}

function analyzeText(text, style, ctx, depth) {
  if (depth > MAX_DEPTH) return 'it is nested too deeply to check';
  const body = stripBodies(text, style);
  for (const inner of substitutions(body, style)) {
    const r = analyzeText(inner, style, { ...ctx }, depth + 1);
    if (r) return r;
  }
  const commands = parse(body, style);
  if (commands.unterminated && mentionsDelete(body)) return 'the command has an unbalanced quote, so it cannot be checked';
  for (const command of commands) {
    const r = analyzeCommand(command, style, ctx, depth);
    if (r) return r;
  }
  return null;
}

function analyzeCommand(command, style, ctx, depth) {
  let tokens = command.tokens;
  if (style === 'ps' && tokens[0].text.startsWith('(')) tokens = [{ ...tokens[0], text: tokens[0].text.replace(/^\(+/, '') }, ...tokens.slice(1)].filter((t) => t.text !== '');
  let viaXargs = false;
  for (;;) {
    if (!tokens.length) return null;
    const t = tokens[0].text;
    const v = verbOf(tokens[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || KEYWORDS.has(v)) { tokens = tokens.slice(1); continue; }
    if (v === 'xargs') {
      viaXargs = true;
      tokens = tokens.slice(1);
      while (tokens.length && tokens[0].text.startsWith('-')) tokens = tokens.slice(/^-[IEJLnPsdaR]$/.test(tokens[0].text) ? 2 : 1);
      continue;
    }
    if (WRAPPERS.has(v)) {
      tokens = tokens.slice(1);
      while (tokens.length && (tokens[0].text.startsWith('-') || /^[A-Za-z_]\w*=/.test(tokens[0].text))) {
        const skip = v === 'sudo' && /^-[ughpCDRTU]$/.test(tokens[0].text) ? 2 : 1;
        tokens = tokens.slice(skip);
      }
      continue;
    }
    break;
  }
  const name = verbOf(tokens[0]);
  const args = tokens.slice(1);

  if (CD.has(name)) {
    const target = args.find((a) => !a.text.startsWith('-') && !/^\/[dD]$/.test(a.text));
    if (name === 'popd' || name === 'pop-location' || target?.text === '-') ctx.cwd = null;
    else if (!target) ctx.cwd = ctx.env.home;
    else {
      const r = resolveTarget(target.text, ctx);
      ctx.cwd = r.problem || r.glob ? null : r.abs;
    }
    return null;
  }

  if (SHELLS.has(name)) {
    const inner = shellString(name, args);
    if (inner !== null) return analyzeText(inner, name === 'powershell' || name === 'pwsh' ? 'ps' : name === 'cmd' ? 'cmd' : 'sh', { ...ctx }, depth + 1);
    return null;
  }
  if (name === 'eval' && args[0]) return analyzeText(args.map((a) => a.text).join(' '), style, { ...ctx }, depth + 1);

  if (name === 'find' || name === 'gfind') return analyzeFind(args, ctx);
  if (!DELETE.has(name)) return null;

  const { recursive, targets } = parseDelete(name, args);
  if (!recursive) return null;
  if (!targets.length && (viaXargs || command.pipe)) return 'its targets come from another command and cannot be checked';
  if (viaXargs) return 'its targets come from another command and cannot be checked';
  for (const raw of targets.flatMap(expandBraces)) {
    const problem = targetProblem(raw, ctx);
    if (problem) return problem;
  }
  return null;
}

function analyzeFind(args, ctx) {
  const texts = args.map((a) => a.text);
  const startAt = texts.findIndex((t) => !/^-[HLPD]$/.test(t));
  const starts = [];
  for (let i = Math.max(startAt, 0); i < texts.length; i += 1) {
    if (texts[i].startsWith('-') || texts[i] === '(' || texts[i] === '!') break;
    starts.push(texts[i]);
  }
  const execAt = texts.findIndex((t) => ['-exec', '-execdir', '-ok', '-okdir'].includes(t));
  let destructive = texts.includes('-delete');
  if (execAt >= 0 && texts[execAt + 1]) {
    const verb = verbOf(args[execAt + 1]);
    destructive = destructive || (DELETE.has(verb) && parseDelete(verb, args.slice(execAt + 2)).recursive);
  }
  if (!destructive) return null;
  for (const raw of (starts.length ? starts : ['.']).flatMap(expandBraces)) {
    const problem = targetProblem(raw, ctx, { allowRoots: true });
    if (problem) return problem;
  }
  return null;
}

// Public: the reason a command must be blocked, or null. Never throws for odd input.
export function checkDestructive(command, opts) {
  const style = opts.toolName === 'PowerShell' ? 'ps' : 'sh';
  const env = makeEnv(opts);
  const cwd = env.canon(env.P.resolve(opts.cwd ?? opts.root));
  const reason = analyzeText(String(command), style, { env, cwd }, 0);
  if (!reason) return null;
  const shown = String(command).replace(/\s+/g, ' ').trim().slice(0, 160);
  return `NAC destructive-command guard: blocked a recursive delete (${shown}): ${reason}. Recursive deletes are allowed only inside the project (${env.root}) and the temp folder. Do not retry in another form. If this delete is really needed, stop and ask the lead, who asks the owner.`;
}

// Used when the check itself failed: block only commands that mention a delete verb at all.
export const mentionsDelete = (command) => /(?:^|[^\w-])(?:rm|rmdir|rd|del|erase|remove-item|ri|rimraf|find)(?![\w-])/i.test(String(command));
