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
