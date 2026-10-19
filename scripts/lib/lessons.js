// Lessons capture: what went wrong, why, and the rule that would have prevented it. Written by the lead to
// team/lessons.md (this project) and ~/.claude/nac/lessons.md (every project on this machine). The shared file
// never leaves the machine. A lesson is only a proposal: the owner decides which become NAC rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localDate } from './dates.js';
import { teamPaths } from './paths.js';

const TASK_RE = /^[A-Za-z0-9-]{1,64}$/;
const HEADING_RE = /^## (\d{4}-\d{2}-\d{2}) \| (.*) \| (\S+)$/;
const FIELDS = ['trigger', 'what', 'rule'];

export const sharedLessonsPath = (home = os.homedir()) => path.join(home, '.claude', 'nac', 'lessons.md');

// One line per value: a newline in the text must not be able to start a fake entry heading.
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function append(file, block, title) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = !fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() === '';
  fs.appendFileSync(file, `${fresh ? `${title}\n` : ''}\n${block}\n`);
}

export function addLesson(root, { trigger, what, rule, task }, { home = os.homedir(), now = new Date() } = {}) {
  const lesson = { trigger: oneLine(trigger), what: oneLine(what), rule: oneLine(rule) };
  for (const k of FIELDS) if (!lesson[k]) throw new Error(`Lesson needs a non-empty ${k}`);
  const taskId = oneLine(task) || '-';
  if (taskId !== '-' && !TASK_RE.test(taskId)) throw new Error(`Invalid task id "${taskId}"`);
  const project = oneLine(path.basename(path.resolve(root)));
  const date = localDate(now);
  const block = [`## ${date} | ${project} | ${taskId}`, `- trigger: ${lesson.trigger}`, `- what: ${lesson.what}`, `- rule: ${lesson.rule}`].join('\n');
  append(teamPaths(root).lessons, block, '# Lessons');
  append(sharedLessonsPath(home), block, '# NAC lessons (all projects on this machine)');
  return { date, project, task: taskId, ...lesson };
}

export function parseLessons(text) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = HEADING_RE.exec(line);
    if (m) {
      cur = { date: m[1], project: m[2], task: m[3], trigger: '', what: '', rule: '' };
      out.push(cur);
    } else if (cur) {
      const f = /^- (trigger|what|rule): (.*)$/.exec(line);
      if (f) cur[f[1]] = f[2];
    }
  }
  return out;
}

// since: YYYY-MM-DD, entries from that day on. shared: read the machine-wide file instead of the project's.
export function readLessons(root, { since, shared = false, home = os.homedir() } = {}) {
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since must be a date: YYYY-MM-DD');
  const file = shared ? sharedLessonsPath(home) : teamPaths(root).lessons;
  if (!fs.existsSync(file)) return [];
  return parseLessons(fs.readFileSync(file, 'utf8')).filter((l) => since === undefined || l.date >= since);
}
