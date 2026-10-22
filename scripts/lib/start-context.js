// Assembles the lead's SessionStart context.
// g51: Claude Code saves hook context over 10,000 characters to a file and shows the session only a ~2 KB preview.
// The marker sat at character 7182, so new lead sessions said "NAC is not loaded" and the lead prompt, rules, proxy
// and resume never reached them (truncated since 2026-10-20). The marker goes first, and the lead prompt becomes a
// pointer to its file when the whole context would not fit.
export const CONTEXT_LIMIT = 9000;

export function assembleContext({ marker, sections, lead, leadFile }) {
  const join = (parts) => parts.filter(Boolean).join('\n\n');
  const full = join([marker, ...sections, lead]);
  if (full.length <= CONTEXT_LIMIT) return full;
  const short = join([marker, `## NAC lead instructions\n\nThey do not fit into this start message. Before anything else, Read ${leadFile} in full (no limit); it is this session's lead prompt, and the owner's rules come from it.`, ...sections]);
  if (short.length <= CONTEXT_LIMIT) return short;
  // A long resume must not push the whole context into a file either: cut the tail and say so.
  const note = '\n\n[NAC: start context cut here to stay under the hook limit; run summary.js for the full resume.]';
  return short.slice(0, CONTEXT_LIMIT - note.length) + note;
}
