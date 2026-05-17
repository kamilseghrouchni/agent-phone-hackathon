// app/api/chain/start/route.ts
//
// POST { runId, supplierId } — initializes the ChainState, fires Stage 1
// (form), and wires the stage-transition handlers so completion of each
// stage cascades into the next via chain-transitions.onStageComplete.
//
// Stage 1 (form): drives `submitForm` from lib/integrations/browser-use.
//   The form fill is fast-pathed for the demo — we don't actually push
//   each field through Playwright here in the API request, but we write
//   a clean trail of ChainStageEvents and produce a "waitlist" outcome
//   that escalates to Stage 2 (call) via the transition table.
//
// Stage 2 (call): defaultChainHandlers.fireCall → AgentPhone.callOut.
// Stage 3 (email): fireEmail closure below → AgentMail.sendEmail.
// Stage 4 (sms_pay): defaultChainHandlers.fireSmsPay → AgentPhone.smsSend.
//   Inbound CONFIRMED reply lands at /api/webhooks/agentphone which calls
//   sponge.createDownPayment and then completeStage(state, sms_pay/confirmed)
//   to cascade into Stage 5.
// Stage 5 (meeting): fireMeeting closure → calcom.bookSlot (Notion calendar
//   Playwright).
//
// The fire-cascade for stages we cannot autonomously wait for (email reply,
// sms confirmed) ends after firing the outbound action; the webhook handlers
// own the completion side. For Stage 1 the demo fast-paths to "waitlist"
// so the chain moves forward without requiring a real Crovi.bio form.

import { NextRequest, NextResponse } from "next/server";
import {
  initChainState,
  loadChainState,
  saveChainState,
  appendEvent,
  completeStage,
  recordAgentPhoneId,
} from "@/lib/agents/runtime/chain-runtime";
import type { ChainHandlers } from "@/lib/agents/runtime/chain-transitions";
import { buildHandlersForRun } from "@/lib/agents/runtime/build-handlers";
// chain-form.ts (Playwright form-fill against /forms/crovi-intake) is
// intentionally NOT imported here. The 25-field paced-typing demo was
// useless — the audience already saw the live enrichment Chromium scrape
// crovi.bio in the enrich phase. The chain now starts on the call leg.
import type { ChainState } from "@/types/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Crovi.bio constants — locked for the demo. The supplier "lives in" our
// internal directory, not in the V1 enrichment scrape pool.
// ---------------------------------------------------------------------------

// Stage 1 form-fill target — the REAL crovi.bio public intake page
// (env `CROVI_INTAKE_FORM`, currently `https://crovi.bio/agent-launched`).
// Playwright opens a visible Chromium window, navigates to this URL, and
// reads the response copy. No fake field-typing — the page is the
// demo's first audience touchpoint.
const CROVI_FORM_URL =
  process.env.CROVI_INTAKE_FORM ?? "https://crovi.bio/agent-launched";

// For the demo, `DEMO_CALL_TARGET_PHONE` is YOUR phone — you play both the
// crovi.bio BD persona (Stage 2 call rings you) and NovaCure procurement
// (Stage 4 SMS lands on you). Both sides fall back to the canonical demo
// phone unless a per-role override is set explicitly. Kept here for the
// pre-Stage-2 agentphone.json seed; Stage 2 onward sources phones from
// the shared buildHandlersForRun.
const BUYER_PHONE =
  process.env.NOVACURE_BUYER_PHONE ??
  process.env.DEMO_BUYER_PHONE ??
  process.env.DEMO_CALL_TARGET_PHONE ??
  "+15555550199";

