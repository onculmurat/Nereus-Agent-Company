#!/usr/bin/env node
// PostToolUse(SendMessage): copies every live text message into team/work/mailbox so nothing depends
// on an agent remembering. Field paths verified in docs/spike/2026-10-18-spike-results.md.
import { runHook } from '../scripts/lib/hookio.js';
import { writeMessage, parseHeader, isValidThread, isValidRole } from '../scripts/lib/mailbox.js';

const recipient = (to) => (to === 'main' ? 'team-lead' : to === '*' ? 'all' : to);
// A malformed role name must not lose the record: it is stored as "unknown".
const role = (name) => (isValidRole(name) ? name : 'unknown');

runHook(async (payload, root) => {
  const input = payload.tool_input ?? {};
  if (typeof input.message !== 'string' || typeof input.to !== 'string') return;
  const header = parseHeader(input.message);
  writeMessage(root, {
    id: payload.tool_use_id,
    from: role(header.from ?? (payload.agent_id ? 'unknown' : 'team-lead')),
    to: role(recipient(input.to)),
    thread: isValidThread(header.thread) ? header.thread : 'general',
    body: header.rest,
    // The live message was already delivered by SendMessage; the copy is the record, not a new delivery.
    state: 'read',
  });
});
