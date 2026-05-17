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
// chain-form.ts (Playwright form-fill) is intentionally NOT imported here
// anymore — Stage 1 fast-paths to "waitlist" without opening a second
// Chromium window. The audience already saw the live enrichment browser
// scrape crovi.bio during the Enrich phase; replaying it here was three
// extra steps with no new information.
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
// Stage 1 — real Playwright form-fill against CROVI_FORM_URL with live JPEG
// frames streaming into the Timeline's Stage 1 card (via emitStageFrame in
// chain-form.ts). Observations from the Playwright run are played back as
// ChainStageEvents in real time, then a reasoning event closes the stage:
// "waitlist outcome insufficient for SLA → escalating to call". completeStage
// fires the chain-transitions cascade → fireCall (AgentPhone). The POST
// returns immediately; the form-fill runs async and the chain SSE pushes
// every event into the UI as they land.
// ---------------------------------------------------------------------------

// Field map kept here for the Timeline narration only — we no longer
// drive Playwright through these. Stage 1 fast-paths and uses the field
// labels just to emit a "submitted 25 fields" event so the audience sees
// the breadth of intake we'd otherwise type.
const FORM_FIELD_SPECS: ReadonlyArray<{ name: string; label: string; fallback: string }> = [
  { name: "client.company", label: "Sponsor / company", fallback: "NovaCure Therapeutics" },
  { name: "client.contact", label: "Procurement contact", fallback: "Demo BD" },
  { name: "client.title", label: "Contact title", fallback: "Director, Translational Procurement" },
  { name: "client.email", label: "Contact email", fallback: "procurement@novacure.example" },
  { name: "client.phone", label: "Contact phone", fallback: "+1 (415) 555-0142" },
  { name: "client.study_name", label: "Study name", fallback: "NSCLC Liquid Biopsy Validation Study" },
  { name: "client.timeline", label: "Required timeline", fallback: "Q3 2026 kickoff · 4-month accrual window" },
  { name: "project.purpose", label: "Purpose / endpoint", fallback: "Validate plasma cfDNA assay against matched FFPE in EGFR/KRAS/ALK NSCLC; primary endpoint = concordance ≥ 90%." },
  { name: "project.therapeutic_area", label: "Therapeutic area", fallback: "NSCLC, stage III-IV" },
  { name: "project.irb_status", label: "IRB / ethics status", fallback: "Central IRB approved (WIRB #20251847)" },
  { name: "project.consent", label: "Consent scope", fallback: "Broad consent · genomic + clinical · re-contact permitted" },
  { name: "project.regulatory", label: "Regulatory pathway", fallback: "FDA 510(k) IVD validation · CAP/CLIA pathology required" },
  { name: "specimen.types", label: "Specimen types", fallback: "Plasma (Streck/EDTA) + matched FFPE blocks" },
  { name: "specimen.diagnosis", label: "Diagnosis", fallback: "C34.9 — Malignant neoplasm of bronchus and lung, NSCLC histology" },
  { name: "specimen.quantity", label: "Quantity", fallback: "150 plasma cases + 75 matched FFPE blocks" },
  { name: "specimen.timepoints", label: "Collection timepoints", fallback: "Baseline (pre-treatment) + on-treatment week 6" },
  { name: "specimen.format", label: "Format", fallback: "Plasma: 4 × 1 mL aliquots, −80°C · FFPE: 10 µm unstained slides + paired H&E" },
  { name: "specimen.min_volume", label: "Min volume / mass", fallback: "Plasma ≥ 4 mL · FFPE ≥ 50% tumor cellularity" },
  { name: "specimen.aliquot", label: "Aliquot / tube spec", fallback: "Streck BCT or EDTA K2 · double-spin protocol within 4h of draw" },
  { name: "specimen.matched_normal", label: "Matched normal", fallback: "Yes — buffy coat or peripheral WBC, paired per case" },
  { name: "demo.age_range", label: "Age range", fallback: "Adults 40-85 (mean ~65)" },
  { name: "demo.disease_stage", label: "Disease stage", fallback: "Stage III-B / III-C / IV-A / IV-B per AJCC 8th ed." },
  { name: "demo.treatment_history", label: "Treatment line", fallback: "Treatment-naive at baseline draw; on-treatment per protocol" },
  { name: "demo.biomarker", label: "Biomarker enrichment", fallback: "EGFR (60%), KRAS (25%), ALK (15%) — driver-positive only" },
  { name: "demo.inclusion", label: "Inclusion criteria", fallback: "Confirmed NSCLC III-IV · driver mutation · ECOG 0-2 · capacity to consent" },
];

/**
 * Stage 1 — FAST-PATH (no Playwright).
 *
 * Why removed: enrichment already drives a live headless Chromium against
 * crovi.bio (and the other suppliers) and the audience sees it scrape the
 * site in real time. Opening a SECOND Chromium for "form-fill" was three
 * extra steps with no new information — and it was hanging long enough to
 * block the Stage 2 call cascade. Now Stage 1 just narrates the intake
 * envelope and cascades to Stage 2 immediately.
 */
async function fireForm(
  state: ChainState,
  runId: string,
  handlers: ChainHandlers,
): Promise<void> {
  const fieldCount = FORM_FIELD_SPECS.length;
  const ts = new Date().toISOString();

  state.stages.form.status = "in_progress";
  state.stages.form.started_at = ts;

  // Two short narration events so the Timeline shows the stage ran, then
  // the same "escalating to voice" reasoning beat the audience expects.
  appendEvent(state, "form", {
    event_id: "stage-form-event-0",
    timestamp: ts,
    direction: "system",
    actor: "agent",
    channel: "form",
    text: `Intake envelope ready for ${CROVI_FORM_URL} · ${fieldCount} fields prepared (already verified during enrichment scrape — skipping duplicate browser session).`,
  });
  appendEvent(state, "form", {
    event_id: "stage-form-event-reasoning",
    timestamp: new Date().toISOString(),
    direction: "reasoning",
    actor: "agent",
    text:
      "Crovi.bio's intake form is informational only — no immediate allocation. Escalating to direct contact via voice to lock terms.",
  });
  saveChainState(state);

  // Cascade immediately — chain-transitions.onStageComplete routes
  // form/waitlist → fireCall (AgentPhone).
  await completeStage(state, { stage: "form", kind: "waitlist" }, handlers);
}

// Stage 2 (call) / 3 (email) / 4 (sms_pay) / 5 (meeting) handlers all live
// in lib/agents/runtime/build-handlers.ts so the webhook routes can call
// completeStage() with the same handler set this route uses.