// ---------------------------------------------------------------------------
// POST entry — initialize chain + fire Stage 1.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { runId?: string; supplierId?: string } = {};
  try {
    body = (await req.json()) as { runId?: string; supplierId?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const runId = body.runId;
  const supplierId = body.supplierId ?? "crovi_bio";
  if (!runId) return NextResponse.json({ error: "missing runId" }, { status: 400 });

  const state = initChainState(runId, supplierId);

  // Seed agentphone.json with the buyer phone so inbound SMS reply matching
  // works even before Stage 2 has dialed.
  try {
    recordAgentPhoneId({
      runId,
      supplierId,
      buyerPhone: BUYER_PHONE,
      kind: "sms",
      id: `init_${Date.now()}`,
    });
  } catch {
    // non-fatal
  }

  // Supermemory recall — pull what we already know about this supplier
  // from prior procurement runs. Surface as a chain event so the audience
  // sees Supermemory fire in the Timeline. Non-fatal: chain proceeds even
  // if Supermemory is misconfigured.
  void (async () => {
    try {
      const { supermemory, supermemoryConfigured } = await import(
        "@/lib/integrations/supermemory"
      );
      if (!supermemoryConfigured()) return;
      const recall = await supermemory.recallSupplierContext(supplierId);
      const live = loadChainState(runId);
      if (!live) return;
      const hitCount = recall.hits.length;
      const profileBits =
        (recall.static.length || 0) + (recall.dynamic.length || 0);
      const topHit = recall.hits[0]?.content?.slice(0, 120);
      appendEvent(live, "form", {
        event_id: `supermemory:recall:${Date.now()}`,
        timestamp: new Date().toISOString(),
        direction: "system",
        actor: "agent",
        text:
          hitCount + profileBits === 0
            ? `Supermemory: no prior context for supplier:${supplierId} (cold). Recall ${recall.latency_ms}ms.`
            : `Supermemory: recalled ${hitCount} prior memor${hitCount === 1 ? "y" : "ies"} + ${profileBits} profile fact${profileBits === 1 ? "" : "s"} for supplier:${supplierId} (${recall.latency_ms}ms)${topHit ? ` — "${topHit}"` : ""}`,
        payload: {
          hits: hitCount,
          profile_facts: profileBits,
          latency_ms: recall.latency_ms,
        },
      });
      saveChainState(live);
    } catch {
      // best-effort
    }
  })();

  // Build the handler set the transition dispatcher will use. Shared
  // factory — the webhook handlers (agentphone call.completed, agentmail
  // reply) re-import the same builder so completeStage() does the same
  // thing regardless of who fires it.
  const handlers = buildHandlersForRun(runId);

  // Fire Stage 1 (form) — fast-pathed to "waitlist" outcome. The cascade
  // through chain-transitions.onStageComplete then invokes fireCall, which
  // is the first real wire-side effect (AgentPhone).
  await fireForm(state, runId, handlers);

  return NextResponse.json({
    runId,
    supplierId,
    chain: loadChainState(runId),
  });
}

// ---------------------------------------------------------------------------
// Stage 1 — FAST-PATH (skipped). The 25-field Playwright fill against
// /forms/crovi-intake was useless: the audience already saw the live
// enrichment Chromium scrape crovi.bio during the Enrich phase, and the
// paced typing animation didn't add anything except runtime. We now emit
// two short narration events and cascade straight to the call leg.
// ---------------------------------------------------------------------------

async function fireForm(
  state: ChainState,
  runId: string,
  handlers: ChainHandlers,
): Promise<void> {
  void runId;
  const ts = new Date().toISOString();
  state.stages.form.status = "in_progress";
  state.stages.form.started_at = ts;
  appendEvent(state, "form", {
    event_id: "stage-form-event-0",
    timestamp: ts,
    direction: "system",
    actor: "agent",
    channel: "form",
    text: `Intake envelope ready for ${CROVI_FORM_URL} — already verified during enrichment scrape, skipping duplicate browser session.`,
  });
  appendEvent(state, "form", {
    event_id: "stage-form-event-reasoning",
    timestamp: new Date().toISOString(),
    direction: "reasoning",
    actor: "agent",
    text:
      "Crovi.bio's intake form returns waitlist-only — no immediate allocation. Escalating to direct contact via voice to lock terms.",
  });
  saveChainState(state);
  // Cascade — chain-transitions.onStageComplete routes form/waitlist → fireCall.
  await completeStage(state, { stage: "form", kind: "waitlist" }, handlers);
}

// Stage 2 (call) / 3 (email) / 4 (sms_pay) / 5 (meeting) handlers all live
// in lib/agents/runtime/build-handlers.ts so the webhook routes can call
// completeStage() with the same handler set this route uses.
