#!/usr/bin/env node
// Seed Supermemory with a few fake prior memories for crovi_bio so the
// dashboard isn't empty + the demo's pre-Stage-1 recall has hits to show.
//
// Usage: node scripts/seed-supermemory.mjs
//
// Safe to re-run — adds new memories each time (doesn't dedupe).

import fs from "fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf-8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).split(" #")[0].trim()];
    }),
);
const API_KEY = env.SUPERMEMORY_API_KEY;
if (!API_KEY) { console.error("SUPERMEMORY_API_KEY missing"); process.exit(1); }

const { default: Supermemory } = await import("supermemory");
const c = new Supermemory({ apiKey: API_KEY });

const PRIOR_RUN = "novacure-Q2-2026-001";
const MEMORIES = [
  {
    content: `[run ${PRIOR_RUN} · call cmp-prior-call-1] Q: Can you confirm 200 plasma cases plus 100 matched FFPE blocks, Stage III-IV NSCLC, baseline pre-treatment? A: Yes, we sourced 200 plasma at 2mL minimum with matched FFPE blocks. Matched normals confirmed via peripheral WBC, paired per case.`,
    metadata: { run_id: PRIOR_RUN, kind: "qa_pair", channel: "call", supplier_id: "crovi_bio" },
  },
  {
    content: `[run ${PRIOR_RUN} · call cmp-prior-call-1] Q: What's your breakdown across EGFR, KRAS, and ALK in the treatment-naive pool? A: Roughly 55% EGFR-positive, 30% KRAS-positive, 15% ALK in our current Stage III-IV NSCLC pool.`,
    metadata: { run_id: PRIOR_RUN, kind: "qa_pair", channel: "call", supplier_id: "crovi_bio" },
  },
  {
    content: `[run ${PRIOR_RUN} · call cmp-prior-call-1] Q: Do you ship de-identified with pathology reports and CAP/CLIA SOPs? A: Yes, de-identified by default. Full CAP/CLIA-aligned pathology reports and SOP documentation included.`,
    metadata: { run_id: PRIOR_RUN, kind: "qa_pair", channel: "call", supplier_id: "crovi_bio" },
  },
  {
    content: `[run ${PRIOR_RUN} · call cmp-prior-call-1] Stage-2 call complete · 218s · 5 agent turns · 5 supplier turns · status=completed`,
    metadata: { run_id: PRIOR_RUN, kind: "call_summary", channel: "call", supplier_id: "crovi_bio", duration_sec: 218 },
  },
  {
    content: `[run ${PRIOR_RUN}] Procurement chain completed for crovi_bio. Outcomes: call=ok email=agreed sms_pay=settled $10 meeting=booked. Scope: 200 plasma + 100 FFPE, Stage III-IV NSCLC, budget $230K — locked at $830/plasma + $1150/FFPE.`,
    metadata: { run_id: PRIOR_RUN, kind: "chain_completion", supplier_id: "crovi_bio" },
  },
];

console.log(`Seeding ${MEMORIES.length} memories under containerTag=supplier:crovi_bio…\n`);
for (const m of MEMORIES) {
  try {
    const r = await c.documents.add({
      content: m.content,
      containerTag: "supplier:crovi_bio",
      metadata: m.metadata,
    });
    console.log(`  ✓ ${(m.content || "").slice(0, 80)}…  id=${r.id || r.documentId || "?"}`);
  } catch (e) {
    console.log(`  ✗ ${(e.message || "").slice(0, 120)}`);
  }
}
console.log("\nDone. Verify at https://app.supermemory.ai");
