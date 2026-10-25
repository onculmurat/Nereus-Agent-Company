// Destructive-command guard: finds recursive deletes in a Bash or PowerShell command and blocks the ones whose target
// could be outside the project and the OS temp folder. It reads the command text only; it cannot see what a script
// or a program the agent runs does inside. The rule: a recursive delete (rm -r, Remove-Item -Recurse, rmdir /s,
// rd /s, del /s, rimraf, find -delete) is allowed only on paths inside the project root or the temp folder (or a deleteRoots folder from the config, g62).
// A target it cannot resolve (variable, command substitution, glob that can match "..") is blocked, not guessed.
// Also covered: git clean -x/-X, deletes written as inline code (node -e, python -c, perl -e, ruby -e), PowerShell
// -EncodedCommand (decoded first), and script files run by name (bash x.sh, node x.js, ./x.sh, pwsh x.ps1) that sit
// inside the project or the temp folder. Limits: a script is read only when it exists, is under 64 KiB and is not
// part of the plugin itself; a missing or larger script is allowed, so normal work is not blocked. Code is scanned
// for delete calls with plain string targets; os.remove/os.unlink loops and targets built at run time are out of scope.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const SCRIPT_MAX = 64 * 1024;
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT_EXT = /\.(?:sh|bash|ps1|py|js|mjs|cjs)$/i;
const CODE_DELETE_CALL = /\b(?:rmSync|rmdirSync|rmtree|remove_tree|rm_rf|rm_r|rm)\s*\(\s*/g;
const CODE_SHELL_CALL = /\b(?:system|exec|execSync|execFile|execFileSync|spawn|spawnSync|popen|run|call|check_call|check_output|Popen)\s*\(\s*/g;

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
  // g62: deleteRoots from the config (the owner's own scratch and build folders) count like the temp folder
  const tmpDirs = [...(opts.tmpDirs ?? [os.tmpdir(), ...(platform === 'win32' ? [] : ['/tmp', '/var/tmp'])]), ...(opts.deleteRoots ?? [])].map((d) => canon(P.resolve(d)));
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
  if (!inProject && !inTmp) return `${abs} is outside the project and the temp folder${env.tmpDirs.length > 1 ? 's' : ''}`;
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

// Variables assigned a literal value earlier in the same command line (VAR=x, export VAR=x, $Var = "x").
// A literal has no $, backtick or parenthesis, so nothing is guessed; any other variable stays unresolved (blocked).
const LITERAL = /^[^$`()]*$/;
function noteAssignments(command, style, vars) {
  let tokens = command.tokens;
  if (style !== 'ps' && tokens[0]?.text === 'export') tokens = tokens.slice(1);
  const texts = tokens.map((t) => t.text);
  let name;
  let value;
  if (style === 'ps') {
    const m = /^\$([A-Za-z_]\w*)(?:=(.*))?$/.exec(texts[0] ?? '');
    if (m && m[2] !== undefined) [name, value] = [m[1], m[2]];
    else if (m && texts[1] === '=' && texts.length === 3) [name, value] = [m[1], texts[2]];
    else if (m && texts[1]?.startsWith('=') && texts.length === 2) [name, value] = [m[1], texts[1].slice(1)];
  } else if (tokens.length && tokens.every((t) => /^[A-Za-z_]\w*=/.test(t.text))) {
    for (const t of tokens) {
      const i = t.text.indexOf('=');
      setVar(vars, t.text.slice(0, i), t.text.slice(i + 1), style);
    }
    return null;
  }
  if (name !== undefined) {
    setVar(vars, name, value, style);
    return null;
  }
  if (!vars.size) return command;
  return { ...command, tokens: command.tokens.map((t) => ({ ...t, text: substitute(t.text, vars, style) })) };
}

function setVar(vars, name, value, style) {
  const key = style === 'ps' ? name.toLowerCase() : name;
  if (LITERAL.test(value)) vars.set(key, value);
  else vars.delete(key);
}

function substitute(text, vars, style) {
  return text.replace(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g, (whole, a, b) => {
    const key = style === 'ps' ? (a ?? b).toLowerCase() : (a ?? b);
    return vars.has(key) ? vars.get(key) : whole;
  });
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
  const vars = ctx.vars ?? (ctx.vars = new Map());
  for (const raw of commands) {
    const command = noteAssignments(raw, style, vars);
    if (!command) continue;
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
    if (name === 'powershell' || name === 'pwsh') {
      const encoded = encodedText(args);
      if (encoded) return encoded.problem ?? analyzeText(encoded.text, 'ps', { ...ctx }, depth + 1);
    }
    const inner = shellString(name, args);
    if (inner !== null) return analyzeText(inner, name === 'powershell' || name === 'pwsh' ? 'ps' : name === 'cmd' ? 'cmd' : 'sh', { ...ctx }, depth + 1);
    return scanScript(name, tokens, ctx, depth);
  }
  if (name === 'eval' && args[0]) return analyzeText(args.map((a) => a.text).join(' '), style, { ...ctx }, depth + 1);

  if (name === 'find' || name === 'gfind') return analyzeFind(args, ctx);
  if (name === 'git') return analyzeGit(args);
  const code = inlineCode(name, args);
  if (code !== null) return scanCode(code, ctx, depth + 1);
  if (!DELETE.has(name)) return scanScript(name, tokens, ctx, depth);

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

// git clean with -x/-X (ignored files too) and -f/-d, in any order of combined or split flags; -n/--dry-run is fine.
function analyzeGit(args) {
  const at = args.findIndex((a) => a.text === 'clean');
  if (at < 0) return null;
  const flags = args.slice(at + 1).map((a) => a.text);
  const letters = flags.filter((f) => /^-[^-]/.test(f)).join('').replace(/-/g, '');
  if (letters.includes('n') || flags.includes('--dry-run')) return null;
  if (/[xX]/.test(letters) && (/[fd]/.test(letters) || flags.includes('--force'))) {
    return 'git clean -x/-X also removes ignored files (build output, .env, local settings) and cannot be undone';
  }
  return null;
}

// PowerShell -EncodedCommand (any prefix of it, or -ec): { text } decoded from base64 UTF-16LE, or { problem }.
function encodedText(args) {
  const i = args.findIndex((a) => /^-[A-Za-z]+$/.test(a.text) && (a.text.slice(1).toLowerCase() === 'ec' || 'encodedcommand'.startsWith(a.text.slice(1).toLowerCase())));
  if (i < 0) return null;
  const b64 = args[i + 1]?.text ?? '';
  const buf = /^[A-Za-z0-9+/]+={0,2}$/.test(b64) && b64.length % 4 === 0 ? Buffer.from(b64, 'base64') : null;
  const text = buf && buf.length && buf.length % 2 === 0 ? buf.toString('utf16le') : null;
  if (text === null || /[\u0000-\u0008\u000e-\u001f�]/.test(text)) return { problem: 'its -EncodedCommand text cannot be decoded, so it cannot be checked' };
  return { text };
}

// The code string of node -e, python -c, perl -e or ruby -e, or null.
function inlineCode(name, args) {
  let flag;
  if (/^node(?:js)?$/.test(name)) flag = /^(?:-e|-p|-pe|-ep|--eval|--print)$/;
  else if (/^(?:python[\d.]*|py)$/.test(name)) flag = /^-[a-zA-Z]*c$/;
  else if (name === 'perl') flag = /^-[a-zA-Z]*[eE]$/;
  else if (name === 'ruby') flag = /^-[a-zA-Z]*e$/;
  else return null;
  const long = args.find((a) => /^--(?:eval|print)=/.test(a.text));
  if (long) return long.text.slice(long.text.indexOf('=') + 1);
  const i = args.findIndex((a) => flag.test(a.text));
  return i < 0 ? null : (args[i + 1]?.text ?? null);
}

// A string literal starting at code[at] (optional r/u/b prefix): { value, end } or null.
function literalAt(code, at) {
  const m = /^[rRuUbB]{0,2}(["'`])/.exec(code.slice(at, at + 3));
  if (!m) return null;
  const q = m[1];
  let value = '';
  let i = at + m[0].length;
  for (; i < code.length && code[i] !== q; i += 1) {
    if (code[i] === '\\' && i + 1 < code.length) i += 1;
    value += code[i];
  }
  return i >= code.length ? null : { value, end: i + 1 };
}

