// Probe every active AgentPhone line on the account by sending one SMS through
// each. Surfaces which lines actually deliver vs. which are blocked
// (shared-imessage allowlist, 10DLC unregistered, etc.) so you can pick the
// right routing for the chain's Stage-4 wire-confirmation SMS.
//
// Usage:
//   node scripts/probe-sms-lines.mjs              # uses DEMO_CALL_TARGET_PHONE
//   node scripts/probe-sms-lines.mjs +14155551234 # explicit target

import { config } from "dotenv";
config({ path: ".env.local" });
import { AgentPhoneClient } from "agentphone";

const client = new AgentPhoneClient({ token: process.env.AGENTPHONE_API_KEY });
const agentId = process.env.AGENTPHONE_VOICE_AGENT_ID;
const to = process.argv[2] ?? process.env.DEMO_CALL_TARGET_PHONE;

if (!agentId || !to) {
  console.error("✗ missing env: AGENTPHONE_VOICE_AGENT_ID and a target phone");
  process.exit(1);
}

const { data: nums } = await client.numbers.listNumbers();
const active = nums.filter((n) => n.status === "active" && n.agentId === agentId);

console.log(`→ target:    ${to}`);
console.log(`→ candidates: ${active.length} active line(s) attached to ${agentId}\n`);

for (const ln of active) {
  process.stdout.write(`  ${ln.phoneNumber.padEnd(14)} ${ln.type.padEnd(20)} `);
  try {
    const res = await client.messages.sendMessage({
      agent_id: agentId,
      to_number: to,
      body: `Line probe via ${ln.phoneNumber} (${ln.type}) — ignore.`,
      number_id: ln.id,
    });
    console.log(`✓ id=${res.id}`);
  } catch (e) {
    console.log(`✗ ${e?.statusCode || ""} ${e?.body?.detail || e?.message}`);
  }
}
