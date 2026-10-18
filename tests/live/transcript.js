// Reads a Claude Code session transcript (JSONL) into the owner prompts, replies and tool calls the
// live checks need. Only user and assistant entries matter; subagent side chains are left out.
import fs from 'node:fs';

const TEAMMATE_MESSAGE = 'Another Claude session sent a message';

export function readTranscript(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).flatMap((line) => {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return [];
    }
    if (e.type !== 'user' && e.type !== 'assistant') return [];
    const content = e.message?.content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    return [{
      role: e.type,
      meta: Boolean(e.isMeta),
      sidechain: Boolean(e.isSidechain),
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
      tools: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input ?? {} })),
      toolResult: blocks.some((b) => b.type === 'tool_result'),
    }];
  });
}

// Something the owner typed: not a tool result, an injected instruction, a teammate message or command output.
export const isPrompt = (e) => e.role === 'user' && !e.meta && !e.sidechain && !e.toolResult && e.text.trim() !== ''
  && !e.text.startsWith(TEAMMATE_MESSAGE) && !e.text.startsWith('<local-command');

// The entries after the first owner prompt matching re, up to the next owner prompt; null when no prompt matches.
export function turnAfter(entries, re) {
  const start = entries.findIndex((e) => isPrompt(e) && re.test(e.text));
  if (start < 0) return null;
  const next = entries.findIndex((e, i) => i > start && isPrompt(e));
  return entries.slice(start + 1, next < 0 ? undefined : next);
}

const own = (entries) => entries.filter((e) => e.role === 'assistant' && !e.sidechain);
export const toolCalls = (entries, name) => own(entries).flatMap((e) => e.tools).filter((t) => name.test(t.name));
export const shellCommands = (entries) => toolCalls(entries, /^(Bash|PowerShell)$/).map((t) => String(t.input.command ?? ''));
export const agentCalls = (entries) => toolCalls(entries, /^(Agent|Task)$/);
export const fileWrites = (entries) => toolCalls(entries, /^(Write|Edit|MultiEdit|NotebookEdit)$/);

// What the lead said, including the text of AskUserQuestion calls.
export const replyText = (entries) => [
  ...own(entries).map((e) => e.text),
  ...toolCalls(entries, /^AskUserQuestion$/).map((t) => JSON.stringify(t.input)),
].join('\n');

// Questions put to the owner: each AskUserQuestion question, plus each question mark run in the plain text.
export function questionsAsked(entries) {
  const asked = toolCalls(entries, /^AskUserQuestion$/).reduce((n, t) => n + (t.input.questions?.length ?? 1), 0);
  const marks = own(entries).map((e) => e.text).join('\n').match(/\?+/g) ?? [];
  return asked + marks.length;
}
