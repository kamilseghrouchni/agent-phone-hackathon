// Standalone smoke for the AgentPhone call leg.
//
// Why: the chain stalls if Stage 2 silently fails on the wire. This script
// exercises callOut directly so we can isolate "AgentPhone broken" from
// "chain wiring broken".
//
// Usage:
//   node --experimental-strip-types scripts/test-call.mts                  # uses DEMO_CALL_TARGET_PHONE
//   node --experimental-strip-types scripts/test-call.mts +14155551234     # explicit target

import { config } from "dotenv";
config({ path: ".env.local" });

import { callOut } from "../lib/integrations/agentphone.ts";

const to = process.argv[2] ?? process.env.DEMO_CALL_TARGET_PHONE;
const voiceAgentId = process.env.AGENTPHONE_VOICE_AGENT_ID;

if (!to) {
  console.error("✗ no target phone — pass an E.164 number or set DEMO_CALL_TARGET_PHONE");
  process.exit(1);
}
if (!voiceAgentId) {
  console.error("✗ AGENTPHONE_VOICE_AGENT_ID missing in .env.local");
  process.exit(1);
}

console.log(`→ calling ${to} via agent ${voiceAgentId.slice(0, 12)}…`);
const t0 = Date.now();
const result = await callOut(to, voiceAgentId, {
  buyer: { company: "Test", contact: "Smoke", study: "standalone" },
  supplier: { id: "smoke", name: "Test" },
});
console.log(`← result +${Date.now() - t0}ms:`, JSON.stringify(result, null, 2));

if (result.status === "failed") {
  console.error("✗ call failed:", result.error ?? "unknown");
  process.exit(2);
}
console.log(`✓ call placed (call_id=${result.call_id}, status=${result.status})`);
console.log("Phone should ring shortly. Pick up to verify audio + voice agent.");
