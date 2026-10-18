// Minimal front matter: "key: value" lines between --- fences. Accepts CRLF, writes LF.
export function parseFrontmatter(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2];
  }
  return { data, body: m[2] };
}

export function stringifyFrontmatter(data, body) {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${v ?? ''}`);
  return `---\n${lines.join('\n')}\n---\n${body ?? ''}`;
}
