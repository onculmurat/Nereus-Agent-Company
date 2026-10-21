// g29: the owner proxy, set by the owner in team/config.json (setup.js --proxy). In chat only, a new lead session did
// not know it and opened an AskUserQuestion box the proxy cannot answer, and a standing delegation recorded by the
// lead was refused by the auto-mode classifier. The session start hands this text to every lead session.
import { localDate } from './dates.js';

export const PROXY_SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/;
export const PROXY_UNTIL_RE = /^\d{4}-\d{2}-\d{2}$/;

export function proxyContext(config, today = localDate()) {
  const p = config.ownerProxy;
  if (!p) return '';
  if (p.until && p.until < today) {
    return `## Owner proxy\n\nThe owner proxy ${p.session} expired on ${p.until}. Ask the owner directly.`;
  }
  return `## Owner proxy\n\nThe owner set ${p.session} as owner proxy in team/config.json (${p.until ? `until ${p.until}` : 'open-ended'}). Send every owner-decision question to it with SendMessage (thread owner-proxy) instead of AskUserQuestion, the flush groups included; register it with \`decisions.js ask\` first as always. Its reply is a proxy decision under the owner's written delegation (team/config.json and the owner-proxy block in CLAUDE.md): record it with \`decisions.js decide <Q> --by proxy\`, never as the owner's own words. If the permission system refuses one proxy decide, leave that question open for the owner, go on with work that does not depend on it, and still record the next proxy answer with --by proxy. Still ask the owner directly for push, merge into the main branch, deploy, publish and deleting the owner's data. When ListAgents does not show ${p.session}, ask the owner as usual. The owner can override any proxy decision.`;
}

// g47: after a compaction the lead opened an AskUserQuestion box although ownerProxy was set; the proxy's SendMessage
// answer waited in the queue behind the box and the lead stood still for hours. With an active proxy the box is refused,
// except for the owner-only actions and when the lead states that the proxy is not reachable.
export const OWNER_ONLY = /\b(push|merge|deploy|publish|delete|release)\b|yay[ıi]n|canl[ıi]ya|\bsil/i;
const OWNER_DIRECT = /owner direct:/i;

export function checkAskUser(config, input, today = localDate()) {
  const p = config.ownerProxy;
  if (!p || (p.until && p.until < today)) return undefined;
  const text = (input?.questions ?? []).map((q) => `${q?.header ?? ''} ${q?.question ?? ''}`).join('\n');
  if (OWNER_ONLY.test(text) || OWNER_DIRECT.test(text)) return undefined;
  return { block: `NAC proxy guard (g47): the owner set ${p.session} as owner proxy, and an AskUserQuestion box waits for a key press the proxy cannot give. Register the question with decisions.js ask, send it to ${p.session} by SendMessage (thread owner-proxy) and end your turn; the answer arrives as a message. Push, merge, deploy, publish and deleting the owner's data still go to the owner in a box. When ListAgents does not show ${p.session}, start the question text with "Owner direct: <reason>".` };
}

// g49: the lead recorded a proxy answer as the owner's own approval; the auto-mode classifier refused it, and from then
// on the lead recorded no proxy answer at all, so every question waited for the owner. A proxy decision is now recorded
// as what it is (--by proxy), and only where the owner's delegation covers it.
export function proxyDecideProblem(config, question, today = localDate()) {
  const p = config.ownerProxy;
  if (!p) return 'no ownerProxy is set in team/config.json; the owner answers this question';
  if (p.until && p.until < today) return `the owner proxy ${p.session} expired on ${p.until}; the owner answers this question`;
  if (question.irreversible === 'yes') return 'an irreversible or spending go-step stays with the owner';
  if (OWNER_ONLY.test(`${question.title ?? ''} ${question.source ?? ''} ${question.impact ?? ''}`)) return 'push, merge, deploy, publish and deleting the owner\'s data stay with the owner';
  return undefined;
}
