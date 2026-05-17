// types/chain.ts — ChainState schema (spec §3, verbatim)
//
// The 5-stage runtime state for a single supplier. Events are bi-directional;
// each event has a stable anchor id so provenance pills can deep-link.

import type { Channel } from "./evidence";

export type ChainStage = "form" | "call" | "email" | "sms_pay" | "meeting";
export type ChainStageStatus =
  | "locked"
  | "ready"
  | "in_progress"
  | "complete"
  | "failed"
  | "fallback";

export interface ChainStageEvent {
  event_id: string;             // stable anchor (e.g. "stage-2-event-7"); referenced by SupplierEvidence.evidence_id when this event sources a field — enables provenance click-through from Filled Intake → timeline
  timestamp: string;
  direction: "outbound" | "inbound" | "system" | "reasoning";
  actor: "agent" | "supplier" | "buyer" | "stripe" | "sponge" | "cal" | "browser_use";
  channel?: Channel;
  text?: string;                // conversational / narration / reasoning content
  payload?: unknown;            // structured events: transfer details, ICS event, form field deltas
}

export interface ChainStateStage {
  status: ChainStageStatus;
  started_at?: string;
  completed_at?: string;
  artifact_id?: string;         // pointer to: browser-use session, call sid, email id, sms id, stripe transfer id, calendar event id
  output?: unknown;             // stage-specific output (waitlist response, call transcript, email reply text, payment hash)
  events: ChainStageEvent[];    // bi-directional thread for this stage; rendered inline in chain timeline (Lineage view)
}

export interface ChainState {
  run_id: string;
  supplier_id: string;          // "crovi_bio" for the demo
  stages: Record<ChainStage, ChainStateStage>;
  evidence_added: string[];     // evidence_id refs to SupplierEvidence pool (match against ChainStageEvent.event_id when that event sourced the evidence)
}

export const CHAIN_STAGE_ORDER: ChainStage[] = ["form", "call", "email", "sms_pay", "meeting"];

export const CHAIN_STAGE_LABELS: Record<ChainStage, { short: string; long: string; sub: string }> = {
  form: { short: "FORM", long: "Form", sub: "Fill form" },
  call: { short: "CALL", long: "Call", sub: "Q&A" },
  email: { short: "EMAIL", long: "Email", sub: "Quote" },
  sms_pay: { short: "SMS+PAY", long: "SMS + Pay", sub: "$10 ↻ Sponge" },
  meeting: { short: "MEET", long: "Meeting", sub: "Book slot" },
};
