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
  defaultChainHandlers,
  recordAgentPhoneId,
} from "@/lib/agents/runtime/chain-runtime";
import type { ChainHandlers } from "@/lib/agents/runtime/chain-transitions";
import { sendEmail } from "@/lib/integrations/agentmail";
import { bookSlot } from "@/lib/integrations/calcom";
import { readIntake } from "@/lib/store/runs";
import type { BiobankOpportunity } from "@/types/biobank";
import type { ChainState } from "@/types/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Crovi.bio constants — locked for the demo. The supplier "lives in" our
// internal directory, not in the V1 enrichment scrape pool.
// ---------------------------------------------------------------------------

const CROVI_BIO: BiobankOpportunity = {
  id: "crovi_bio",
  name: "Crovi.bio",
  contact: {
    email: process.env.CROVI_BIO_BD_EMAIL ?? "bd@crovi.bio",
    bd_name: process.env.CROVI_BIO_BD_NAME ?? "Crovi.bio BD",
    site_url: process.env.CROVI_INTAKE_FORM_URL ?? "https://crovi.bio/intake-demo",
    quote_form_url: process.env.CROVI_INTAKE_FORM_URL ?? "https://crovi.bio/intake-demo",
  },
  reported: { conditions: [], sample_types: [] },
  source_evidence: [],
  audit_state: "pending",
} as unknown as BiobankOpportunity;

const SUPPLIER_PHONE =
  process.env.CROVI_BIO_PHONE_NUMBER ?? process.env.DEMO_SUPPLIER_PHONE ?? "+15555550100";
const BUYER_PHONE =
  process.env.NOVACURE_BUYER_PHONE ?? process.env.DEMO_BUYER_PHONE ?? "+15555550199";

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

  // Build the handler set the transition dispatcher will use.
  const handlers = buildHandlers(runId);

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
// Stage 1 fast-path. Real Playwright form fill would call submitForm() from
// lib/integrations/browser-use; for the demo flow we emit a coherent thread
// of ChainStageEvents so the Timeline lights up immediately, then mark the
// stage complete with `waitlist` outcome (which the transition table maps
// to → call).
// ---------------------------------------------------------------------------

async function fireForm(
  state: ChainState,
  runId: string,
  handlers: ChainHandlers,
): Promise<void> {
  const intake = readIntake(runId);
  const indication =
    (intake?.fields.find((f) => f.field_id === "study.therapeutic_area")?.value as string) ??
    "NSCLC III-IV";
  const quantity =
    (intake?.fields.find((f) => f.field_id === "specimen.total_quantity")?.value as string) ??
    "150 / 75";

  state.stages.form.status = "in_progress";
  state.stages.form.started_at = new Date().toISOString();
  appendEvent(state, "form", {
    event_id: `stage-form-event-1`,
    timestamp: new Date().toISOString(),
    direction: "system",
    actor: "browser_use",
    channel: "browse",
    text: `navigating to ${CROVI_BIO.contact.quote_form_url}`,
  });
  appendEvent(state, "form", {
    event_id: `stage-form-event-2`,
    timestamp: new Date().toISOString(),
    direction: "outbound",
    actor: "agent",
    channel: "form",
    text: `typed indication = "${indication}"`,
  });
  appendEvent(state, "form", {
    event_id: `stage-form-event-3`,
    timestamp: new Date().toISOString(),
    direction: "outbound",
    actor: "agent",
    channel: "form",
    text: `typed quantity = "${quantity}"`,
  });
  appendEvent(state, "form", {
    event_id: `stage-form-event-4`,
    timestamp: new Date().toISOString(),
    direction: "inbound",
    actor: "supplier",
    channel: "form",
    text: `form response: "Added to waitlist — capacity verification required."`,
  });
  appendEvent(state, "form", {
    event_id: `stage-form-event-5`,
    timestamp: new Date().toISOString(),
    direction: "reasoning",
    actor: "agent",
    text: "Waitlist outcome insufficient for SLA. Escalating to direct contact via voice.",
  });
  saveChainState(state);

  // Mark complete with outcome `waitlist` → cascades to fireCall.
  await completeStage(state, { stage: "form", kind: "waitlist" }, handlers);
}

// ---------------------------------------------------------------------------
// Handler set. fireCall + fireSmsPay come from defaultChainHandlers (which
// owns the AgentPhone wire + pointer-file bookkeeping). We override fireEmail
// and fireMeeting here because they belong to different integration owners.
// ---------------------------------------------------------------------------

