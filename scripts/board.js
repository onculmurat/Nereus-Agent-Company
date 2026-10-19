#!/usr/bin/env node
// Board CLI (lead only): show | add | update | round | phase | rotated.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, need, UsageError } from './lib/cli.js';
import { readBoard, addEntry, updateEntry, setPhase, incrementRound, rotationDue, markRotated } from './lib/board.js';
import { loadConfig, validateConfig } from './lib/config.js';

const usage = `Usage:
  board.js show
  board.js add --title <text> --owner <role> --model <haiku|sonnet|opus> [--id <id>]
  board.js update <id> [--status <todo|in-progress|review|done|blocked>] [--owner <role>] [--model <m>] [--commit <sha>] [--handoff <path>]
  board.js round <id>                    count one unresolved round; prints {entry, next} (next.action: retry|raise-model|to-lead|to-owner)
  board.js phase <n>
  board.js rotated                       after the lead hand-off: reset the done counter (update --status done prints rotate: true at 5)
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

const commands = {
  show: ({ root }) => readBoard(root),
  add: ({ values: v, root }) => {
    need(v, 'title', 'owner', 'model');
    return addEntry(root, { id: v.id, title: v.title, owner: v.owner, model: v.model });
  },
  update: ({ values: v, positionals: [, id], root }) => {
    if (!id) throw new UsageError('Missing entry id');
    const patch = {};
    for (const k of ['status', 'owner', 'model', 'handoff']) if (v[k] !== undefined) patch[k] = v[k];
    if (v.commit !== undefined) {
      const entry = readBoard(root).entries.find((e) => e.id === id);
      patch.commits = [...(entry?.commits ?? []), v.commit];
    }
    const entry = updateEntry(root, id, patch);
    return v.status === 'done' ? { ...entry, rotate: rotationDue(root) } : entry;
  },
  round: ({ positionals: [, id], root }) => {
    if (!id) throw new UsageError('Missing entry id');
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const config = loadConfig({ pluginRoot, projectRoot: root });
    validateConfig(config);
    return incrementRound(root, id, config);
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
  status: { type: 'string' }, commit: { type: 'string' }, handoff: { type: 'string' },
};

runCli(usage, options, (ctx) => {
  const cmd = commands[ctx.positionals[0]];
  if (!cmd) throw new UsageError(`Unknown command "${ctx.positionals[0] ?? ''}"`);
  return cmd(ctx);
});
