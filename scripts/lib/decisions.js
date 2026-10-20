// team/decisions.md: open questions and decided items. Only the lead writes it (through scripts/decisions.js).
import fs from 'node:fs';
import path from 'node:path';
import { teamPaths } from './paths.js';
import { localDate } from './dates.js';
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

// defer: the question waits (state deferred) until flushQuestions hands it to the owner; task and options are optional.
export function addQuestion(root, { title, source, status, impact, blocking, thread, defer, task, options, recommend, 'finding-class': findingClass, irreversible }) {
  const all = readDecisions(root);
  const id = nextId('Q', [...all.open.map((x) => x.id), ...all.decided.map((x) => x.question)]);
  const q = { id, title, source, status, impact, blocking, thread, ...(defer ? { state: 'deferred' } : {}), ...(task ? { task } : {}), ...(options ? { options } : {}), ...(recommend ? { recommend } : {}), ...(findingClass ? { 'finding-class': findingClass } : {}), ...(irreversible ? { irreversible: 'yes' } : {}) };
  all.open.push(q);
  writeDecisions(root, all);
  return q;
}

// g16: a parked question is owner-deferred on purpose (for example "until the first sale"). It stays open in the log
// but is not pending: compaction and the resume summary do not wait for it.
export const isParked = (q) => q.state === 'parked';
export const pendingQuestions = (root) => readDecisions(root).open.filter((q) => !isParked(q));
export const parkedQuestions = (root) => readDecisions(root).open.filter(isParked);

export function parkQuestion(root, id, { until }) {
  if (!String(until ?? '').trim()) throw new Error('park needs --until <text>: when or why the question waits for the owner');
  const all = readDecisions(root);
  const q = all.open.find((x) => x.id === id);
  if (!q) throw new Error(`No open question ${id}`);
  if (q.state === 'deferred') throw new Error(`${id} is deferred; flush it first (decisions.js flush), then park it`);
  q.state = 'parked';
  q['parked-until'] = String(until).trim();
  writeDecisions(root, all);
  return q;
}

export function unparkQuestion(root, id) {
  const all = readDecisions(root);
  const q = all.open.find((x) => x.id === id && isParked(x));
  if (!q) throw new Error(`No parked question ${id}`);
  delete q.state;
  delete q['parked-until'];
  writeDecisions(root, all);
  return q;
}

export const deferredFor = (root, task) => readDecisions(root).open.filter((q) => q.state === 'deferred' && q.task === task);

const GROUP = 4;
const askText = (q) => `Source: ${q.source}
Status: ${q.status}
Impact: ${q.impact}

${q.title}`;
function askShape(q) {
  const labels = (q.options ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  const rec = labels.find((l) => l === q.recommend);
  const ordered = rec ? [rec, ...labels.filter((l) => l !== rec)] : labels;
  return {
    id: q.id,
    question: askText(q),
    header: q.title.slice(0, 12),
    options: ordered.map((label) => ({ label: label === rec ? `${label} (Recommended)` : label, description: '' })),
    multiSelect: false,
  };
}

// Marks deferred questions open (all, or one task's) and returns them in groups of at most 4, one AskUserQuestion call each.
export function flushQuestions(root, { task } = {}) {
  const all = readDecisions(root);
  const flushed = all.open.filter((q) => q.state === 'deferred' && (task === undefined || q.task === task));
  for (const q of flushed) delete q.state;
  if (flushed.length) writeDecisions(root, all);
  const groups = [];
  for (let i = 0; i < flushed.length; i += GROUP) groups.push({ questions: flushed.slice(i, i + GROUP).map(askShape) });
  return groups;
}

export function decide(root, questionId, { answer, link = '', now = new Date() }) {
  const all = readDecisions(root);
  const i = all.open.findIndex((x) => x.id === questionId);
  if (i < 0) throw new Error(`No open question ${questionId}`);
  const [q] = all.open.splice(i, 1);
  const d = {
    id: nextId('D', all.decided.map((x) => x.id)),
    title: q.title,
    question: q.id,
    answer,
    date: localDate(now),
    link,
    thread: q.thread ?? '',
  };
  all.decided.push(d);
  writeDecisions(root, all);
  return d;
}

// Records how a thread ended when no owner question was involved, so cleanup can archive it.
// supersedes: the old decision gets "superseded-by" with the new id, the new one "supersedes" with the old id.
export function recordOutcomes(root, items, { now = new Date() } = {}) {
  const all = readDecisions(root);
  const made = items.map(({ thread, outcome, title = outcome, link = '', supersedes }) => {
    const d = {
      id: nextId('D', all.decided.map((x) => x.id)),
      title,
      question: '',
      answer: outcome,
      date: localDate(now),
      link,
      thread,
    };
    if (supersedes) {
      const old = all.decided.find((x) => x.id === supersedes);
      if (!old) throw new Error(`Cannot supersede ${supersedes}: no such decision`);
      old['superseded-by'] = d.id;
      d.supersedes = supersedes;
    }
    all.decided.push(d);
    return d;
  });
  writeDecisions(root, all);
  return made;
}

export const recordOutcome = (root, { now, ...item }) => recordOutcomes(root, [item], { now })[0];

const AMENDABLE = ['title', 'answer', 'date', 'link', 'thread'];

// Changes fields of a decided item in place; "outcome" is the same field as "answer".
export function amendDecision(root, id, fields) {
  const patch = { ...fields };
  if (patch.outcome !== undefined) patch.answer = patch.outcome;
  delete patch.outcome;
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) throw new Error(`Nothing to amend: pass one of ${AMENDABLE.map((k) => `--${k}`).join(', ')}`);
  const all = readDecisions(root);
  const d = all.decided.find((x) => x.id === id);
  if (!d) throw new Error(`No decision ${id}`);
  for (const k of keys) d[k] = patch[k];
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
