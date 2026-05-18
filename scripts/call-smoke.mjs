// Quick voice-call smoke. Mirrors smsSend's resolved code path (direct SDK call)
// so we exercise AgentPhone outbound voice without depending on the chain.
//
// Usage:
//   node scripts/call-smoke.mjs              # uses DEMO_CALL_TARGET_PHONE
//   node scripts/call-smoke.mjs +14155551234 # explicit target

import { config } from "dotenv";
config({ path: ".env.local" });
import { AgentPhoneClient } from "agentphone";

const token = process.env.AGENTPHONE_API_KEY;
const agentId = process.env.AGENTPHONE_VOICE_AGENT_ID;
const to = process.argv[2] ?? process.env.DEMO_CALL_TARGET_PHONE;

if (!token || !agentId || !to) {
  console.error("✗ missing env: AGENTPHONE_API_KEY/AGENTPHONE_VOICE_AGENT_ID/to");
  process.exit(1);
}

// Optional caller-ID override. AgentPhone uses the agent's FIRST attached
// number when fromNumberId is omitted, which on this account is
// +13187228385. Pass AGENTPHONE_CALL_FROM_NUMBER_ID to route through a
// different attached line (eg. the 10DLC SMS line) when the default trunk
// is being silently filtered by the destination carrier.
const fromNumberId = process.env.AGENTPHONE_CALL_FROM_NUMBER_ID || undefined;

console.log("→ to:        ", to);
console.log("→ agent_id:  ", agentId);
console.log("→ from_id:   ", fromNumberId ?? "(default — agent's first attached number)");

const client = new AgentPhoneClient({ token });
const t0 = Date.now();
try {
  const res = await client.calls.createOutboundCall({
    agentId,
    toNumber: to,
    ...(fromNumberId ? { fromNumberId } : {}),
  });
  console.log(`← +${Date.now() - t0}ms ✓ placed`);
  console.log(JSON.stringify(res, null, 2));
} catch (e) {
  console.log(`← +${Date.now() - t0}ms ✗`, e?.statusCode, e?.body?.detail || e?.message);
  process.exit(2);
}
