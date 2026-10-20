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
  return `## Owner proxy\n\nThe owner set ${p.session} as owner proxy in team/config.json (${p.until ? `until ${p.until}` : 'open-ended'}). Send every owner-decision question to it with SendMessage (thread owner-proxy) instead of AskUserQuestion, the flush groups included; register it with \`decisions.js ask\` first as always. Its reply is the owner's decision: record it with \`decisions.js decide\` and add "(owner proxy ${p.session})". Still ask the owner directly for push, merge into the main branch, deploy, publish and deleting the owner's data. When ListAgents does not show ${p.session}, ask the owner as usual. The owner can override any proxy decision.`;
}
