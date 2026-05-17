// Smoke test for the DAS runtime. Exercises the LLM-free paths end-to-end:
//   - Slot resolver against a real context
//   - Builder renders the introduce_request utterance
//   - ReasoningLog write + read + cross-channel query + prior-by-action
//
// The LLM-bound paths (Planner with multi-candidate, Extractor) are
// exercised when wired into the API routes — they need an API key and
// are not part of the structural smoke.
//
//   npx tsx scripts/smoke-runtime.ts

import path from "path";
import fs from "fs";
import { loadActionSpace, findAction } from "../src/lib/agents/action-spaces/loader";
import { buildAction } from "../src/lib/agents/runtime/builder";
import { runPlanner } from "../src/lib/agents/runtime/planner";
import {
  appendRecord,
  listRecords,
  queryCrossChannel,
  priorByAction,
} from "../src/lib/agents/runtime/reasoning-log";
import type { ResolveContext } from "../src/lib/agents/runtime/slot-resolver";
import type { ParsedQuery } from "../src/types/parsed-query";
import type { BiobankOpportunity } from "../src/types/biobank";
import type { ActionReasoningLog } from "../src/types/action-log";

const TMP_RUN = path.join(process.cwd(), "store/runs/smoke-runtime");
fs.rmSync(TMP_RUN, { recursive: true, force: true });
fs.mkdirSync(TMP_RUN, { recursive: true });

const parsedQuery: ParsedQuery = {
  diseases: ["NSCLC"],
  stages: ["III", "IV"],
  treatment_status: "naive",
  specimens: [
    { type: "plasma", n_cases: 150, min_volume_mL: 2 },
    { type: "FFPE block", n_cases: 75 },
  ],
  biomarkers: ["EGFR", "KRAS", "ALK"],
  turnaround_max_weeks: 8,
  use_case: "biomarker validation cohort for late-stage NSCLC drug program",
  raw_query: "150 plasma + 75 FFPE NSCLC stage III/IV, treatment-naive",
};

const geneticist: BiobankOpportunity = {
  id: "geneticist",
  name: "Geneticist",
  contact: {
    bd_name: "Vera",
    email: "Vera@geneticist.net",
    phone: "(818) 662-6927",
    site_url: "https://geneticist.net",
  },
  reported: { conditions: ["NSCLC", "CRC"], sample_types: ["FFPE", "plasma"] },
  source_evidence: [{ url: "https://geneticist.net", scraped_at: new Date().toISOString(), snippet: "..." }],
  audit_state: "pending",
};

const refmed: BiobankOpportunity = {
  id: "refmed",
  name: "Reference Medicine",
  contact: { bd_name: "Sarah", email: "hello@referencemedicine.com", site_url: "https://referencemedicine.com" },
  reported: {
    conditions: ["NSCLC", "Breast", "CRC"],
    sample_types: ["FFPE", "plasma", "frozen tissue"],
    public_xlsx_url: "store/inventory/refmed_2026-05.xlsx",
  },
  source_evidence: [],
  audit_state: "pending",
};

const ctx: ResolveContext = {
  parsed_query: parsedQuery,
  supplier: geneticist,
  prior: {},
  cross_channel: {},
  agent_identity: {
    name: "Alex Carter",
    email: "agents@crovi.bio",
    phone: "+15555550100",
    company: "Crovi BD",
    country: "USA",
  },
  state: { run_id: "smoke-runtime" },
};

let failed = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
// 1. ActionSpace loads + introduce_request exists.
const callSpace = loadActionSpace("call");
expect("call action space loads", callSpace.actions.length >= 8);
const introduce = findAction("call", "introduce_request");
expect("introduce_request defined", introduce !== undefined);

// 2. Builder renders the introduce_request template with real slot values.
if (introduce) {
  const built = buildAction(introduce, ctx);
  expect("builder returns utterance kind", built.kind === "utterance");
  if (built.kind === "utterance") {
    console.log(`\n  ↳ rendered utterance:\n${built.text.split("\n").map((l) => "    " + l).join("\n")}\n`);
    expect("utterance mentions Vera", built.text.includes("Vera"));
    expect("utterance mentions agent name (Alex Carter)", built.text.includes("Alex Carter"));
    expect("utterance has the 150 case count", built.text.includes("150"));
    expect("utterance has primary specimen 'plasma'", built.text.includes("plasma"));
    expect("utterance has primary disease (Nsclc — title-cased)", built.text.includes("Nsclc"));
    expect("no unresolved {placeholder} left", !/\{[a-zA-Z_]+\}/.test(built.text), built.text);
  }
}

