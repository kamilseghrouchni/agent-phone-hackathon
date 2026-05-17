// lib/agents/runtime/mock-chain.ts
//
// Mock ChainState fixture for the Beat 4 / Beat 5 UI — used by the trunk to
// render the Timeline + SequenceTemplate without the V4/V5 wiring agents.
// Replace with live state once chain-runtime callbacks are wired.

import { initChain, appendEvent, makeEventId } from "./chain-runtime";
import type { ChainState, ChainStage } from "@/types/chain";

export function buildMockChain(run_id: string, supplier_id = "crovi_bio"): ChainState {
  let state = initChain(run_id, supplier_id);
  state = {
    ...state,
    stages: {
      form: { ...state.stages.form, status: "complete", started_at: ts(0), completed_at: ts(23_000) },
      call: { ...state.stages.call, status: "complete", started_at: ts(25_000), completed_at: ts(115_000) },
      email: { ...state.stages.email, status: "complete", started_at: ts(118_000), completed_at: ts(138_000) },
      sms_pay: { ...state.stages.sms_pay, status: "complete", started_at: ts(140_000), completed_at: ts(165_000) },
      meeting: { ...state.stages.meeting, status: "complete", started_at: ts(167_000), completed_at: ts(170_000) },
    },
  };

  // Stage 1 — Form
  state = pushEvents(state, "form", [
    evt("system", "agent", "browse", "navigated to crovi.bio/intake-demo", 1_000, "browser_use"),
    evt("outbound", "agent", "form", 'typed indication = "NSCLC III-IV"', 5_000),
    evt("outbound", "agent", "form", 'typed quantity = "150 / 75"', 12_000),
    evt("inbound", "supplier", "form", 'form response: "Added to waitlist"', 22_000),
    evt("reasoning", "agent", undefined, "Waitlist insufficient. Escalating to voice.", 23_000),
  ]);

  // Stage 2 — Call
  state = pushEvents(state, "call", [
    evt("outbound", "agent", "call", "dialed crovi.bio BD line", 25_000),
    evt("inbound", "supplier", "call", "Hello, crovi.bio BD.", 28_000),
    evt(
      "outbound",
      "agent",
      "call",
      "Can you confirm 150 plasma at minimum 2 mL with matched FFPE blocks?",
      32_000,
    ),
    evt(
      "inbound",
      "supplier",
      "call",
      "Yes — about 12% of our naive cases are EGFR+.",
      48_000,
    ),
    evt("outbound", "agent", "call", "Closing — I'll send the full specs and a benchmarked quote via email.", 110_000),
  ]);

  // Stage 3 — Email
  state = pushEvents(state, "email", [
    evt("outbound", "agent", "email", "Sent to bd@crovi.bio with 2 attachments (Filled Intake + Quote)", 118_000),
    evt("inbound", "supplier", "email", '"I agree."', 138_000),
  ]);

  // Stage 4 — SMS + Pay
  state = pushEvents(state, "sms_pay", [
    evt("outbound", "agent", "sms", "Reply CONFIRMED to authorize $10 goodwill down payment.", 140_000),
    evt("inbound", "buyer", "sms", "CONFIRMED — legally binding", 158_000),
    evt(
      "system",
      "sponge",
      "pay",
      "wallet.transfer(amount=1000, from=novacure_wallet, to=crovi_bio_wallet)",
      159_000,
      undefined,
      { transfer_id: "sponge_demo_123", amount: 1000 },
    ),
    evt("system", "sponge", "pay", "webhook: transfer.settled", 162_000),
    evt("system", "agent", undefined, "Revolut push notification fired", 165_000),
  ]);

  // Stage 5 — Meeting
  state = pushEvents(state, "meeting", [
    evt(
      "system",
      "cal",
      "calendar",
      "createEvent → Crovi.bio × NovaCure — Shipment logistics & contract review (Tue 10am)",
      167_000,
      undefined,
      { event_id: "evt_demo_456" },
    ),
    evt("inbound", "agent", "email", "ICS receipt landed via AgentMail", 170_000),
  ]);

  return state;
}

function pushEvents(
  state: ChainState,
  stage: ChainStage,
  evs: Array<{
    direction: "outbound" | "inbound" | "system" | "reasoning";
    actor: any;
    channel?: any;
    text: string;
    offsetMs: number;
    payload?: unknown;
  }>,
): ChainState {
  let s = state;
  evs.forEach((e, i) => {
    s = appendEvent(s, stage, {
      event_id: makeEventId(stage, i + 1),
      timestamp: ts(e.offsetMs),
      direction: e.direction,
      actor: e.actor,
      channel: e.channel,
      text: e.text,
      payload: e.payload,
    });
  });
  return s;
}

function evt(
  direction: "outbound" | "inbound" | "system" | "reasoning",
  actor: any,
  channel: any,
  text: string,
  offsetMs: number,
  overrideActor?: any,
  payload?: unknown,
) {
  return {
    direction,
    actor: overrideActor ?? actor,
    channel,
    text,
    offsetMs,
    payload,
  };
}

// Module-load epoch keeps timestamps stable across re-renders within a
// single run, while remaining tied to whenever the demo is launched.
const TS_EPOCH = Date.now();
function ts(offsetMs: number): string {
  return new Date(TS_EPOCH + offsetMs).toISOString();
}
