import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

test('manifest names', () => {
  const plugin = read('../.claude-plugin/plugin.json');
  const market = read('../.claude-plugin/marketplace.json');
  assert.equal(plugin.name, 'nac');
  assert.equal(plugin.license, 'MIT');
  assert.equal(market.name, 'nereus-agent-company');
  assert.equal(market.plugins[0].name, 'nac');
  assert.equal(market.plugins[0].source, './');
});
