// Standalone smoke for the AgentPhone SMS leg (Stage 4 outbound).
//
// Sends the canonical down-payment-authorization SMS to the target phone
// so we can isolate "SMS leg broken" from "chain wiring broken".
//
// Usage:
//   node --experimental-strip-types scripts/test-sms.mts                  # uses DEMO_CALL_TARGET_PHONE
//   node --experimental-strip-types scripts/test-sms.mts +14155551234     # explicit target
//   SMS_STUB_MODE=true node --experimental-strip-types scripts/test-sms.mts   # forces stub (no real send)

import { config } from "dotenv";
config({ path: ".env.local" });

import { smsSend } from "../lib/integrations/agentphone.ts";

const to = process.argv[2] ?? process.env.DEMO_CALL_TARGET_PHONE;
const body =
  process.env.SMS_TEST_BODY ??
  "Crovi.bio test SMS — reply CONFIRMED to authorize $0.50 goodwill down payment. (Standalone smoke — ignore.)";

if (!to) {
  console.error("✗ no target phone — pass an E.164 number or set DEMO_CALL_TARGET_PHONE");
  process.exit(1);
}

console.log(`→ sending SMS to ${to}`);
console.log(`  body: ${body}`);
const t0 = Date.now();
const result = await smsSend(to, body);
console.log(`← result +${Date.now() - t0}ms:`, JSON.stringify(result, null, 2));

if (result.error) {
  console.error("✗ sms failed:", result.error);
  process.exit(2);
}
console.log(
  `✓ sms ${result.mode === "real" ? "sent on the wire" : "stubbed"} (sms_id=${result.sms_id})`,
);
if (result.mode === "real") {
  console.log("Phone should buzz shortly. Reply CONFIRMED to test inbound webhook.");
}
