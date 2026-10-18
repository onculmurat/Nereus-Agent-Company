// File-per-message mailbox under team/work/mailbox/<thread>/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { teamPaths } from './paths.js';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

const THREAD_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ROLE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STATES = ['unread', 'read', 'closed'];

export const isValidThread = (id) => typeof id === 'string' && THREAD_RE.test(id);

function stamp(iso) {
  return iso.replace(/[-:]/g, '').replace('.', '');
}

function messageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
}

function readMessage(file) {
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return { path: file, data, body };
}

export function writeMessage(root, { id, from, to, thread = 'general', body, date }) {
  if (!isValidThread(thread)) throw new Error(`Invalid thread id "${thread}" (allowed: ${THREAD_RE})`);
  for (const [k, v] of Object.entries({ from, to })) {
    if (!ROLE_RE.test(v ?? '')) throw new Error(`Invalid ${k} "${v}"`);
  }
  const when = date ? new Date(date).toISOString() : new Date().toISOString();
  const msgId = id ?? crypto.createHash('sha256').update([from, to, thread, body, when.slice(0, 19)].join('|')).digest('hex').slice(0, 16);
  const dir = path.join(teamPaths(root).mailbox, thread);
  for (const file of messageFiles(dir)) {
    if (readMessage(file).data.id === msgId) return { path: file, created: false };
  }
  fs.mkdirSync(dir, { recursive: true });
  const text = stringifyFrontmatter({ id: msgId, from, to, thread, date: when, state: 'unread' }, body.endsWith('\n') ? body : `${body}\n`);
  const base = `${stamp(when)}-${from}-to-${to}`;
  for (let n = 1; ; n++) {
    const file = path.join(dir, n === 1 ? `${base}.md` : `${base}-${n}.md`);
    try {
      fs.writeFileSync(file, text, { flag: 'wx' });
      return { path: file, created: true };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

export function parseHeader(body) {
  const m = /^\[thread:([^\s\]]+)(?:\s+from:([^\s\]]+))?\]\s*/.exec(body);
  if (!m) return { thread: undefined, from: undefined, rest: body };
  return { thread: m[1], from: m[2], rest: body.slice(m[0].length) };
}

export function listInbox(root, role, { state = 'unread' } = {}) {
  const box = teamPaths(root).mailbox;
  if (!fs.existsSync(box)) return [];
  const out = [];
  for (const thread of fs.readdirSync(box)) {
    for (const file of messageFiles(path.join(box, thread))) {
      const msg = readMessage(file);
      if (msg.data.to === role && msg.data.state === state) out.push(msg);
    }
  }
  return out.sort((a, b) => (a.data.date < b.data.date ? -1 : a.data.date > b.data.date ? 1 : 0));
}

export function setState(file, state) {
  if (!STATES.includes(state)) throw new Error(`Invalid state "${state}"`);
  const { data, body } = readMessage(file);
  fs.writeFileSync(file, stringifyFrontmatter({ ...data, state }, body));
}

export function closeThread(root, thread) {
  if (!isValidThread(thread)) throw new Error(`Invalid thread id "${thread}"`);
  const files = messageFiles(path.join(teamPaths(root).mailbox, thread));
  for (const file of files) setState(file, 'closed');
  return files.length;
}

export { readMessage };
