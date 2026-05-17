#!/usr/bin/env node
// Drive the chain past Stage 2 (call) without ringing the phone.
// Usage:  node scripts/drive-cascade.mjs <stage>  (stage = call|email|sms|all)

import fs from "fs";
import path from "path";

const runId = fs.readFileSync("/tmp/run-id", "utf-8").trim();
const stage = process.argv[2] ?? "all";
const BASE = "http://localhost:3000";

async function post(p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text().then(t => { try { return JSON.parse(t); } catch { return t; } }) };
}

async function completeCall() {
  // Locate the call_id from agentphone.json
  const ptr = JSON.parse(fs.readFileSync(`store/runs/${runId}/agentphone.json`, "utf-8"));
  const callId = ptr.call_ids?.find(id => !id.startsWith("init_") && !id.startsWith("error_")) ?? `synthetic_${Date.now()}`;
  console.log(`call_id = ${callId}`);
  const r = await post("/api/webhooks/agentphone", {
    type: "call.completed",
    call_id: callId,
    status: "completed",
    duration_sec: 240,
    transcript: [
      { turn: "agent", text: "Hi, this is Crovi calling on behalf of NovaCure about the procurement intake we just submitted on your portal — we got a waitlist response and wanted to verify a few things directly. Got two minutes?", timestamp: new Date().toISOString() },
      { turn: "supplier", text: "Yes, go ahead.", timestamp: new Date().toISOString() },
      { turn: "agent", text: "Can you confirm 150 plasma samples at 2 mL minimum, with matched FFPE blocks or 10 unstained slides, baseline pre-treatment, with matched normals?", timestamp: new Date().toISOString() },
      { turn: "supplier", text: "Yes, we can source 150 plasma at 2 mL with matched FFPE blocks. Matched normals confirmed via peripheral WBC.", timestamp: new Date().toISOString() },
      { turn: "agent", text: "What's your breakdown across EGFR, KRAS, and ALK in the treatment-naive Stage III-IV NSCLC pool?", timestamp: new Date().toISOString() },
      { turn: "supplier", text: "Roughly 55% EGFR, 30% KRAS, 15% ALK in our current pool.", timestamp: new Date().toISOString() },
      { turn: "agent", text: "Do you ship de-identified with pathology reports and CAP/CLIA-aligned SOP documentation?", timestamp: new Date().toISOString() },
      { turn: "supplier", text: "Yes, de-identified by default. We provide CAP/CLIA pathology and full SOPs.", timestamp: new Date().toISOString() },
      { turn: "agent", text: "Great. Based on the market, we're targeting around $188K to $240K total for this scope. Workable?", timestamp: new Date().toISOString() },
      { turn: "supplier", text: "Yes, that range works on our side.", timestamp: new Date().toISOString() },
      { turn: "agent", text: "I'll send the full spec and quote in writing within the hour. Thank you.", timestamp: new Date().toISOString() },
    ],
    completed_at: new Date().toISOString(),
  });
  console.log("call.completed →", r.status, JSON.stringify(r.body).slice(0, 200));
}

async function emailReply() {
  // Real-mode sends don't write to outbox; thread_id lives in the
  // chain.json email event payload instead.
  let threadId = null;
  const chain = JSON.parse(fs.readFileSync(`store/runs/${runId}/chain.json`, "utf-8"));
  for (const e of chain.stages.email.events) {
    if (e.payload?.thread_id) { threadId = e.payload.thread_id; break; }
  }
  if (!threadId) {
    // fallback to outbox (stub mode)
    const outboxDir = `store/runs/${runId}/outbox/email`;
    if (fs.existsSync(outboxDir)) {
      for (const f of fs.readdirSync(outboxDir)) {
        const e = JSON.parse(fs.readFileSync(path.join(outboxDir, f), "utf-8"));
        if (e.thread_id) { threadId = e.thread_id; break; }
      }
    }
  }
  if (!threadId) {
    console.error("no thread_id found — Stage 3 may not have fired");
    return;
  }
  console.log(`thread_id = ${threadId}`);
  const r = await post("/api/webhooks/agentmail", {
    message: {
      message_id: `sim_reply_${Date.now()}`,
      thread_id: threadId,
      from: "crovi@agentmail.to",
      to: "bd@crovi.bio",
      subject: "Re: Crovi.bio × NovaCure — Filled Intake + Quote",
      extracted_text: "I agree — please proceed with the SOW.",
      received_at: new Date().toISOString(),
    },
  });
  console.log("agentmail reply →", r.status, JSON.stringify(r.body).slice(0, 200));
}

async function smsConfirmed() {
  const ptr = JSON.parse(fs.readFileSync(`store/runs/${runId}/agentphone.json`, "utf-8"));
  const buyerPhone = ptr.buyer_phone;
  const r = await post("/api/webhooks/agentphone", {
    type: "sms.received",
    sms_id: `sim_sms_${Date.now()}`,
    from: buyerPhone,
    to: process.env.AGENTPHONE_PHONE_NUMBER ?? "+13187228385",
    body: "CONFIRMED — legally binding",
    received_at: new Date().toISOString(),
  });
  console.log("sms.received CONFIRMED →", r.status, JSON.stringify(r.body).slice(0, 200));
}

async function wait(s) { return new Promise(r => setTimeout(r, s * 1000)); }

if (stage === "call" || stage === "all") {
  await completeCall();
  if (stage === "all") await wait(3);
}
if (stage === "email" || stage === "all") {
  await emailReply();
  if (stage === "all") await wait(3);
}
if (stage === "sms" || stage === "all") {
  await smsConfirmed();
}
