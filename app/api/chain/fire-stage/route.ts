// app/api/chain/fire-stage/route.ts
//
// POST { runId, stage, supplierId? }
//
// Stage-isolated test endpoint. Synthesizes prior stages as `complete` with
// minimal events so a target stage can be fired in isolation against the
// real wire — without running the full chain serially every time.
//
// Use cases:
//   POST { stage: "email" }   → marks form+call complete, fires email send
//   POST { stage: "sms_pay" } → marks form+call+email complete, fires SMS
//   POST { stage: "meeting" } → marks form+call+email+sms_pay complete, fires Notion booking
//   POST { stage: "form" }    → same as /api/chain/start (full chain from top)
//
// The "previous-stage complete" synthesis is the strategy unblock — lets
// us validate each integration's real wire in parallel without the whole
// cascade timing out on a single broken link.

import { NextRequest, NextResponse } from "next/server";
import {
  initChainState,
  loadChainState,
  saveChainState,
  appendEvent,
  completeStage,
  recordAgentPhoneId,
} from "@/lib/agents/runtime/chain-runtime";
import { buildHandlersForRun } from "@/lib/agents/runtime/build-handlers";
import type { StageOutcome } from "@/lib/agents/runtime/chain-transitions";
import type { ChainStage, ChainState } from "@/types/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STAGE_ORDER: ChainStage[] = ["form", "call", "email", "sms_pay", "meeting"];

const BUYER_PHONE =
  process.env.NOVACURE_BUYER_PHONE ??
  process.env.DEMO_BUYER_PHONE ??
  process.env.DEMO_CALL_TARGET_PHONE ??
  "+15555550199";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as {
    runId?: string;
    stage?: ChainStage;
    supplierId?: string;
  };
  const runId = body.runId;
  const stage = body.stage;
  const supplierId = body.supplierId ?? "crovi_bio";
  if (!runId) return NextResponse.json({ error: "missing runId" }, { status: 400 });
  if (!stage || !STAGE_ORDER.includes(stage))
    return NextResponse.json({ error: "invalid stage" }, { status: 400 });

  const state = initChainState(runId, supplierId);

  // Seed agentphone.json so SMS webhooks can route back to this run.
  try {
    recordAgentPhoneId({
      runId,
      supplierId,
      buyerPhone: BUYER_PHONE,
      kind: "sms",
      id: `init_${Date.now()}`,
    });
  } catch {}

  // Synthesize prior stages as complete with synthetic events.
  const targetIdx = STAGE_ORDER.indexOf(stage);
  for (let i = 0; i < targetIdx; i++) {
    markStageSynthetic(state, STAGE_ORDER[i]);
  }
  saveChainState(state);

  // Fire the target stage via the chain-transitions cascade. The trick:
  // we complete the PREVIOUS stage with the outcome that routes to target,
  // which makes onStageComplete fire the target stage's handler.
  const handlers = buildHandlersForRun(runId);
  const priorStage = targetIdx === 0 ? null : STAGE_ORDER[targetIdx - 1];
  const priorOutcome = outcomeForTarget(stage);

  if (priorStage && priorOutcome) {
    await completeStage(state, priorOutcome, handlers);
  } else if (stage === "form") {
    // form has no prior; fire-stage form == redirect to /api/chain/start
    return NextResponse.json({
      error: "use /api/chain/start for form (chain root)",
    }, { status: 400 });
  }

  return NextResponse.json({
    runId,
    fired: stage,
    chain: loadChainState(runId),
  });
}

function markStageSynthetic(state: ChainState, stage: ChainStage): void {
  const now = new Date().toISOString();
  state.stages[stage].status = "complete";
  state.stages[stage].started_at = state.stages[stage].started_at ?? now;
  state.stages[stage].completed_at = now;
  appendEvent(state, stage, {
    event_id: `synthetic:${stage}:${Date.now()}`,
    timestamp: now,
    direction: "system",
    actor: "agent",
    text: `[synthetic] ${stage} marked complete for isolated test of downstream stage`,
  });
}

function outcomeForTarget(target: ChainStage): StageOutcome | null {
  // Mapping mirrors CHAIN_TRANSITIONS — the outcome of the PRIOR stage that
  // routes to the TARGET stage.
  switch (target) {
    case "call": return { stage: "form", kind: "waitlist" };
    case "email": return { stage: "call", kind: "complete" };
    case "sms_pay": return { stage: "email", kind: "replied_yes" };
    case "meeting": return { stage: "sms_pay", kind: "confirmed" };
    default: return null;
  }
}
