// Exercises lib/integrations/sponge.ts createDownPayment end-to-end.
// Fires a real $0.10 USDC transfer SENDER → RECEIVER on Solana through the
// same code path the chain's Stage 4 will use. Settles in 10-30s.
//
// Run: npx tsx scripts/test-sponge-integration.mts

import { createDownPayment, spongeConfigured, defaultFromWallet, defaultToWallet } from "../lib/integrations/sponge.ts";

// Pre-stage a minimal chain.json so createDownPayment's readChain finds state
// and writes the settled event into it (otherwise the function quietly skips
// the event write but the on-chain transfer still fires).
import fs from "node:fs";
import path from "node:path";

const RUN_ID = `sponge-test-${Date.now()}`;
const RUN_DIR = path.join(process.cwd(), "store", "runs", RUN_ID);
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.writeFileSync(path.join(RUN_DIR, "intake.json"), JSON.stringify({ run_id: RUN_ID, fields: [] }));
fs.writeFileSync(
  path.join(RUN_DIR, "chain.json"),
  JSON.stringify({
    run_id: RUN_ID,
    supplier_id: "crovi_bio",
    stages: {
      form:    { status: "complete", events: [] },
      call:    { status: "complete", events: [] },
      email:   { status: "complete", events: [] },
      sms_pay: { status: "in_progress", events: [] },
      meeting: { status: "locked", events: [] },
    },
    evidence_added: [],
  }, null, 2),
);

console.log(`run dir: ${RUN_DIR}`);
console.log(`configured: ${spongeConfigured()}`);
console.log(`from: ${defaultFromWallet()}`);
console.log(`to:   ${defaultToWallet()}`);
console.log("");
console.log("firing $0.10 USDC test transfer via createDownPayment...");

const t0 = Date.now();
const r = await createDownPayment({ runId: RUN_ID, supplierId: "crovi_bio", amountCents: 10 });
const ms = Date.now() - t0;

console.log("");
console.log(`result (+${ms}ms):`, JSON.stringify(r, null, 2));

if (r.ok) {
  // Re-read chain.json to see the event payload (with solscanUrl + txHash)
  const chain = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "chain.json"), "utf-8"));
  const evt = chain.stages.sms_pay.events[chain.stages.sms_pay.events.length - 1];
  console.log("");
  console.log("settled event:");
  console.log(`  text:    ${evt?.text}`);
  console.log(`  txHash:  ${evt?.payload?.txHash}`);
  console.log(`  solscan: ${evt?.payload?.solscanUrl}`);
  console.log(`  chain:   ${evt?.payload?.chain}`);
}
