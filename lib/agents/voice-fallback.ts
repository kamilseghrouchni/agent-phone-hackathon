// lib/agents/voice-fallback.ts — secondary AgentPhone voice agent (spec §6 V7.2).
//
// Triggered when the primary call (Stage 2) gets no pickup by ring 4. The
// fallback plays the SAME 3 substantive questions but fully scripted —
// no LLM dependency, no Supermemory dependency. Goal: never break the demo
// because a phone didn't ring through.
//
// The actual outbound dial is owned by lib/integrations/agentphone.ts (Chain-Ops).
// This module exposes:
//   - the scripted persona payload
//   - a `shouldEscalate` predicate the chain runtime calls when ring counter ≥ 4
//   - a `simulateScriptedCall` helper that emits ChainStageEvent[] without any
//     external IO (used by tests + the demo recovery panel)

import type { ChainStageEvent } from "@/types/chain";

export const RING_NO_PICKUP_THRESHOLD = 4;

/** The 3-question script. Identical wording to the primary voice persona so
 * the audience never notices the swap. */
export const FALLBACK_SCRIPT: ReadonlyArray<{
  question: string;
  expected: string;          // canned supplier reply for fallback playback
  field_id: string;          // which IntakeField this answer maps to
}> = [
  {
    question:
      "Can you confirm 150 plasma samples at minimum 2 mL, with matched FFPE blocks or 10 unstained slides, baseline pre-treatment?",
    expected:
      "Yes — we can fulfill 150 plasma at 2 mL minimum with matched FFPE blocks, all baseline pre-treatment.",
    field_id: "specimen.format",
  },
  {
    question:
      "What's your approximate breakdown across EGFR+, KRAS+, and ALK in your treatment-naive Stage III-IV NSCLC pool?",
    expected:
      "Roughly 12% EGFR+, 28% KRAS+, and about 4% ALK in our treatment-naive Stage III-IV NSCLC cohort.",
    field_id: "biomarker.subset_rates",
  },
  {
    question:
      "Do you ship de-identified only, with pathology reports and de-identified clinical history?",
    expected:
      "Yes — de-identified only, pathology reports included, with SOPs available on request.",
    field_id: "data.pathology_reports",
  },
] as const;

export const FALLBACK_OPENING = "Hi — this is the Crovi procurement agent calling on behalf of NovaCure.";
export const FALLBACK_CLOSING = "Thank you. I'll send the full specs and a benchmarked quote via email.";

/** Decide whether to escalate to the scripted fallback. */
export function shouldEscalate(args: { rings: number; pickedUp: boolean }): boolean {
  if (args.pickedUp) return false;
  return args.rings >= RING_NO_PICKUP_THRESHOLD;
}

/** Build the persona payload that agentphone.ts can pass to its voice agent
 * config when the fallback dial fires. No live LLM in the loop. */
export function buildFallbackPersona(): {
  voice_model: "scripted";
  opening: string;
  turns: Array<{ agent: string; expected_supplier: string; field_id: string }>;
  closing: string;
} {
  return {
    voice_model: "scripted",
    opening: FALLBACK_OPENING,
    turns: FALLBACK_SCRIPT.map((s) => ({
      agent: s.question,
      expected_supplier: s.expected,
      field_id: s.field_id,
    })),
    closing: FALLBACK_CLOSING,
  };
}

/**
 * Generate the same `ChainStageEvent[]` the primary call would have produced,
 * so the Stage 2 timeline still looks complete even when no human picked up.
 * The chain runtime can push these events into stages.call.events and
 * resolve evidence per FALLBACK_SCRIPT[i].field_id.
 */
export function simulateScriptedCall(opts: {
  runId: string;
  supplierId: string;
  startedAt?: Date;
  stepDelaySec?: number;             // gap between events (default 6s)
}): ChainStageEvent[] {
  const t0 = (opts.startedAt ?? new Date()).getTime();
  const dt = (opts.stepDelaySec ?? 6) * 1000;
  const events: ChainStageEvent[] = [];
  let i = 0;
  const push = (e: Omit<ChainStageEvent, "event_id" | "timestamp">) => {
    events.push({
      event_id: `stage-2-fallback-${i}`,
      timestamp: new Date(t0 + i * dt).toISOString(),
      ...e,
    });
    i += 1;
  };

  push({
    direction: "system",
    actor: "agent",
    channel: "call",
    text: `No pickup after ${RING_NO_PICKUP_THRESHOLD} rings — escalating to scripted fallback persona.`,
  });
  push({
    direction: "outbound",
    actor: "agent",
    channel: "call",
    text: FALLBACK_OPENING,
  });
  for (const s of FALLBACK_SCRIPT) {
    push({ direction: "outbound", actor: "agent", channel: "call", text: s.question });
    push({
      direction: "inbound",
      actor: "supplier",
      channel: "call",
      text: s.expected,
      payload: { field_id: s.field_id, supplier_id: opts.supplierId, run_id: opts.runId },
    });
  }
  push({ direction: "outbound", actor: "agent", channel: "call", text: FALLBACK_CLOSING });
  return events;
}
