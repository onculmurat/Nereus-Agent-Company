// g23: an owner "go" question for an irreversible or spending step (tag --irreversible) is refused unless the task's
// brief names an automated test of the go path (a stub runner proving the go flag reaches the executor) and the gate is
// green. Seen live: a dry run printed the plan and "Nothing was started"; no test ever exercised the go path.
// This is a gate check, so it fails closed: any problem or internal error refuses the question.
import fs from 'node:fs';
import path from 'node:path';
import { teamPaths } from './paths.js';
import { loadConfig } from './config.js';
import { runGate, gateChecks } from './gate.js';

const GO_PATH_LINE = /^\s*(?:[-*]\s+)?\**go-path test(?::\**|\**:)\s*`?([^`\n(]+?)`?(?:\s*\(.*)?\s*$/im;

export function irreversibleProblems(root, task, { pluginRoot }) {
  try {
    const briefFile = path.join(teamPaths(root).tasks, `${task}.md`);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(task) || !fs.existsSync(briefFile)) return [`The brief team/work/tasks/${task}.md does not exist.`];
    const named = GO_PATH_LINE.exec(fs.readFileSync(briefFile, 'utf8'))?.[1].trim();
    if (!named) return [`The brief of ${task} names no go-path test: add a line "Go-path test: <test file>" for an automated test of the go path with a stub runner (the go flag reaches the executor), and get the gate green on it.`];
    const file = path.resolve(root, named);
    const rel = path.relative(path.resolve(root), file);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file)) return [`The go-path test ${named} named in the brief does not exist in the project.`];
    const checks = gateChecks(loadConfig({ pluginRoot, projectRoot: root }));
    if (!checks.length) return ['No gate command is configured, so the gate cannot be green on the go-path test.'];
    const gate = runGate(root, checks);
    if (!gate.ok) return [`The gate is not green (${gate.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')} red): fix it first, then ask.`];
    return [];
  } catch (e) {
    return [`The go-path check could not run (${e.message}).`];
  }
}
