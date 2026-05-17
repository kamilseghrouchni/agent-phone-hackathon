// /api/webhooks/agentphone — inbound webhook for the AgentPhone host sponsor.
//
// Two event types matter for the demo:
//   1. sms.received   — buyer replies to the Stage-4 authorization SMS.
//      If body matches /CONFIRMED/i → call onSmsAuthorized to trigger Sponge
//      via the Pay agent's wallet.transfer (loaded dynamically — Pay agent
//      owns lib/integrations/sponge.ts; we never import it at module load
//      so this file stays decoupled).
//   2. call.completed — Stage-2 call wrapped up.
//      Write the transcript into the ChainState as ChainStageEvent[]s and
//      run the voice-persona outcome parser to emit SupplierEvidence.
//
// Signature verification is MANDATORY. AGENTPHONE_WEBHOOK_SECRET must be set.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import {
  verifyWebhookSignature,
  parseInboundEvent,
  isAuthorizationSms,
  type AgentPhoneInboundEvent,
  type InboundSmsEvent,
  type CallCompletedEvent,
} from "@/lib/integrations/agentphone";
import { parseCallOutcome } from "@/lib/agents/voice-persona";
import type { ChainStageEvent, ChainState } from "@/types/chain";
import type { SupplierEvidence } from "@/types/evidence";

// ---------------------------------------------------------------------------
// Run lookup. We don't have a single global registry; persist a per-run
// pointer at `store/runs/<runId>/agentphone.json` whenever a call/SMS is
// initiated, then scan to map call_id / sms thread back to its run.
// ---------------------------------------------------------------------------

interface AgentPhonePointer {
  run_id: string;
  supplier_id: string;
  buyer_phone?: string;
  call_ids?: string[];
  outbound_sms_ids?: string[];
}

function getRepoRoot(): string {
  // Walk up from cwd until we find package.json. Fallback to cwd.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function findRunByCallId(callId: string): AgentPhonePointer | null {
  const runsDir = path.join(getRepoRoot(), "store", "runs");
  if (!fs.existsSync(runsDir)) return null;
  for (const runId of fs.readdirSync(runsDir)) {
    const p = path.join(runsDir, runId, "agentphone.json");
    if (!fs.existsSync(p)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(p, "utf-8")) as AgentPhonePointer;
      if (r.call_ids?.includes(callId)) return r;
    } catch {
      /* skip */
    }
  }
  return null;
}

function findRunByBuyerPhone(fromNumber: string): AgentPhonePointer | null {
  const runsDir = path.join(getRepoRoot(), "store", "runs");
  if (!fs.existsSync(runsDir)) return null;
  for (const runId of fs.readdirSync(runsDir)) {
    const p = path.join(runsDir, runId, "agentphone.json");
    if (!fs.existsSync(p)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(p, "utf-8")) as AgentPhonePointer;
      if (r.buyer_phone && normalizePhone(r.buyer_phone) === normalizePhone(fromNumber)) return r;
    } catch {
      /* skip */
    }
  }
  return null;
}

function normalizePhone(s: string): string {
  return s.replace(/[^\d]/g, "");
}

// ---------------------------------------------------------------------------
// Chain state writers — append events; flag stage outcomes for the runtime.
// ---------------------------------------------------------------------------

function chainPath(runId: string): string {
  return path.join(getRepoRoot(), "store", "runs", runId, "chain.json");
}

function evidencePath(runId: string): string {
  return path.join(getRepoRoot(), "store", "runs", runId, "evidence.jsonl");
}

function readChain(runId: string): ChainState | null {
  const p = chainPath(runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ChainState;
  } catch {
    return null;
  }
}

