// Chain transitions — wires stage_complete callbacks to next-stage unlock.
//
// Trunk owns the state machine itself (lib/agents/runtime/chain-runtime.ts).
// This file only owns the *transition wiring*: when stage X completes with
// outcome Y, fire the side effect that unlocks stage Z. The runtime calls
// `onStageComplete` after marking a stage `complete`; this module turns that
// signal into the next-stage `fire` call.
//
//   form.waitlist        → call.fire
//   call.complete        → email.fire
//   email.replied_yes    → sms_pay.fire
//   sms_pay.confirmed    → meeting.fire
//
// The integration callbacks (Sponge, AgentMail, Cal.com, AgentPhone) are
// injected as a `ChainHandlers` object so this module stays pure and Trunk's
// chain-runtime can swap any of them out without touching the wiring table.

import type { ChainStage, ChainState } from "@/types/chain";

// ---------------------------------------------------------------------------
// Outcome tagging — the runtime hands us a free-form `output`; we narrow it
// to one of the canonical outcomes the transition table reacts to.
// ---------------------------------------------------------------------------

export type StageOutcome =
  | { stage: "form"; kind: "waitlist" | "submitted" | "failed" }
  | { stage: "call"; kind: "complete" | "no_answer" | "failed" }
  | { stage: "email"; kind: "replied_yes" | "replied_no" | "no_reply" }
  | { stage: "sms_pay"; kind: "confirmed" | "declined" | "no_reply" }
  | { stage: "meeting"; kind: "booked" | "failed" };

// ---------------------------------------------------------------------------
// Handlers — injected by chain-runtime. Each one is the side-effect that
// fires the *next* stage. The handler bodies live in the respective agent
// modules (call.fire → agentphone.callOut + voice-persona, etc.).
// ---------------------------------------------------------------------------

export interface ChainHandlers {
  fireCall: (state: ChainState) => Promise<void> | void;
  fireEmail: (state: ChainState) => Promise<void> | void;
  fireSmsPay: (state: ChainState) => Promise<void> | void;
  fireMeeting: (state: ChainState) => Promise<void> | void;
  // Optional escalation hook (e.g. form.failed → log + skip directly to call).
  onFallback?: (
    state: ChainState,
    from: ChainStage,
    reason: string,
  ) => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Transition table — pure data + a dispatcher. Adding a new transition is a
// single-row edit. Reviewers can read off the spec verbatim from this table.
// ---------------------------------------------------------------------------

type Transition = {
  from: ChainStage;
  outcome: StageOutcome["kind"];
  next: ChainStage | null; // null = terminal
};

export const CHAIN_TRANSITIONS: ReadonlyArray<Transition> = [
  { from: "form", outcome: "waitlist", next: "call" },
  { from: "form", outcome: "submitted", next: "call" }, // even on success, demo escalates
  { from: "form", outcome: "failed", next: "call" }, // fallback path
  { from: "call", outcome: "complete", next: "email" },
  { from: "call", outcome: "no_answer", next: "email" }, // fallback voice agent already played
  { from: "call", outcome: "failed", next: "email" },
  { from: "email", outcome: "replied_yes", next: "sms_pay" },
  { from: "email", outcome: "replied_no", next: null }, // terminal — buyer-driven
  { from: "email", outcome: "no_reply", next: null },
  { from: "sms_pay", outcome: "confirmed", next: "meeting" },
  { from: "sms_pay", outcome: "declined", next: null },
  { from: "sms_pay", outcome: "no_reply", next: null },
  { from: "meeting", outcome: "booked", next: null },
  { from: "meeting", outcome: "failed", next: null },
];

/**
 * Resolve the next stage to fire given a (stage, outcome) tuple. Returns
 * `null` if the outcome is terminal or unmapped.
 */
export function nextStage(outcome: StageOutcome): ChainStage | null {
  const row = CHAIN_TRANSITIONS.find(
    (t) => t.from === outcome.stage && t.outcome === outcome.kind,
  );
  return row?.next ?? null;
}

/**
 * Dispatcher called by chain-runtime after a stage transitions to `complete`
 * (or `fallback`). Routes to the appropriate fire-next handler. Pure side
 * effects on `handlers` — does not mutate `state` directly (the runtime owns
 * state mutations).
 */
export async function onStageComplete(
  state: ChainState,
  outcome: StageOutcome,
  handlers: ChainHandlers,
): Promise<void> {
  const next = nextStage(outcome);
  if (!next) return;
  switch (next) {
    case "call":
      await handlers.fireCall(state);
      return;
    case "email":
      await handlers.fireEmail(state);
      return;
    case "sms_pay":
      await handlers.fireSmsPay(state);
      return;
    case "meeting":
      await handlers.fireMeeting(state);
      return;
    case "form":
      // No backward transitions — form is always the entry stage.
      return;
  }
}
