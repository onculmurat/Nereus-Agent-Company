#!/usr/bin/env node
// Board CLI (lead only): show | add | update | review | round | foldin | phase | rotated.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, need, UsageError } from './lib/cli.js';
import { readBoard, addEntry, updateEntry, recordReview, recordModuleReview, phaseCloseProblems, setPhase, incrementRound, commitsWith, rotationDue, markRotated, countFoldIn } from './lib/board.js';
import { loadConfig, validateConfig } from './lib/config.js';
import { listFindings } from './lib/findings.js';
import { ensureCostFile } from './lib/cost.js';
import { rotationWay, rotationEvery } from './lib/task.js';

const usage = `Usage:
  board.js show
  board.js add --title <text> --owner <role> --model <haiku|sonnet|opus> [--id <id>] [--code <yes|no>] [--security <yes|no|contract>] [--module <m>] [--hardening yes [--decision <D-id>]] [--size <S|M|L>]
                                         --hardening yes: the module's hardening task (needs --module); a second one in the same module and phase is refused
                                         unless --decision names a decision recorded in decisions.md
                                         --code no: a task that produces no code (spike, research, docs only); gate.js --task checks its report file
  board.js update <id> [--title <text>] [--status <todo|in-progress|review|done|blocked>] [--owner <role>] [--model <m>] [--commit <sha>] [--handoff <path>] [--worktree <path>] [--agent <id-or-name>] [--code <yes|no>] [--security <yes|no|contract>] [--module <m>] [--size <S|M|L>] [--single-commit <reason>]
                                         --status in-progress is refused while another code task is in progress in the same tree; parallel tasks each get a worktree (worktree.js add <id>) and record it with --worktree <path>
                                         a task without a size counts as M: --status done on M/L (or no size) with at most one code commit is refused
                                         unless --single-commit <reason> (recorded in decisions.md); S and --code no tasks are not checked
                                         a brief that cites threat-model IDs ("threat-model T12, M2") tags the task security: yes when it is added or started (--security no or an existing tag wins)
                                         --security yes: reviewed per module by security-reviewer; contract (task changes a security contract): done is refused until a pass is recorded (review)
                                         --commit checks that the sha exists and is reachable from HEAD; read it first: git log -1 --format=%h
  board.js review <id> --role <role> --verdict <pass|fail>
                                         records the reviewer's latest verdict on the task; prints the entry
  board.js review --module <m> --role <role> --verdict <pass|fail>
                                         module review: covers the module's security-tagged tasks that are done now
  board.js round <id> [--approach <decision-id>]
                                         count one unresolved round; prints {entry, next} (next.action: retry|raise-model|to-lead|to-owner)
                                         refused once reviewRoundCap (default 2) rounds are used since the start or the last approach;
                                         --approach <id> (a decision recorded in decisions.md) lets the task continue for another window
  board.js foldin <id> [--reset]         before each spec fold-in round: prints action fold-in (rounds up to foldInRounds) or batch; --reset starts a new review cycle
  board.js phase <n>                     refused while a blocker finding is open or a module has security tasks done after its last
                                         security-reviewer pass (board.js review --module); the owner approves the phase first
  board.js rotated                       after the lead hand-off: reset the done counter (update --status done prints rotate: true at rotateEvery done tasks:
                                         every task with compaction, 5 with /clear; with rotateBy: compaction|clear). task.js close does all of it itself
  (all accept --project <dir>; default: nearest directory with team/config.json)
`;

const checkYesNo = (name, value, allowed = ['yes', 'no']) => {
  if (value !== undefined && !allowed.includes(value)) throw new UsageError(`--${name} must be ${allowed.slice(0, -1).join(', ')} or ${allowed.at(-1)}`);
};

const commands = {
  show: ({ root }) => readBoard(root),
  add: ({ values: v, root }) => {
    need(v, 'title', 'owner', 'model');
    checkYesNo('code', v.code);
    checkYesNo('security', v.security, ['yes', 'no', 'contract']);
    checkYesNo('hardening', v.hardening);
    return addEntry(root, { id: v.id, title: v.title, owner: v.owner, model: v.model, code: v.code, security: v.security, module: v.module, hardening: v.hardening, decision: v.decision, size: v.size });
  },
  update: ({ values: v, positionals: [, id], root }) => {
    if (!id) throw new UsageError('Missing entry id');
    const patch = {};
    checkYesNo('code', v.code);
    checkYesNo('security', v.security, ['yes', 'no', 'contract']);
    for (const k of ['title', 'status', 'owner', 'model', 'handoff', 'code', 'security', 'module', 'size', 'worktree', 'agent']) if (v[k] !== undefined) patch[k] = v[k];
    if (v.commit !== undefined) patch.commits = commitsWith(root, id, v.commit);
    if (v['single-commit'] !== undefined && !v['single-commit'].trim()) throw new UsageError('--single-commit needs a reason');
    const entry = updateEntry(root, id, patch, { singleCommit: v['single-commit'] });
    if (v.status !== 'done') return entry;
    // g20: a task does not close without its cost file; write it now. Fail-open: a problem here only warns.
    let cost;
    try {
      cost = ensureCostFile(root, id);
      for (const w of cost.warnings) process.stderr.write(`warning: ${w}\n`);
    } catch (e) {
      process.stderr.write(`warning: cost file not written for ${id} (${e.message}); run cost.js --save --task ${id}\n`);
    }
    let config = {};
    try {
      config = loadConfig({ pluginRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), projectRoot: root });
    } catch { /* the default rotation then */ }
    const rotate = rotationDue(root, rotationEvery(root, config));
    return { ...entry, rotate, ...(rotate ? { rotateBy: rotationWay(root) } : {}), ...(cost ? { cost: { file: cost.file, created: cost.created } } : {}) };
  },
  review: ({ values: v, positionals: [, id], root }) => {
    need(v, 'role', 'verdict');
    if (v.module !== undefined) return recordModuleReview(root, v.module, { role: v.role, verdict: v.verdict });
    if (!id) throw new UsageError('Missing entry id (or pass --module <m>)');
    return recordReview(root, id, { role: v.role, verdict: v.verdict });
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
    const problems = phaseCloseProblems(root);
    if (problems.length) throw new Error(`Phase ${n} cannot start yet:\n- ${problems.join('\n- ')}`);
    setPhase(root, Number(n));
    // Every open finding is listed, whatever its severity or origin: the owner sees what is deferred at the phase end.
    return { phase: Number(n), deferredFindings: listFindings(root, { open: true }).map(({ id, module, severity, task, text }) => ({ id, module, severity, task, text })) };
  },
};

const options = {
  title: { type: 'string' }, owner: { type: 'string' }, model: { type: 'string' }, id: { type: 'string' },
  status: { type: 'string' }, code: { type: 'string' }, security: { type: 'string' }, module: { type: 'string' }, role: { type: 'string' }, verdict: { type: 'string' }, commit: { type: 'string' }, handoff: { type: 'string' }, reset: { type: 'boolean' }, approach: { type: 'string' }, hardening: { type: 'string' }, decision: { type: 'string' }, size: { type: 'string' }, worktree: { type: 'string' }, agent: { type: 'string' }, 'single-commit': { type: 'string' },
};

runCli(usage, options, (ctx) => {
  const cmd = commands[ctx.positionals[0]];
  if (!cmd) throw new UsageError(`Unknown command "${ctx.positionals[0] ?? ''}"`);
  return cmd(ctx);
});
