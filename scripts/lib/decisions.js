// team/decisions.md: open questions and decided items. Only the lead writes it (through scripts/decisions.js).
import fs from 'node:fs';
import path from 'node:path';
import { teamPaths } from './paths.js';
import { parseEntries, formatEntry, toLines, nextId } from './sections.js';

const OPEN = '## Open questions';
const DECIDED = '## Decided';

export function readDecisions(root) {
  const file = teamPaths(root).decisions;
  if (!fs.existsSync(file)) return { open: [], decided: [] };
  const lines = toLines(fs.readFileSync(file, 'utf8'));
  const at = (h) => lines.findIndex((l) => l.trim() === h);
  const iOpen = at(OPEN);
  const iDecided = at(DECIDED);
  const slice = (from, to) => (from < 0 ? [] : lines.slice(from + 1, to < 0 || to < from ? undefined : to));
  const flat = ({ id, title, fields }) => ({ id, title, ...fields });
  return {
    open: parseEntries(slice(iOpen, iDecided), '###').map(flat),
    decided: parseEntries(slice(iDecided, iOpen > iDecided ? iOpen : -1), '###').map(flat),
  };
}

function writeDecisions(root, { open, decided }) {
  const file = teamPaths(root).decisions;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const block = ({ id, title, ...fields }) => formatEntry('###', id, title, fields);
  const parts = ['# Decisions', OPEN, ...open.map(block), DECIDED, ...decided.map(block)];
  fs.writeFileSync(file, parts.join('\n\n') + '\n');
}

export function addQuestion(root, { title, source, status, impact, blocking, thread }) {
  const all = readDecisions(root);
  const id = nextId('Q', [...all.open.map((x) => x.id), ...all.decided.map((x) => x.question)]);
  const q = { id, title, source, status, impact, blocking, thread };
  all.open.push(q);
  writeDecisions(root, all);
  return q;
}

export function decide(root, questionId, { answer, link = '' }) {
  const all = readDecisions(root);
  const i = all.open.findIndex((x) => x.id === questionId);
  if (i < 0) throw new Error(`No open question ${questionId}`);
  const [q] = all.open.splice(i, 1);
  const d = {
    id: nextId('D', all.decided.map((x) => x.id)),
    title: q.title,
    question: q.id,
    answer,
    date: new Date().toISOString().slice(0, 10),
    link,
    thread: q.thread ?? '',
  };
  all.decided.push(d);
  writeDecisions(root, all);
  return d;
}

// Records how a thread ended when no owner question was involved, so cleanup can archive it.
export function recordOutcome(root, { thread, outcome, title = outcome, link = '' }) {
  const all = readDecisions(root);
  const d = {
    id: nextId('D', all.decided.map((x) => x.id)),
    title,
    question: '',
    answer: outcome,
    date: new Date().toISOString().slice(0, 10),
    link,
    thread,
  };
  all.decided.push(d);
  writeDecisions(root, all);
  return d;
}

// A thread id made from free text ("Proje lisansı" -> "proje-lisansi"), for a record without --thread.
export function threadFromText(text) {
  const slug = String(text ?? '').replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return slug || 'decision';
}

export function isThreadDecided(root, thread) {
  return readDecisions(root).decided.some((d) => d.thread === thread);
}
