// Lightweight node-runnable tests for the pure §7 / §8 computation functions.
// No test framework dependency — uses `node:assert` so it can be invoked with
// `npx tsx lib/intake/__tests__/section7-8.test.ts` or via ts-node. Each scenario
// throws on failure; the file logs a checkmark per assertion.

import assert from "node:assert/strict";

import type { IntakeForm } from "@/types/intake";
import type { SupplierEvidence } from "@/types/evidence";
import type { ChainState } from "@/types/chain";

import { computeSection7 } from "../section7";
import { computeSection8 } from "../section8";

const baseIntake: IntakeForm = {
  run_id: "test-run",
  source: { type: "pdf", filename: "test.pdf" },
  buyer: { company: "NovaCure", contact: "Lena", email: "a@b.c", phone: "+1" },
  fields: [
    { field_id: "shipping.domestic_or_intl", section: 6, label: "Domestic or International", class: "frozen", value: "Domestic only", status: "frozen" },
    { field_id: "supplier.preferred_amc", section: 6, label: "Preferred Supplier (AMC)", class: "confirmable", value: "AMC preferred", status: "empty" },
  ],
};

function ev(partial: Partial<SupplierEvidence> & Pick<SupplierEvidence, "supplier_id" | "field_id" | "value">): SupplierEvidence {
  return {
    channel: "browse",
    evidence_id: "ev-" + Math.random().toString(36).slice(2, 7),
    confidence: "high",
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

function emptyChain(): ChainState {
  return {
    run_id: "test-run",
    supplier_id: "crovi_bio",
    stages: {
      form:    { status: "locked", events: [] },
      call:    { status: "locked", events: [] },
      email:   { status: "locked", events: [] },
      sms_pay: { status: "locked", events: [] },
      meeting: { status: "locked", events: [] },
    },
    evidence_added: [],
  };
}

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok  ${label}`);
}

// ============ Section 7 ============

check("section7 returns exactly 6 fields", () => {
  const out = computeSection7(baseIntake, [], []);
  assert.equal(out.length, 6);
});

check("section7 marks all rows as agent_filled / class agent_filled / section 7", () => {
  const out = computeSection7(baseIntake, [], []);
  for (const f of out) {
    assert.equal(f.section, 7);
    assert.equal(f.class, "agent_filled");
    assert.equal(f.status, "agent_filled");
  }
});

check("section7 status reflects no-selection vs no-evidence vs confirmed", () => {
  const a = computeSection7(baseIntake, [], []);
  assert.equal(a.find((f) => f.field_id === "section7.status")?.value, "Awaiting supplier selection");

  const b = computeSection7(baseIntake, [], ["crovi_bio"]);
  assert.equal(b.find((f) => f.field_id === "section7.status")?.value, "Selected, no replies yet");

  const c = computeSection7(baseIntake, [ev({ supplier_id: "crovi_bio", field_id: "supplier.notes", value: "ok" })], ["crovi_bio"]);
  assert.equal(c.find((f) => f.field_id === "section7.status")?.value, "Confirmed via outreach");
});

check("section7 surfaces international-supplier risk when domestic-only", () => {
  const evidence = [
    ev({ supplier_id: "intl_lab", field_id: "supplier.country", value: "DE" }),
  ];
  const out = computeSection7(baseIntake, evidence, ["intl_lab"]);
  const risks = out.find((f) => f.field_id === "section7.risks")?.value as string | null;
  assert.ok(risks?.includes("International supplier"));
});

check("section7 supplier name pulled from evidence when present", () => {
  const evidence = [ev({ supplier_id: "crovi_bio", field_id: "supplier.name", value: "Crovi.bio" })];
  const out = computeSection7(baseIntake, evidence, ["crovi_bio"]);
  assert.equal(out.find((f) => f.field_id === "section7.potential_suppliers")?.value, "Crovi.bio");
});

// ============ Section 8 ============

check("section8 returns exactly 4 fields", () => {
  const out = computeSection8(baseIntake, emptyChain());
  assert.equal(out.length, 4);
});

check("section8 marks all rows agent_filled in section 8", () => {
  const out = computeSection8(baseIntake, emptyChain());
  for (const f of out) {
    assert.equal(f.section, 8);
    assert.equal(f.class, "agent_filled");
    assert.equal(f.status, "agent_filled");
  }
});

check("section8 status = 'Sequence not started' when chain empty", () => {
  const out = computeSection8(baseIntake, emptyChain());
  assert.equal(out.find((f) => f.field_id === "section8.status")?.value, "Sequence not started");
});

check("section8 fills contract acceptance when supplier replies 'I agree' on email", () => {
  const chain = emptyChain();
  chain.stages.email = {
    status: "complete",
    events: [
      { event_id: "e1", timestamp: "t", direction: "inbound", actor: "supplier", channel: "email", text: "I agree to terms." },
    ],
  };
  const out = computeSection8(baseIntake, chain);
  assert.equal(out.find((f) => f.field_id === "section8.contract_acceptance")?.value, "Accepted via email reply");
});

check("section8 sets contract status='Contract locked' when all 5 stages complete", () => {
  const chain = emptyChain();
  chain.stages.form = { status: "complete", events: [] };
  chain.stages.call = { status: "complete", events: [] };
  chain.stages.email = { status: "complete", events: [{ event_id: "e1", timestamp: "t", direction: "inbound", actor: "supplier", channel: "email", text: "I agree" }] };
  chain.stages.sms_pay = { status: "complete", events: [{ event_id: "e2", timestamp: "t", direction: "system", actor: "sponge", channel: "pay", text: "Transfer settled" }] };
  chain.stages.meeting = { status: "complete", events: [{ event_id: "e3", timestamp: "t", direction: "system", actor: "cal", channel: "calendar", text: "Tue 10am" }] };
  const out = computeSection8(baseIntake, chain);
  assert.equal(out.find((f) => f.field_id === "section8.status")?.value, "Contract locked");
  assert.equal(out.find((f) => f.field_id === "section8.down_payment")?.value, "$10 goodwill — settled");
  assert.equal(out.find((f) => f.field_id === "section8.meeting_confirmed")?.value, "Tue 10am");
});

check("section8 attaches provenance to confirmable rows", () => {
  const chain = emptyChain();
  chain.stages.email = {
    status: "complete",
    events: [
      { event_id: "stage-3-event-2", timestamp: "t", direction: "inbound", actor: "supplier", channel: "email", text: "Agree." },
    ],
  };
  const out = computeSection8(baseIntake, chain);
  const accept = out.find((f) => f.field_id === "section8.contract_acceptance");
  assert.equal(accept?.provenance?.evidence_id, "stage-3-event-2");
  assert.equal(accept?.provenance?.channel, "email");
});

// eslint-disable-next-line no-console
console.log(`\n${passed} assertions passed.`);
