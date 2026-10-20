// Detects a lead message that ends by asking the owner something in plain chat, with no recommendation in it.
// Owner questions go through decisions.js ask (options and one recommendation are checked there); a chat question
// skips those checks. Cheap and conservative: only the last non-empty line is looked at.
import fs from 'node:fs';

const RECOMMENDATION = /recommend|öneri|tavsiye/i;
const TAIL_BYTES = 256 * 1024;

export function askedWithoutRecommendation(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const last = text.trimEnd().split(/\r?\n/).filter((l) => l.trim()).at(-1) ?? '';
  const stripped = last.replace(/[\s*_`"'”’)\]>]+$/u, '');
  if (!stripped.endsWith('?')) return false;
  return !RECOMMENDATION.test(text);
}

// The text of the last assistant message in a Claude Code transcript (JSON lines); '' when unreadable.
export function lastAssistantText(file) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        let entry;
        try {
          entry = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (entry?.type !== 'assistant') continue;
        const content = entry.message?.content;
        const text = Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : String(content ?? '');
        if (text.trim()) return text;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // unreadable transcript: nothing to check
  }
  return '';
}

// A status report section is a heading or a bold-only title line such as "## Done" or "**Summary**".
// The "Status:" label of a question block is not one.
const REPORT_HEADING = /^[ \t]*(?:#{1,4}[ \t]*|\*\*[ \t]*)(?:done|summary|status report|report|completed|results?|özet|rapor|tamamlanan|yapılanlar)\b/im;

// The final message mixes a status report with an owner question, or names an open Q-id without its own question block
// (the "Source:" line of the question-protocol shape). Returns the problem as text, or '' (also on any internal error).
export function buriedQuestionProblem(text, openIds) {
  try {
    if (typeof text !== 'string' || !text.trim()) return '';
    const lastParagraph = text.trimEnd().split(/\r?\n\s*\r?\n/).at(-1) ?? '';
    const asks = lastParagraph.replace(/`[^`]*`/g, '').includes('?');
    if (asks && REPORT_HEADING.test(text)) return 'it holds a status report section and a question to the owner together';
    const mentioned = (Array.isArray(openIds) ? openIds : []).filter((id) => text.split(/[^A-Za-z0-9-]+/).includes(id));
    if (mentioned.length && !/^[ \t]*(?:[-*][ \t]*)?\**source\**[ \t]*:/im.test(text)) {
      return `it names open owner question ${mentioned.join(', ')} without the question's own block (Source, Status, Impact, options, recommendation)`;
    }
    return '';
  } catch {
    return '';
  }
}
