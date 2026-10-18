import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, stringifyFrontmatter } from '../scripts/lib/frontmatter.js';

test('round-trips data and body', () => {
  const text = stringifyFrontmatter({ id: 'a1', from: 'architect', state: 'unread' }, 'Hello\nworld\n');
  const { data, body } = parseFrontmatter(text);
  assert.deepEqual(data, { id: 'a1', from: 'architect', state: 'unread' });
  assert.equal(body, 'Hello\nworld\n');
});

test('CRLF input parses the same as LF', () => {
  const lf = '---\nid: x\nto: beta\n---\nline one\nline two\n';
  assert.deepEqual(parseFrontmatter(lf.replace(/\n/g, '\r\n')), parseFrontmatter(lf));
});

test('text without front matter is all body', () => {
  assert.deepEqual(parseFrontmatter('just text'), { data: {}, body: 'just text' });
});

test('values may contain colons', () => {
  assert.equal(parseFrontmatter('---\ndate: 2026-10-18T10:00:00Z\n---\n').data.date, '2026-10-18T10:00:00Z');
});