function writeChain(state: ChainState): void {
  const p = chainPath(state.run_id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

function appendEvidence(runId: string, items: SupplierEvidence[]): void {
  if (items.length === 0) return;
  const p = evidencePath(runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const lines = items.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(p, lines);
}

// ---------------------------------------------------------------------------
// Pay-agent callback. Loaded dynamically — the Pay agent owns the file. We
// catch import failures so a missing module degrades gracefully (the demo
// still surfaces a clean error rather than 500-ing).
// ---------------------------------------------------------------------------

interface PayAgentModule {
  // Either named export shape works.
  onSmsAuthorized?: (opts: {
    runId: string;
    supplierId: string;
    smsEvent: InboundSmsEvent;
  }) => Promise<unknown>;
  // OR raw sponge wrapper export — fallback path.
  createDownPayment?: (opts: {
    runId: string;
    supplierId: string;
    amountCents: number;
  }) => Promise<unknown>;
}

async function loadPayAgent(): Promise<PayAgentModule | null> {
  try {
    return (await import("@/lib/integrations/sponge")) as PayAgentModule;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleSms(evt: InboundSmsEvent): Promise<NextResponse> {
  const pointer = findRunByBuyerPhone(evt.from);
  if (!pointer) {
    return NextResponse.json(
      { error: `No run owns buyer phone ${evt.from}` },
      { status: 404 },
    );
  }
  // Always thread the SMS into the chain timeline (Stage 4).
  const state = readChain(pointer.run_id);
  if (state) {
    const event: ChainStageEvent = {
      event_id: `sms_pay:inbound:${evt.sms_id}`,
      timestamp: evt.received_at,
      direction: "inbound",
      actor: "buyer",
      channel: "sms",
      text: evt.body,
    };
    state.stages.sms_pay.events.push(event);
    writeChain(state);
  }

  if (!isAuthorizationSms(evt.body)) {
    return NextResponse.json({
      runId: pointer.run_id,
      matched: false,
      reason: "SMS did not match CONFIRMED authorization pattern",
    });
  }

  // Authorization matched → fire Pay agent.
  const pay = await loadPayAgent();
  let payResult: unknown = { skipped: true, reason: "Pay agent module not loaded" };
  let paySucceeded = false;
  if (pay) {
    if (pay.onSmsAuthorized) {
      payResult = await pay.onSmsAuthorized({
        runId: pointer.run_id,
        supplierId: pointer.supplier_id,
        smsEvent: evt,
      });
      // Best-effort success detection — onSmsAuthorized may return any shape.
      paySucceeded = Boolean(
        payResult && typeof payResult === "object" && "ok" in (payResult as Record<string, unknown>) && (payResult as { ok: unknown }).ok,
      );
    } else if (pay.createDownPayment) {
      const r = (await pay.createDownPayment({
        runId: pointer.run_id,
        supplierId: pointer.supplier_id,
        amountCents: 1000,
      })) as { ok?: boolean };
      payResult = r;
      paySucceeded = Boolean(r?.ok);
    } else {
      payResult = { skipped: true, reason: "Pay agent exposed no compatible export" };
    }
  }

  // Advance the chain to Stage 5 (meeting) when payment settles.
  // Loaded dynamically so this route stays decoupled from chain-runtime at
  // module load — same pattern as the pay agent dynamic import above.
  if (paySucceeded) {
    try {
      const runtime = (await import("@/lib/agents/runtime/chain-runtime")) as typeof import("@/lib/agents/runtime/chain-runtime");
      const live = runtime.loadChainState(pointer.run_id);
      if (live) {
        // We need the same fireMeeting closure the chain-start route built.
        // The simplest decoupled path: dynamically import the chain/start
        // helper to rebuild the handler set. But to keep this webhook tiny,
        // we instead call completeStage with a minimal handlers object that
        // fires the meeting via the same calcom integration the start route uses.
        const { bookSlot } = await import("@/lib/integrations/calcom");
        const handlers = {
          fireCall: () => {},
          fireEmail: () => {},
          fireSmsPay: () => {},
          fireMeeting: async (state: import("@/types/chain").ChainState) => {
            state.stages.meeting.status = "in_progress";
            state.stages.meeting.started_at = new Date().toISOString();
            state.stages.meeting.events.push({
              event_id: `stage-meeting-event-0`,
              timestamp: new Date().toISOString(),
              direction: "system",
              actor: "agent",
              channel: "calendar",
              text: "Opening Notion calendar via Playwright (live on laptop)…",
            });
            runtime.saveChainState(state);
            void (async () => {
              try {
                const result = await bookSlot({
                  runId: pointer.run_id,
                  supplierId: pointer.supplier_id,
                  attendeeName: "NovaCure Procurement",
                  attendeeEmail: process.env.NOVACURE_BUYER_EMAIL ?? "procurement@novacure.example",
                  agenda: "Crovi.bio × NovaCure — Shipment logistics & contract review",
                });
                const refreshed = runtime.loadChainState(pointer.run_id);
                if (!refreshed) return;
                refreshed.stages.meeting.events.push({
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
                refreshed.stages.meeting.status = result.ok ? "complete" : "fallback";
                refreshed.stages.meeting.completed_at = new Date().toISOString();
                refreshed.stages.meeting.artifact_id = result.event_id;
                runtime.saveChainState(refreshed);
              } catch {
                // best-effort
              }
            })();
          },
        };
        await runtime.completeStage(live, { stage: "sms_pay", kind: "confirmed" }, handlers);
      }
    } catch {
      // best-effort: cascade failure should not 500 the webhook
    }
  }

  return NextResponse.json({
    runId: pointer.run_id,
    matched: true,
    pay: payResult,
    cascadedToMeeting: paySucceeded,
  });
}

async function handleCallCompleted(
  evt: CallCompletedEvent,
): Promise<NextResponse> {
  const pointer = findRunByCallId(evt.call_id);
  if (!pointer) {
    return NextResponse.json(
      { error: `No run owns call ${evt.call_id}` },
      { status: 404 },
    );
  }
  const state = readChain(pointer.run_id);
  if (state) {
    // Write the transcript turns as ChainStageEvents in Stage 2 (call).
    const baseTs = evt.completed_at;
    const transcript = evt.transcript ?? [];
    transcript.forEach((turn, i) => {
      state.stages.call.events.push({
        event_id: `call:${evt.call_id}:turn-${i}`,
        timestamp: turn.timestamp ?? baseTs,
        direction: turn.turn === "agent" ? "outbound" : "inbound",
        actor: turn.turn === "agent" ? "agent" : "supplier",
        channel: "call",
        text: turn.text,
      });
    });
    state.stages.call.events.push({
      event_id: `call:${evt.call_id}:completed`,
      timestamp: baseTs,
      direction: "system",
      actor: "agent",
      channel: "call",
      text: `Call ${evt.status} (${evt.duration_sec ?? 0}s)`,
      payload: { call_id: evt.call_id, status: evt.status },
    });
    state.stages.call.artifact_id = evt.call_id;
    state.stages.call.completed_at = baseTs;
    state.stages.call.status = evt.status === "completed" ? "complete" : "fallback";
    writeChain(state);
  }

  // Outcome parser → evidence.
  const evidence = parseCallOutcome({
    supplier_id: pointer.supplier_id,
    call: evt,
  });
  appendEvidence(pointer.run_id, evidence);

  return NextResponse.json({
    runId: pointer.run_id,
    callId: evt.call_id,
    status: evt.status,
    evidenceWritten: evidence.length,
  });
}

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Signature verification — MUST run on the raw body before parsing.
  const raw = await req.text();
  const sig = req.headers.get("x-agentphone-signature");
  if (!verifyWebhookSignature(raw, sig)) {
    return NextResponse.json(
      { error: "Invalid AgentPhone webhook signature" },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const evt: AgentPhoneInboundEvent | null = parseInboundEvent(payload);
  if (!evt) {
    return NextResponse.json(
      { error: "Unrecognized AgentPhone event" },
      { status: 400 },
    );
  }

  if (evt.type === "sms.received") return handleSms(evt);
  if (evt.type === "call.completed" || evt.type === "call.failed") {
    return handleCallCompleted(evt);
  }
  return NextResponse.json({ error: "Unhandled event type" }, { status: 400 });
}