// The literal arguments of a call ('a', "b", ['c', 'd']) joined as one command line; null when there is none.
function literalArgs(code, at) {
  const words = [];
  let i = at;
  for (;;) {
    const list = code[i] === '[';
    if (list) i += 1;
    for (;;) {
      const lit = literalAt(code, i);
      if (!lit) break;
      words.push(lit.value);
      i = lit.end;
      const comma = /^\s*,\s*/.exec(code.slice(i));
      if (!comma) break;
      i += comma[0].length;
    }
    if (list && code[i] === ']') i += 1;
    const more = /^\s*,\s*(?=\[)/.exec(code.slice(i));
    if (!more) break;
    i += more[0].length;
  }
  return words.length ? words.join(' ') : null;
}

// Delete calls with a plain string target, and shell command strings handed to system/exec/spawn calls.
function scanCode(code, ctx, depth) {
  for (const m of code.matchAll(CODE_DELETE_CALL)) {
    const at = m.index + m[0].length;
    const lit = /^[fF]/.test(code.slice(at, at + 2)) ? null : literalAt(code, at);
    const after = lit ? code.slice(lit.end).trimStart()[0] : null;
    if (!lit || (after !== ',' && after !== ')')) return `a delete call in the code (${m[0].replace(/\s*\(\s*$/, '')}) has a target that is not a plain string, so it cannot be checked`;
    const problem = targetProblem(lit.value, ctx);
    if (problem) return problem;
  }
  for (const m of code.matchAll(CODE_SHELL_CALL)) {
    const line = literalArgs(code, m.index + m[0].length);
    if (line === null || !mentionsDelete(line)) continue;
    const r = analyzeText(line, 'sh', { ...ctx }, depth + 1) ?? (/remove-item/i.test(line) ? analyzeText(line, 'ps', { ...ctx }, depth + 1) : null);
    if (r) return r;
  }
  return null;
}

// The script file a command runs ({ file, kind }), or null.
function scriptOf(name, tokens) {
  const args = tokens.slice(1);
  const first = (skipValue = []) => {
    for (let i = 0; i < args.length; i += 1) {
      if (skipValue.includes(args[i].text)) { i += 1; continue; }
      if (!args[i].text.startsWith('-')) return args[i].text;
    }
    return null;
  };
  if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(name)) return { file: first(['-o', '+o']), kind: 'sh' };
  if (name === 'powershell' || name === 'pwsh') {
    const f = args.findIndex((a) => /^-f(?:i(?:l(?:e)?)?)?$/i.test(a.text));
    return { file: f >= 0 ? args[f + 1]?.text : first(), kind: 'ps' };
  }
  if (/^node(?:js)?$/.test(name)) return { file: first(['-r', '--require', '--import']), kind: 'code' };
  if (/^(?:python[\d.]*|py|perl|ruby)$/.test(name)) return { file: first(), kind: 'code' };
  const word = tokens[0].text;
  if (SCRIPT_EXT.test(word) && /[\\/]|^\./.test(word)) return { file: word, kind: /\.ps1$/i.test(word) ? 'ps' : /\.(?:sh|bash)$/i.test(word) ? 'sh' : 'code' };
  return null;
}

