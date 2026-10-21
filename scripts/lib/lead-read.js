// g48: the lead read source files and large outputs itself; its context filled fast and auto-compaction thrashed.
// Reading code is the roles' job. The lead may read a short slice (Read with a small limit), never a whole source
// file or a large file.
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = /\.(rs|ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|rb|php|scala|sql|vue|svelte|dart|lua|sh|ps1)$/i;
export const SLICE_LINES = 120;
export const LARGE_BYTES = 40000;

export function checkLeadRead(input, root, { size = statSize } = {}) {
  const file = input?.file_path;
  if (typeof file !== 'string' || !file) return undefined;
  const limit = Number(input.limit);
  if (Number.isFinite(limit) && limit > 0 && limit <= SLICE_LINES) return undefined;
  const abs = path.resolve(root, file);
  const name = path.relative(root, abs) || file;
  if (SOURCE.test(abs)) {
    return { block: `NAC lead read guard (g48): ${name} is source code. The lead does not read code: hand it to the owning role in a pack, or read a slice of at most ${SLICE_LINES} lines (Read with offset and limit) when a finding names a line.` };
  }
  const bytes = size(abs);
  if (bytes > LARGE_BYTES) {
    return { block: `NAC lead read guard (g48): ${name} is ${Math.round(bytes / 1000)} KB. Read a slice of at most ${SLICE_LINES} lines (offset and limit) or search it with Grep; long command output goes to a file and you read its tail or a summary.` };
  }
  return undefined;
}

function statSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
