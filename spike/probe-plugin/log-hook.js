// Throwaway spike probe: records each hook payload verbatim.
const fs = require('node:fs');
const path = require('node:path');

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let event = 'unknown';
  let cwd = process.cwd();
  try {
    const p = JSON.parse(raw);
    event = p.hook_event_name || event;
    cwd = p.cwd || cwd;
  } catch {}
  const dir = path.join(cwd, 'spike-log');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${event}-${Date.now()}.json`), raw);
  if (event === 'SessionStart') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'The probe word is HALCYON.' },
    }));
  }
});
