#!/usr/bin/env node
// Decision log CLI (lead only): show | open | park | unpark | parked | ask | flush | decide | record | amend.
import { runCli, need, UsageError } from './lib/cli.js';
import fs from 'node:fs';
import { readDecisions, pendingQuestions, parkedQuestions, parkQuestion, unparkQuestion, addQuestion, flushQuestions, decide, recordOutcomes, amendDecision, threadFromText } from './lib/decisions.js';
import { isValidThread } from './lib/mailbox.js';
import { irreversibleProblems } from './lib/irreversible.js';
import { questionListsMarkdown } from './lib/summary.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const usage = `Usage:
  decisions.js show
  decisions.js open                      open questions, blocking first
  decisions.js ask --title <t> --source <s> --status <s> --impact <i> --blocking <yes|no> --thread <id>
                                         --options "a|b" --recommend <option> [--defer] [--task <id>] [--finding-class <observed|known|theoretical>]
                                         --finding-class: required in spirit when the question proposes a new task; a theoretical-only proposal
                                         cannot recommend "now" (recommend the phase end)
                                         --irreversible --task <id>: the question asks the owner for "go" on an irreversible or spending step;
                                         refused unless the task brief has a line "Go-path test: <command>" (stub-runner test of the go path) and that command exits 0
                                         and the gate is green
                                         --defer: not blocking, asked later in a batch; board.js refuses done for the --task until flushed
  decisions.js park <Q-id> --until <text>   owner-deferred question (for example "until the first sale"): stays open in the log but no longer
                                         blocks compaction or counts as pending; the hand-off lists it separately
  decisions.js unpark <Q-id>
  decisions.js parked                    parked questions
  decisions.js handoff-questions         markdown lists of queued and parked questions from the log, for a hand-off (never hand-write them)
  decisions.js flush [--task <id>]       prints deferred questions as JSON groups of at most 4 (one AskUserQuestion call each), marks them open
  decisions.js decide <Q-id> --answer <text> [--link <path or url>]
  decisions.js record --outcome <text> [--thread <id>] [--title <t>] [--link <path or url>]
                                         an outcome without a question; the thread defaults to one made from the title
                                         [--supersedes D-xxx]  marks the old decision "superseded-by" the new id
  decisions.js record --file <json>      an array of {outcome, thread?, title?, link?, supersedes?}: records all in one call, prints {ids, decisions}
  decisions.js amend D-xxx [--title <t>] [--answer <text>] [--link <l>] [--thread <id>] [--date <YYYY-MM-DD>]
                                         changes fields of a decision in place (never edit team/decisions.md by hand)
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

function readItems(file) {
  let items;
  try {
    items = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new UsageError(`Cannot read ${file}: ${e.message}`);
  }
  if (!Array.isArray(items) || !items.length) throw new UsageError('--file must hold a non-empty JSON array of decisions');
  return items;
}

// Every owner question carries at least 2 options and one recommended option.
function checkChoices({ options, recommend }) {
  const list = (options ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  if (!options) throw new UsageError('Missing --options "a|b": every question needs at least 2 options');
  if (list.length < 2) throw new UsageError('--options needs at least 2 options separated by |');
  if (!recommend) throw new UsageError('Missing --recommend: name the recommended option');
  if (!list.includes(recommend)) throw new UsageError('--recommend must be exactly one of the options');
}

// A question that proposes a new task states the class of the finding behind it. Proportionality: a proposal that rests
// on a theoretical finding only is not urgent, so it cannot recommend doing it "now".
function checkFindingClass({ 'finding-class': cls, recommend }) {
  if (cls === undefined) return;
  if (!['observed', 'known', 'theoretical'].includes(cls)) throw new UsageError('--finding-class must be observed, known or theoretical');
  if (cls === 'theoretical' && /\bnow\b/i.test(recommend ?? '')) {
    throw new UsageError('A proposal that rests on a theoretical finding only cannot recommend "now": recommend the phase end (findings.js add, deal with it in the hardening batch) or offer the owner "not at all". Only an observed or known finding justifies a task now.');
  }
}

// One decision to record: it needs an outcome; the thread defaults to one made from the title.
function normalize(item, i) {
  if (typeof item?.outcome !== 'string' || !item.outcome.trim()) throw new UsageError(`Decision ${i + 1} has no outcome`);
  const thread = item.thread ?? threadFromText(item.title ?? item.outcome);
  if (!isValidThread(thread)) throw new UsageError(`Invalid thread id "${thread}"`);
  return { ...item, thread };
}

runCli(usage, {
  title: { type: 'string' }, source: { type: 'string' }, status: { type: 'string' }, impact: { type: 'string' },
  blocking: { type: 'string' }, thread: { type: 'string' }, answer: { type: 'string' }, link: { type: 'string' },
  outcome: { type: 'string' }, file: { type: 'string' }, supersedes: { type: 'string' }, date: { type: 'string' }, defer: { type: 'boolean' }, task: { type: 'string' }, options: { type: 'string' }, recommend: { type: 'string' }, 'finding-class': { type: 'string' }, irreversible: { type: 'boolean' }, until: { type: 'string' },
}, ({ values: v, positionals: [cmd, id], root }) => {
  switch (cmd) {
    case 'show':
      return readDecisions(root);
    case 'park':
      if (!id) throw new UsageError('Missing question id');
      need(v, 'until');
      return parkQuestion(root, id, { until: v.until });
    case 'unpark':
      if (!id) throw new UsageError('Missing question id');
      return unparkQuestion(root, id);
    case 'parked':
      return parkedQuestions(root);
    case 'open':
      return pendingQuestions(root).sort((a, b) => (a.blocking === 'yes' ? 0 : 1) - (b.blocking === 'yes' ? 0 : 1));
    case 'handoff-questions':
      return questionListsMarkdown(root);
    case 'ask':
      need(v, 'title', 'source', 'status', 'impact', 'blocking', 'thread');
      if (!['yes', 'no'].includes(v.blocking)) throw new UsageError('--blocking must be yes or no');
      checkChoices(v);
      checkFindingClass(v);
      if (v.irreversible) {
        if (!v.task) throw new UsageError('--irreversible needs --task <id>: the brief of that task must name the go-path test');
        const problems = irreversibleProblems(root, v.task, { pluginRoot });
        if (problems.length) throw new UsageError(`Irreversible go question refused:\n- ${problems.join('\n- ')}`);
      }
      return addQuestion(root, v);
    case 'flush':
      return flushQuestions(root, { task: v.task });
    case 'decide':
      if (!id) throw new UsageError('Missing question id');
      need(v, 'answer');
      return decide(root, id, { answer: v.answer, link: v.link });
    case 'record': {
      const items = v.file === undefined ? [{ outcome: v.outcome, thread: v.thread, title: v.title, link: v.link, supersedes: v.supersedes }] : readItems(v.file);
      const made = recordOutcomes(root, items.map(normalize));
      return v.file === undefined ? made[0] : { ids: made.map((d) => d.id), decisions: made };
    }
    case 'amend':
      if (!id) throw new UsageError('Missing decision id');
      return amendDecision(root, id, { title: v.title, answer: v.answer, outcome: v.outcome, link: v.link, thread: v.thread, date: v.date });
    default:
      throw new UsageError(`Unknown command "${cmd ?? ''}"`);
  }
});