// 3. Planner with empty priors returns introduce_request without LLM (single-candidate path).
console.log("\nPlanner — empty prior, single-candidate fast path:");
const pick1 = await runPlanner({
  channel: "call",
  parsed_query: parsedQuery,
  supplier: geneticist,
  priorActions: [],
  crossChannelEvidence: [],
  infoNeeds: ["price_per_case_usd", "biomarker_breakdown", "turnaround_weeks"],
  questions_remaining: 5,
});
expect("planner picks introduce_request from empty state", pick1.action_id === "introduce_request");
console.log(`  reasoning: ${pick1.reasoning}`);

// 4. ReasoningLog write + listRecords roundtrip.
console.log("\nReasoningLog roundtrip:");
const record1: ActionReasoningLog = {
  id: "r1",
  run_id: "smoke-runtime",
  supplier_id: "geneticist",
  channel: "call",
  action_id: "introduce_request",
  timestamp: new Date().toISOString(),
  reasoning: "opening turn",
  inputs: {},
  output: {},
  cross_channel_refs: [],
  success: true,
};
await appendRecord(TMP_RUN, record1);

const record2: ActionReasoningLog = {
  id: "r2",
  run_id: "smoke-runtime",
  supplier_id: "geneticist",
  channel: "call",
  action_id: "ask_availability",
  timestamp: new Date(Date.now() + 1).toISOString(),
  reasoning: "confirming presence",
  inputs: {},
  output: {
    availability_confirmed: { value: true, evidence_quote: "Yes we have NSCLC plasma" },
    estimated_n_available: { value: 50, evidence_quote: "About 50 cases" },
  },
  cross_channel_refs: [],
  success: true,
};
await appendRecord(TMP_RUN, record2);

const back = await listRecords(TMP_RUN);
expect("two records persisted", back.length === 2);
expect("first record is introduce_request", back[0].action_id === "introduce_request");

// 5. priorByAction flattens the output.
const prior = await priorByAction({ runDir: TMP_RUN, supplierId: "geneticist", channel: "call" });
expect("prior contains ask_availability", "ask_availability" in prior);
expect(
  "prior.ask_availability.estimated_n_available is unwrapped to 50",
  prior.ask_availability?.estimated_n_available === 50,
);

// 6. Planner with a prior introduce_request → multi-candidate, will hit LLM.
//    Skip when no API key is set.
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
if (apiKey) {
  console.log("\nPlanner — multi-candidate with LLM (API key present):");
  const pick2 = await runPlanner({
    channel: "call",
    parsed_query: parsedQuery,
    supplier: geneticist,
    priorActions: [record1],
    crossChannelEvidence: [],
    infoNeeds: ["price_per_case_usd", "biomarker_breakdown", "turnaround_weeks"],
    questions_remaining: 5,
  });
  console.log(`  picked: ${pick2.action_id}`);
  console.log(`  reasoning: ${pick2.reasoning}`);
  const valid = ["ask_availability", "ask_biomarker_status", "ask_price_per_case", "ask_turnaround", "wrap_with_followup"];
  expect("planner picks a valid follow-up after introduce_request", valid.includes(pick2.action_id));
} else {
  console.log("\n[skip] Planner LLM path — set ANTHROPIC_API_KEY to exercise.");
}

// 7. Cross-channel query — planner gating sanity.
console.log("\nCross-channel query:");
const otherSupplierRecord: ActionReasoningLog = {
  id: "r3",
  run_id: "smoke-runtime",
  supplier_id: "refmed",
  channel: "email",
  action_id: "ask_biomarker_followup",
  timestamp: new Date(Date.now() + 2).toISOString(),
  reasoning: "deep audit on RefMed",
  inputs: {},
  output: { biomarker_breakdown: { value: { EGFR: 0.4, KRAS: 0.3 }, evidence_quote: "EGFR positive ~40%" } },
  cross_channel_refs: [],
  success: true,
};
await appendRecord(TMP_RUN, otherSupplierRecord);

const xc = await queryCrossChannel({
  runDir: TMP_RUN,
  currentSupplierId: "geneticist",
  infoNeeds: ["biomarker_breakdown"],
});
expect("cross-channel query finds 1 RefMed record about biomarker_breakdown", xc.length === 1);
expect("cross-channel record is from refmed", xc[0]?.supplier_id === "refmed");

// 8. Warm supplier opener: build introduce_warm... wait, we haven't authored that action yet
//    (cold/warm refactor lands in Phase B). Smoke confirms today's call.yaml works
//    end-to-end, the mode split is a follow-up.

console.log(`\n${failed === 0 ? "ALL PASS" : `FAIL — ${failed} assertion(s)`}`);
process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke crash:", e);
  process.exit(2);
});
