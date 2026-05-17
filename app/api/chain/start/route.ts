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
import { fillIntakeForm, type FormFieldFill } from "@/lib/integrations/chain-form";
import { readIntake } from "@/lib/store/runs";
import type { ChainState } from "@/types/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Crovi.bio constants — locked for the demo. The supplier "lives in" our
// internal directory, not in the V1 enrichment scrape pool.
// ---------------------------------------------------------------------------

// Stage 1 form-fill target. Default to the REAL crovi.bio public intake
// form (env `CROVI_INTAKE_FORM`, currently `https://crovi.bio/agent-launched`).
// Playwright drives it best-effort — fills whatever input/textarea fields
// match by name/aria/placeholder, screenshots stream into the Timeline
// regardless. The audience watches the agent submit to the actual supplier
// site, not a stub we own.
//
// Override with `CROVI_INTAKE_FORM_LOCAL=true` to fall back to the local
// 25-field demo form (app/forms/crovi-intake) when the live page is down.
const CROVI_FORM_URL =
  process.env.CROVI_INTAKE_FORM_LOCAL === "true"
    ? `${process.env.DEMO_BASE_URL ?? "http://localhost:3000"}/forms/crovi-intake`
    : (process.env.CROVI_INTAKE_FORM ?? "https://crovi.bio/agent-launched");

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

// 25-field map that mirrors app/forms/crovi-intake/page.tsx. Each entry's
// `name` matches the corresponding <input name="..."> so Playwright can
// target by `[name="<id>"]`. Values prefer the live intake.json value;
// when the run hasn't seen one we fall back to the canonical NovaCure
// values from the bundled Sample_Completed_Biospecimen_Request.pdf so
// the demo always has 25 meaty observations to play through.
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

function buildFormFields(
  intake: ReturnType<typeof readIntake>,
): FormFieldFill[] {
  const lookup = new Map<string, string>();
  if (intake?.fields) {
    for (const f of intake.fields) {
      if (!f.field_id) continue;
      const v = f.value;
      const s =
        typeof v === "string"
          ? v.trim()
          : v == null
            ? ""
            : String(v).trim();
      if (s && s !== "—" && s.toLowerCase() !== "none") lookup.set(f.field_id, s);
    }
  }
  return FORM_FIELD_SPECS.map((spec) => ({
    name: spec.name,
    label: spec.label,
    value: lookup.get(spec.name) ?? spec.fallback,
  }));
}

async function fireForm(
  state: ChainState,
  runId: string,
  handlers: ChainHandlers,
): Promise<void> {
  const intake = readIntake(runId);
  const fieldFills = buildFormFields(intake);

  state.stages.form.status = "in_progress";
  state.stages.form.started_at = new Date().toISOString();
  appendEvent(state, "form", {
    event_id: `stage-form-event-0`,
    timestamp: new Date().toISOString(),
    direction: "system",
    actor: "browser_use",
    channel: "browse",
    text: `opening ${CROVI_FORM_URL} in headless Chromium · ${fieldFills.length} fields queued`,
  });
  saveChainState(state);

  // Fire-and-forget — Playwright runs on its own; the chain SSE picks up
  // each appendEvent / saveChainState in the live state.
  void (async () => {
    let result;
    try {
      result = await fillIntakeForm({
        runId,
        formUrl: CROVI_FORM_URL,
        fields: fieldFills,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const live = loadChainState(runId);
      if (!live) return;
      appendEvent(live, "form", {
        event_id: `stage-form-event-error`,
        timestamp: new Date().toISOString(),
        direction: "system",
        actor: "agent",
        channel: "form",
        text: `form-fill threw: ${message}`,
      });
      saveChainState(live);
      await completeStage(live, { stage: "form", kind: "waitlist" }, handlers);
      return;
    }

    const live = loadChainState(runId);
    if (!live) return;

    // Play back the Playwright observations as ChainStageEvents so the
    // Timeline action log narrates each step alongside the live frames.
    let n = 1;
    for (const obs of result.observations) {
      appendEvent(live, "form", {
        event_id: `stage-form-event-${n++}`,
        timestamp: obs.ts,
        direction: obs.direction,
        actor:
          obs.direction === "outbound"
            ? "agent"
            : obs.direction === "inbound"
              ? "supplier"
              : obs.direction === "reasoning"
                ? "agent"
                : "browser_use",
        channel:
          obs.direction === "inbound" || obs.direction === "outbound"
            ? "form"
            : "browse",
        text: obs.text,
      });
    }

    // Reasoning event — the "waitlist insufficient → escalate to call" beat.
    appendEvent(live, "form", {
      event_id: `stage-form-event-reasoning`,
      timestamp: new Date().toISOString(),
      direction: "reasoning",
      actor: "agent",
      text:
        result.outcome === "waitlist"
          ? "Waitlist outcome insufficient for SLA. Escalating to direct contact via voice."
          : result.outcome === "submitted"
            ? "Form submitted, but no allocation commitment. Escalating to voice to lock terms."
            : "Form attempt did not resolve. Escalating to voice as primary channel.",
    });
    saveChainState(live);

    // Cascade — chain-transitions.onStageComplete routes form/waitlist → fireCall.
    await completeStage(live, { stage: "form", kind: "waitlist" }, handlers);
  })();
}

// Stage 2 (call) / 3 (email) / 4 (sms_pay) / 5 (meeting) handlers all live
// in lib/agents/runtime/build-handlers.ts so the webhook routes can call
// completeStage() with the same handler set this route uses.
