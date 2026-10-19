#!/usr/bin/env node
// Board CLI (lead only): show | add | update | round | foldin | phase | rotated.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, need, UsageError } from './lib/cli.js';
import { readBoard, addEntry, updateEntry, setPhase, incrementRound, verifyCommit, rotationDue, markRotated, countFoldIn } from './lib/board.js';
import { loadConfig, validateConfig } from './lib/config.js';

const usage = `Usage:
  board.js show
  board.js add --title <text> --owner <role> --model <haiku|sonnet|opus> [--id <id>] [--code <yes|no>]
                                         --code no: a task that produces no code (spike, research, docs only); gate.js --task checks its report file
  board.js update <id> [--status <todo|in-progress|review|done|blocked>] [--owner <role>] [--model <m>] [--commit <sha>] [--handoff <path>] [--code <yes|no>]
                                         --commit checks that the sha exists and is reachable from HEAD; read it first: git log -1 --format=%h
  board.js round <id> [--approach <decision-id>]
                                         count one unresolved round; prints {entry, next} (next.action: retry|raise-model|to-lead|to-owner)
                                         refused once reviewRoundCap (default 2) rounds are used since the start or the last approach;
                                         --approach <id> (a decision recorded in decisions.md) lets the task continue for another window
  board.js foldin <id> [--reset]         before each spec fold-in round: prints action fold-in (rounds up to foldInRounds) or batch; --reset starts a new review cycle
  board.js phase <n>
  board.js rotated                       after the lead hand-off: reset the done counter (update --status done prints rotate: true at 5)
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

const checkCode = (code) => {
  if (code !== undefined && !['yes', 'no'].includes(code)) throw new UsageError('--code must be yes or no');
};

const commands = {
  show: ({ root }) => readBoard(root),
  add: ({ values: v, root }) => {
    need(v, 'title', 'owner', 'model');
    checkCode(v.code);
    return addEntry(root, { id: v.id, title: v.title, owner: v.owner, model: v.model, code: v.code });
  },
  update: ({ values: v, positionals: [, id], root }) => {
    if (!id) throw new UsageError('Missing entry id');
    const patch = {};
    checkCode(v.code);
    for (const k of ['status', 'owner', 'model', 'handoff', 'code']) if (v[k] !== undefined) patch[k] = v[k];
    if (v.commit !== undefined) {
      verifyCommit(root, v.commit);
      const entry = readBoard(root).entries.find((e) => e.id === id);
      patch.commits = [...(entry?.commits ?? []), v.commit];
    }
    const entry = updateEntry(root, id, patch);
    return v.status === 'done' ? { ...entry, rotate: rotationDue(root) } : entry;
  },
  round: ({ values: v, positionals: [, id], root }) => {
    if (!id) throw new UsageError('Missing entry id');
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const config = loadConfig({ pluginRoot, projectRoot: root });
    validateConfig(config);
    return incrementRound(root, id, config, { approach: v.approach });
  },
  foldin: ({ values: v, positionals: [, id], root }) => {
    if (!id) throw new UsageError('Missing entry id');
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const config = loadConfig({ pluginRoot, projectRoot: root });
    validateConfig(config);
    return countFoldIn(root, id, { foldInRounds: config.foldInRounds, reset: v.reset });
  },
  rotated: ({ root }) => {
    markRotated(root);
    return { rotated: true };
  },
  phase: ({ positionals: [, n], root }) => {
    if (!/^\d+$/.test(n ?? '')) throw new UsageError('Phase must be a number');
    setPhase(root, Number(n));
    return { phase: Number(n) };
  },
};

const options = {
  title: { type: 'string' }, owner: { type: 'string' }, model: { type: 'string' }, id: { type: 'string' },
  status: { type: 'string' }, code: { type: 'string' }, commit: { type: 'string' }, handoff: { type: 'string' }, reset: { type: 'boolean' }, approach: { type: 'string' },
};

runCli(usage, options, (ctx) => {
  const cmd = commands[ctx.positionals[0]];
  if (!cmd) throw new UsageError(`Unknown command "${ctx.positionals[0] ?? ''}"`);
  return cmd(ctx);
});
