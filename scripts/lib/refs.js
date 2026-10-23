// References a task brief makes to the spec, contracts, threat model and decisions.
import { toLines } from './sections.js';

const uniq = (list) => [...new Set(list)];

// References in a brief header such as:
//   Spec: **5.4** (note), **2.3 adim 2**, **3**; mcp-tools 1.3; threat-model T5, N1.
//   Kararlar: D-086, D-087
export function parseRefs(text) {
  const lines = toLines(text);
  const specSections = [];
  const contracts = [];
  const threats = [];
  for (const line of lines) {
    if (/\bspec\b|contract/i.test(line)) {
      for (const m of line.matchAll(/\*\*(\d+(?:\.\d+)*)\b[^*]*\*\*/g)) specSections.push(m[1]);
      for (const m of line.matchAll(/(?<![\w-])([a-z]+(?:-[a-z]+)+)\s+(\d+(?:\.\d+)*)\b/g)) {
        if (m[1] !== 'threat-model') contracts.push(`${m[1]} ${m[2]}`);
      }
      // g57: 68 of 73 Memory Agent briefs wrote "Spec: 6.1, 6.6; storage-schema.md 4" and their packs went out without
      // the spec; a file name (contracts/x.md 4) and a plain number after "Spec:" count too
      for (const m of line.matchAll(/(?<![\w-])(?:contracts\/)?([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.md\s+(\d+(?:\.\d+)*)\b/g)) {
        if (m[1] !== 'threat-model') contracts.push(`${m[1]} ${m[2]}`);
      }
      const label = /^\s*[-*]?\s*spec\s*:(.*)/i.exec(line);
      if (label) {
        for (const part of label[1].split(/[;,]/)) {
          const n = /^\s*(\d+(?:\.\d+)*)\b/.exec(part);
          if (n) specSections.push(n[1]);
        }
      }
    }
    const t = /threat-model\s+([^;\n]*)/i.exec(line);
    if (t) for (const m of t[1].matchAll(/\b([A-Z]\d{1,3})\b/g)) threats.push(m[1]);
  }
  return {
    specSections: uniq(specSections),
    contracts: uniq(contracts).map((c) => { const [name, section] = c.split(' '); return { name, section }; }),
    threats: uniq(threats),
    decisions: uniq([...text.matchAll(/\bD-\d{3}\b/g)].map((m) => m[0])),
  };
}
