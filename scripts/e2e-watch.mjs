#!/usr/bin/env node
// scripts/e2e-watch.mjs — live cockpit for an E2E chain run.
//
// Polls store/runs/<runId>/chain.json every 2s and prints a compact
// dashboard: stage status, event count, latest event text, what to do
// next on your phone. Stops automatically when meeting is terminal or
// after MAX_WATCH_MS.
//
// Usage:
//   node scripts/e2e-watch.mjs <runId>
//   node scripts/e2e-watch.mjs            # uses /tmp/run-id

import fs from "fs";
import path from "path";

const runId = process.argv[2] ?? (fs.existsSync("/tmp/run-id") ? fs.readFileSync("/tmp/run-id", "utf-8").trim() : null);
if (!runId) {
  console.error("usage: node scripts/e2e-watch.mjs <runId>");
  process.exit(1);
}
const chainFile = path.join("store", "runs", runId, "chain.json");
const POLL_MS = 2000;
const MAX_WATCH_MS = 15 * 60 * 1000;

const STAGE_LABEL = {
  form: "FORM",
  call: "CALL",
  email: "EMAIL",
  sms_pay: "SMS+PAY",
  meeting: "MEETING",
};

const STATUS_ICON = {
  locked: "🔒",
  ready: "⏳",
  in_progress: "▶️ ",
  complete: "✅",
  fallback: "↻ ",
  failed: "❌",
};

const NEXT_ACTION = {
  call: "📞 ANSWER YOUR PHONE — Crovi-AI is calling",
  email: "📧 OPEN crovi@agentmail.to + reply 'I agree' to the thread",
  sms_pay: "💬 REPLY 'CONFIRMED' to the SMS on your phone",
  meeting: "📅 Notion calendar booking running in the background…",
};

let lastSig = "";
const startedAt = Date.now();
console.log(`watching ${chainFile}`);
console.log("─".repeat(72));

const tick = () => {
  if (Date.now() - startedAt > MAX_WATCH_MS) {
    console.log("\n(max watch duration reached; exiting)");
    process.exit(0);
  }
  if (!fs.existsSync(chainFile)) {
    process.stdout.write(`\rwaiting for ${chainFile}…`);
    return;
  }
  let chain;
  try {
    chain = JSON.parse(fs.readFileSync(chainFile, "utf-8"));
  } catch {
    return;
  }
  // Signature = stage statuses + event counts, so we only redraw on change.
  const sig = Object.entries(chain.stages)
    .map(([s, st]) => `${s}:${st.status}:${st.events.length}`)
    .join("|");
  if (sig === lastSig) return;
  lastSig = sig;

  // Clear + redraw.
  console.clear();
  console.log(`run: ${runId}`);
  console.log(`elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log("─".repeat(72));

  let activeStage = null;
  for (const stage of ["form", "call", "email", "sms_pay", "meeting"]) {
    const s = chain.stages[stage];
    const icon = STATUS_ICON[s.status] ?? "  ";
    const label = STAGE_LABEL[stage].padEnd(7);
    const evs = s.events.length;
    const last = s.events.length > 0 ? s.events[s.events.length - 1] : null;
    const lastText = last ? `· ${(last.text ?? "").slice(0, 60)}` : "";
    console.log(`  ${icon} ${label}  [${s.status.padEnd(11)}]  ${evs} ev  ${lastText}`);
    if (s.status === "in_progress" && !activeStage) activeStage = stage;
  }

  console.log("─".repeat(72));
  if (activeStage && NEXT_ACTION[activeStage]) {
    console.log(`  ${NEXT_ACTION[activeStage]}`);
  } else if (chain.stages.meeting.status === "complete" || chain.stages.meeting.status === "fallback") {
    console.log("  🎉 chain reached terminal — check your calendar");
    setTimeout(() => process.exit(0), 2000);
  } else if (chain.stages.meeting.status === "failed") {
    console.log("  ⚠  chain failed at meeting — inspect chain.json");
    setTimeout(() => process.exit(0), 2000);
  } else {
    console.log("  (waiting for stage transition)");
  }
};

const interval = setInterval(tick, POLL_MS);
tick();
process.on("SIGINT", () => {
  clearInterval(interval);
  process.exit(0);
});
