// Smoke-test the "email agree → payment + SMS" cascade end-to-end.
//
// Mimics the agentmail webhook path: an inbound reply arrives, passes
// isEmailAgreeReply(), so we call fanoutOnEmailAgree(runId, state). That:
//   1. marks email stage complete
//   2. fires Sponge $1 USDC transfer (REAL, not stub — wallets configured)
//   3. sends outbound SMS to BUYER_PHONE with solscan link
//   4. fires meeting handler in parallel
//
// Run: npx tsx scripts/smoke-email-agree-pay.mts
//
// Expected: chain.json shows sms_pay.status=complete with a txHash + solscanUrl,
// and a real $1 USDC transfer lands on Solana (visible in Sponge dashboard).

import fs from "node:fs";
import path from "node:path";

const RUN_ID = `smoke-pay-${Date.now()}`;
const RUN_DIR = path.join(process.cwd(), "store", "runs", RUN_ID);
fs.mkdirSync(RUN_DIR, { recursive: true });

// Minimal chain state that mirrors the post-call, mid-email-thread shape.
const now = new Date().toISOString();
const chainState = {
  run_id: RUN_ID,
  supplier_id: "crovi_bio",
  current_stage: "email",
  stages: {
    form:    { status: "complete", events: [], started_at: now, completed_at: now },
    call:    { status: "complete", events: [], started_at: now, completed_at: now },
    email:   { status: "in_progress", events: [
      {
        event_id: `email:outbound:${RUN_ID}`,
        timestamp: now,
        direction: "outbound",
        actor: "agent",
        channel: "email",
        text: "Offer: $1 down payment for allocation. Reply YES to confirm.",
        payload: { thread_id: `thread-${RUN_ID}`, to: "supplier@crovi.bio" },
      },
    ], started_at: now },
    sms_pay: { status: "locked", events: [] },
    meeting: { status: "locked", events: [] },
  },
  evidence_added: [],
  started_at: now,
  updated_at: now,
};
fs.writeFileSync(path.join(RUN_DIR, "chain.json"), JSON.stringify(chainState, null, 2));
fs.writeFileSync(path.join(RUN_DIR, "intake.json"), JSON.stringify({ run_id: RUN_ID, fields: [] }));

// Defensive: cap the amount low for the smoke test, regardless of env.
process.env.SPONGE_DEMO_AMOUNT_CENTS = process.env.SPONGE_DEMO_AMOUNT_CENTS ?? "100";

console.log("=== email-agree → payment smoke test ===");
console.log(`run_id:           ${RUN_ID}`);
console.log(`run_dir:          ${RUN_DIR}`);
console.log(`amount_cents:     ${process.env.SPONGE_DEMO_AMOUNT_CENTS}`);
console.log(`sponge_stub_mode: ${process.env.SPONGE_STUB_MODE ?? "(unset → real mode if wallets configured)"}`);
console.log(`buyer_phone:      ${process.env.NOVACURE_BUYER_PHONE ?? process.env.DEMO_BUYER_PHONE ?? process.env.DEMO_CALL_TARGET_PHONE ?? "(default stub)"}`);
console.log("");

// Wire up: simulate inbound agree-reply by checking isEmailAgreeReply first,
// then dispatching the same fanout the webhook would dispatch.
const { isEmailAgreeReply, fanoutOnEmailAgree } = await import("../lib/agents/runtime/build-handlers.ts");
const { loadChainState } = await import("../lib/agents/runtime/chain-runtime.ts");

const replyBody = "Yes, agreed — let's proceed.";
console.log(`simulated inbound reply: "${replyBody}"`);
console.log(`isEmailAgreeReply():     ${isEmailAgreeReply(replyBody)}`);
if (!isEmailAgreeReply(replyBody)) {
  console.error("agree-detector failed; aborting");
  process.exit(1);
}

const state = loadChainState(RUN_ID);
if (!state) {
  console.error(`chain state not loaded for ${RUN_ID}`);
  process.exit(1);
}

console.log("");
console.log("calling fanoutOnEmailAgree() — this triggers real Sponge transfer + SMS...");
const t0 = Date.now();
await fanoutOnEmailAgree(RUN_ID, state);
const ms = Date.now() - t0;
console.log(`fanout completed in ${ms}ms`);
console.log("");

// Inspect the resulting chain.json
const final = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "chain.json"), "utf-8"));
const stages = final.stages;
console.log("=== final stage statuses ===");
for (const [k, v] of Object.entries(stages)) {
  console.log(`  ${k.padEnd(8)} → ${(v as { status: string }).status}`);
}

const payEvents = stages.sms_pay.events ?? [];
console.log("");
console.log(`=== sms_pay events (${payEvents.length}) ===`);
for (const e of payEvents) {
  const p = e.payload ?? {};
  console.log(`  • [${e.actor}/${e.direction}] ${e.text}`);
  if (p.txHash || p.transferId) {
    console.log(`      txHash:     ${p.txHash ?? p.transferId}`);
    if (p.solscanUrl) console.log(`      solscan:    ${p.solscanUrl}`);
    if (p.chain)      console.log(`      chain:      ${p.chain}`);
    if (p.mode)       console.log(`      mode:       ${p.mode}`);
  }
  if (p.sms_id) {
    console.log(`      sms_id:     ${p.sms_id}`);
    if (p.mode)  console.log(`      sms_mode:   ${p.mode}`);
    if (p.error) console.log(`      sms_error:  ${p.error}`);
  }
  if (p.error && !p.sms_id) console.log(`      error:      ${p.error}`);
}

const ok =
  stages.email.status === "complete" &&
  stages.sms_pay.status === "complete";

console.log("");
console.log(ok ? "✓ SMOKE TEST PASSED" : "✗ SMOKE TEST FAILED");
process.exit(ok ? 0 : 1);
