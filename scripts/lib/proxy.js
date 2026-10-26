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
// g58: "\bsil" and a bare "delete" matched a product question (Q-175: do deleted notes count toward the note limit) as
// deleting the owner's data; the proxy answer was refused and the lead waited 54 minutes in a box at night. Deleting
// now counts only with what is deleted: data, files, a branch, a repo, a database, backups.
const DELETE_DATA = /\b(delete|remove|wipe|purge|drop|rm)\b[^.;\n]{0,40}\b(data|files?|folders?|director(?:y|ies)|branch(?:es)?|repo(?:sitory)?|database|backups?|history)\b(?!-)|\b(veri|dosya|klas[öo]r|dal|depo|yedek|veritaban|ge[çc]mi[şs])\w*\b[^.;\n]{0,40}\bsil/;
export const OWNER_ONLY = new RegExp(String.raw`\b(push|merge|deploy|publish|release)\b|yay[ıi]n|canl[ıi]ya|${DELETE_DATA.source}`, 'i');
const OWNER_DIRECT = /owner direct:/i;
// g68: the action words also matched as nouns (Q-188: "before the release tasks T-062 to T-067"); the proxy answer to
// a planning question was refused and the owner had to answer it. A release, publish or deploy that names work, a
// phase or a time ("release tasks", "before release", "yayın görevleri", "yayından önce") is not the owner's action.
// g70: Q-189 ("CI runs only after an owner push", "drop the 3 file-symlink tests") was refused as a push and as deleting
// files; a push named as a condition or a CI trigger, and file- that only describes the next noun, are not the owner's action.
// g78: Q-194 named the Cargo manifest flag publish = false ("a publish=false path crate") and was refused as a publish;
// the flag keeps a crate from ever being published, so it is not the owner's action.
// g83: Q-198 ("the production path runs the same release code the tests prove", about freeing index.db and its lock)
// was refused as a release; releasing a handle, a lock, a file or memory is not the owner's action.
const NOUN_USE = new RegExp([
  String.raw`\breleases?\s+(?:the\s+|its\s+|their\s+|all\s+)?(?:file\s+)?(?:handles?|locks?|files?|resources?|memory|connections?|mutex(?:es)?|guards?|index\.db|index\.lock)\b`,
  String.raw`\brelease\s+(?:code|path|logic|hooks?)\b`,
  String.raw`\b(?:pre-?)?(?:release|publish|deploy)(?:-| )(?:tasks?|work|group|phase|notes?|blockers?|checklist|plan|candidates?|scope|docs?|pipeline|matrix|criteria|readiness|risks?)\b`,
  String.raw`\b(?:before|after|until|ahead of|for|toward|towards)\s+(?:the\s+)?(?:first\s+|free\s+|v?\d[\w.]*\s+)?(?:release|publish|deploy)\b`,
  String.raw`\bpre-?release\b`,
  String.raw`\bpublish\s*=\s*(?:false|\[\s*\])`,
  String.raw`\b(?:before|after|until|on|without)\s+(?:an?\s+|the\s+|any\s+)?(?:owner(?:'s)?\s+|v?\S*\s*tag\s+)?push\b`,
  String.raw`\bpush\s+(?:guard|event|trigger)s?\b`,
  String.raw`yay[ıi]n(?:a|dan|ın|in)?\s*(?:g[öo]rev|[öo]ncesi|sonras[ıi]|kalan|hatt|i[şs]|matris|kriter|risk|grub|haz[ıi]rl)\w*`,
  String.raw`yay[ıi]ndan\s+(?:[öo]nce|sonra)`,
].join('|'), 'gi');
export function ownerOnlyMatch(text) {
  return OWNER_ONLY.exec(String(text ?? '').replace(NOUN_USE, ' '));
}

export function checkAskUser(config, input, today = localDate()) {
  const p = config.ownerProxy;
  if (!p || (p.until && p.until < today)) return undefined;
  const text = (input?.questions ?? []).map((q) => `${q?.header ?? ''} ${q?.question ?? ''}`).join('\n');
  if (ownerOnlyMatch(text) || OWNER_DIRECT.test(text)) return undefined;
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
  const owner = ownerOnlyMatch(`${question.title ?? ''} ${question.source ?? ''} ${question.impact ?? ''}`);
  if (owner) return `push, merge, deploy, publish and deleting the owner's data stay with the owner (matched "${owner[0]}")`;
  return undefined;
}