// The text of a script that sits in the project or the temp folder (not the plugin), when it is small enough.
function readScript(file, ctx) {
  const { env } = ctx;
  const r = resolveTarget(file, ctx);
  if (r.problem || r.glob) return null;
  const inScope = within(env.P, env.root, r.abs) || env.tmpDirs.some((t) => within(env.P, t, r.abs));
  if (!inScope || within(env.P, env.canon(PLUGIN_ROOT), r.abs)) return null;
  try {
    const st = fs.statSync(r.abs);
    return st.isFile() && st.size <= SCRIPT_MAX ? fs.readFileSync(r.abs, 'utf8') : null;
  } catch {
    return null;
  }
}

function scanScript(name, tokens, ctx, depth) {
  const script = scriptOf(name, tokens);
  if (!script?.file) return null;
  const text = readScript(script.file, ctx);
  if (text === null) return null;
  const reason = script.kind === 'code' ? scanCode(text, ctx, depth + 1) : analyzeText(text, script.kind, { ...ctx }, depth + 1);
  return reason ? `${reason} (in the script ${script.file})` : null;
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
  return `NAC destructive-command guard: blocked a recursive delete (${shown}): ${reason}. Recursive deletes are allowed only inside the project (${env.root}), the temp folder${env.tmpDirs.length > 1 ? ` and deleteRoots in team/config.json` : ''}. Do not retry in another form. If this delete is really needed, stop and ask the lead, who asks the owner.`;
}

// Used when the check itself failed: block only commands that mention a delete verb at all.
export const mentionsDelete = (command) => /(?:^|[^\w-])(?:rm|rmdir|rd|del|erase|remove-item|ri|rimraf|find)(?![\w-])/i.test(String(command));