function buildHandlers(runId: string): ChainHandlers {
  return defaultChainHandlers(
    {
      supplierPhone: SUPPLIER_PHONE,
      buyerPhone: BUYER_PHONE,
      voiceAgentId: process.env.AGENTPHONE_VOICE_AGENT_ID ?? "",
      callContext: {
        buyer: { company: "NovaCure", contact: "Demo BD", study: "NSCLC Liquid Biopsy Validation" },
        supplier: { id: "crovi_bio", name: "Crovi.bio" },
        evidence_targets: [
          "specimen.types",
          "specimen.format",
          "biomarker.subsets",
          "regulatory.cap_clia",
        ],
      },
      smsBody:
        "Crovi.bio contract drafted — reply CONFIRMED to authorize $10 goodwill down payment and lock allocation.",
    },
    {
      fireEmail: async (state) => {
        await fireEmail(state, runId);
      },
      fireMeeting: async (state) => {
        await fireMeeting(state, runId);
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — Email. Sends a Filled Intake + Quote email to crovi.bio's BD via
// AgentMail. After the send, the supplier reply must come in via the AgentMail
// webhook (/api/webhooks/agentmail) to advance the chain. For the demo, the
// operator can hit the "Reply: I agree" inbox UI; that fires the webhook,
// which calls completeStage(email/replied_yes) → fireSmsPay cascades.
// ---------------------------------------------------------------------------

async function fireEmail(state: ChainState, runId: string): Promise<void> {
  state.stages.email.status = "in_progress";
  state.stages.email.started_at = new Date().toISOString();
  saveChainState(state);

  const intake = readIntake(runId);
  const studyName =
    (intake?.fields.find((f) => f.field_id === "study.name")?.value as string) ??
    "NSCLC Liquid Biopsy Validation Study";

  const body = [
    `Hi ${CROVI_BIO.contact.bd_name ?? "Crovi.bio BD"},`,
    ``,
    `Per our call, attached is the filled intake and a benchmarked quote for ${studyName}.`,
    ``,
    `Scope: 150 plasma + 75 matched FFPE/slides, Stage III-IV NSCLC,`,
    `EGFR/KRAS/ALK enriched. Total $213,750 (11% below industry median).`,
    ``,
    `Terms: 30 days validity, $10 goodwill down payment via Sponge to lock allocation.`,
    `Reply "I agree" to proceed.`,
    ``,
    `— Crovi Agent on behalf of NovaCure`,
  ].join("\n");

  const rendered = [
    `Subject: Crovi.bio × NovaCure — Filled Intake + Quote ($213,750)`,
    ``,
    body,
  ].join("\n");

  try {
    const sent = await sendEmail({
      runId,
      runDir: `store/runs/${runId}`,
      supplier: CROVI_BIO,
      rendered,
    });
    appendEvent(state, "email", {
      event_id: `stage-email-event-1`,
      timestamp: sent.sent_at,
      direction: "outbound",
      actor: "agent",
      channel: "email",
      text: `Sent to ${sent.envelope.to} with Filled Intake + Quote attachments (subject: ${sent.envelope.subject})`,
      payload: { message_id: sent.message_id, thread_id: sent.thread_id, mode: sent.mode },
    });
    state.stages.email.artifact_id = sent.message_id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendEvent(state, "email", {
      event_id: `stage-email-event-error`,
      timestamp: new Date().toISOString(),
      direction: "system",
      actor: "agent",
      channel: "email",
      text: `Email send failed: ${message}`,
    });
    state.stages.email.status = "failed";
  }
  saveChainState(state);
  // Note: we DO NOT call completeStage here — completion is triggered by the
  // supplier's inbound reply (AgentMail webhook → completeStage email/replied_yes).
}

// ---------------------------------------------------------------------------
// Stage 5 — Meeting. Drives the Notion calendar in headed Playwright. Real
// Chromium window pops up on stage; the agent picks a slot and submits.
// ---------------------------------------------------------------------------

async function fireMeeting(state: ChainState, runId: string): Promise<void> {
  state.stages.meeting.status = "in_progress";
  state.stages.meeting.started_at = new Date().toISOString();
  saveChainState(state);

  const intake = readIntake(runId);
  const attendeeName =
    (intake?.buyer?.contact as string | undefined) ?? "NovaCure Procurement";
  const attendeeEmail =
    (intake?.buyer?.email as string | undefined) ??
    process.env.NOVACURE_BUYER_EMAIL ??
    "procurement@novacure.example";

  // Fire and forget — the headed Chromium window will hold attention on stage.
  // We don't block the request for the full 60s booking timeout.
  void (async () => {
    try {
      const result = await bookSlot({
        runId,
        supplierId: "crovi_bio",
        attendeeName,
        attendeeEmail,
        agenda: "Crovi.bio × NovaCure — Shipment logistics & contract review",
      });
      const live = loadChainState(runId);
      if (!live) return;
      appendEvent(live, "meeting", {
        event_id: `stage-meeting-event-1`,
        timestamp: new Date().toISOString(),
        direction: "system",
        actor: "cal",
        channel: "calendar",
        text: result.ok
          ? `createEvent → ${result.event_id} (mode: ${result.mode})`
          : `Notion calendar booking partial: ${result.error ?? "unknown"}`,
        payload: { event_id: result.event_id, mode: result.mode },
      });
      live.stages.meeting.status = result.ok ? "complete" : "fallback";
      live.stages.meeting.completed_at = new Date().toISOString();
      live.stages.meeting.artifact_id = result.event_id;
      saveChainState(live);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const live = loadChainState(runId);
      if (!live) return;
      appendEvent(live, "meeting", {
        event_id: `stage-meeting-event-error`,
        timestamp: new Date().toISOString(),
        direction: "system",
        actor: "cal",
        channel: "calendar",
        text: `bookSlot threw: ${message}`,
      });
      live.stages.meeting.status = "failed";
      saveChainState(live);
    }
  })();

  // Emit a kickoff event so the timeline lights immediately.
  appendEvent(state, "meeting", {
    event_id: `stage-meeting-event-0`,
    timestamp: new Date().toISOString(),
    direction: "system",
    actor: "agent",
    channel: "calendar",
    text: `Opening Notion calendar via Playwright (live on laptop)…`,
  });
  saveChainState(state);
}
