// Parses Markdown entries of the form "<hashes> ID: title" followed by "- key: value" lines.
export function parseEntries(lines, hashes) {
  const head = new RegExp(String.raw`^${hashes} ([^:\s]+): (.*)$`);
  const entries = [];
  let cur = null;
  for (const line of lines) {
    const h = head.exec(line);
    if (h) {
      cur = { id: h[1], title: h[2].trim(), fields: {} };
      entries.push(cur);
      continue;
    }
    if (/^#{1,6} /.test(line)) { cur = null; continue; }
    const kv = /^- ([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (cur && kv) cur.fields[kv[1]] = kv[2].trim();
  }
  return entries;
}

export function formatEntry(hashes, id, title, fields) {
  return [`${hashes} ${id}: ${title}`, ...Object.entries(fields).map(([k, v]) => `- ${k}: ${v ?? ''}`.trimEnd())].join('\n');
}

export const toLines = (text) => text.replace(/\r\n/g, '\n').split('\n');

export function nextId(prefix, ids) {
  const nums = ids.map((id) => new RegExp(String.raw`^${prefix}-(\d+)$`).exec(id)).filter(Boolean).map((m) => Number(m[1]));
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}
