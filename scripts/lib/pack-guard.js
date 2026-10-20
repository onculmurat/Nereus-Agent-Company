// g22: code-role dispatches (developer, database-engineer, reviewer, security, test-engineer, final-reviewer) must name a context pack. Seen live: after a lead
// rotation three tasks were dispatched with 0% packed and the roles explored the project from scratch.
import { namesPack } from './cost.js';
import { recordOutcomes, threadFromText } from './decisions.js';

const CODE_ROLE = /(?:^|:)(?:[a-z]+-developer|code-reviewer|security-reviewer|database-engineer|test-engineer|final-reviewer)$/;
const NO_PACK = /--no-pack\s+(\S[^\n]*)/;
const PACK_COMMAND = 'node "<scripts>/pack.js" <task> --role <role>';

// Returns { block } to refuse the dispatch, or undefined. Throws only on internal error (the hook fails open).
export function checkDispatch(root, toolName, input) {
  if (toolName !== 'Agent' && toolName !== 'Task') return undefined;
  const role = String(input?.subagent_type ?? '');
  if (!CODE_ROLE.test(role)) return undefined;
  const prompt = String(input?.prompt ?? '');
  if (namesPack(prompt)) return undefined;
  const reason = NO_PACK.exec(prompt)?.[1].trim();
  if (reason) {
    recordOutcomes(root, [{ thread: threadFromText(`no pack ${role}`), title: `Dispatch without a context pack: ${role}`, outcome: `${role} dispatched without a pack (--no-pack): ${reason}` }]);
    return undefined;
  }
  return { block: `NAC pack guard: a ${role} dispatch must name its context pack (team/work/packs/<task>-<role>.md). Build it first: ${PACK_COMMAND}, then put the printed path in the prompt. Escape hatch: add "--no-pack <reason>" to the prompt; the reason is recorded in team/decisions.md.` };
}
