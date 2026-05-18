// Shared ChainHandlers factory — single source of truth for the wiring
// that turns each stage's `complete` outcome into the NEXT stage's fire-
// side effect. Both the /api/chain/start route AND the webhook handlers
// (/api/webhooks/agentphone, /api/webhooks/agentmail) import this so
// completeStage() does the same thing regardless of who calls it.
//
// Inputs are env-only: SUPPLIER_PHONE, BUYER_PHONE, AGENTPHONE_VOICE_AGENT_ID,
// NOVACURE_BUYER_EMAIL. Caller passes just `runId` + supplier metadata.

import { defaultChainHandlers } from "@/lib/agents/runtime/chain-runtime";
import type { ChainHandlers } from "@/lib/agents/runtime/chain-transitions";
import type { ChainState } from "@/types/chain";
import { sendEmail } from "@/lib/integrations/agentmail";
import { bookSlot } from "@/lib/integrations/calcom";
import { readIntake } from "@/lib/store/runs";
import {
  loadChainState,
  saveChainState,
  appendEvent,
} from "@/lib/agents/runtime/chain-runtime";
import type { BiobankOpportunity } from "@/types/biobank";

const SUPPLIER_PHONE =
  process.env.CROVI_BIO_PHONE_NUMBER ??
  process.env.DEMO_SUPPLIER_PHONE ??
  process.env.DEMO_CALL_TARGET_PHONE ??
  "+15555550100";
const BUYER_PHONE =
  process.env.NOVACURE_BUYER_PHONE ??
  process.env.DEMO_BUYER_PHONE ??
  process.env.DEMO_CALL_TARGET_PHONE ??
  "+15555550199";
const VOICE_AGENT_ID = process.env.AGENTPHONE_VOICE_AGENT_ID ?? "";

// crovi.bio is the canonical Stage-2..5 supplier for the demo. Stays
// in sync with the constant in app/api/chain/start/route.ts.
const CROVI_BIO: BiobankOpportunity = {
  id: "crovi_bio",
  name: "Crovi.bio",
  contact: {
    // crovi.bio public contact — published on the website + forwarded to
    // kamil. Whitelisted on the crovi@agentmail.to inbox send-allowlist
    // (POST /inboxes/crovi@agentmail.to/lists/send/allow) so AgentMail's
    // suppression cache doesn't block sends after the initial bounce.
    email: process.env.CROVI_BIO_BD_EMAIL ?? "agents@crovi.bio",
    bd_name: process.env.CROVI_BIO_BD_NAME ?? "Crovi.bio BD",
    site_url: process.env.CROVI_INTAKE_FORM ?? "https://crovi.bio/agent-launched",
    quote_form_url:
      process.env.CROVI_INTAKE_FORM ?? "https://crovi.bio/agent-launched",
  },
  reported: { conditions: [], sample_types: [] },
  source_evidence: [],
  audit_state: "pending",
} as unknown as BiobankOpportunity;

export function buildHandlersForRun(runId: string): ChainHandlers {
  return defaultChainHandlers(
    {
      supplierPhone: SUPPLIER_PHONE,
      buyerPhone: BUYER_PHONE,
      voiceAgentId: VOICE_AGENT_ID,
      callContext: {
        buyer: {
          company: "NovaCure",
          contact: "Demo BD",
          study: "NSCLC Liquid Biopsy Validation",
        },
        supplier: { id: "crovi_bio", name: "Crovi.bio" },
        evidence_targets: [
          "specimen.types",
          "specimen.format",
          "biomarker.subsets",
          "regulatory.cap_clia",
        ],
      },
      smsBody:
        "Crovi.bio contract drafted — reply CONFIRMED to authorize $1 goodwill down payment and lock allocation.",
    },
    {
      fireEmail: async (state) => {
        await fireEmailStage(state, runId);
      },
      fireMeeting: async (state) => {
        await fireMeetingStage(state, runId);
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — Email (filled intake + quote → bd@crovi.bio). Completion happens
// via the AgentMail reply webhook, NOT here.
// ---------------------------------------------------------------------------

async function fireEmailStage(state: ChainState, runId: string): Promise<void> {
  state.stages.email.status = "in_progress";
  state.stages.email.started_at = new Date().toISOString();
  saveChainState(state);

  const intake = readIntake(runId);
  const studyName =
    (intake?.fields.find((f) => f.field_id === "client.study_name")?.value as string) ??
    (intake?.fields.find((f) => f.field_id === "study.name")?.value as string) ??
    "NSCLC Liquid Biopsy Validation Study";
  const sponsorName =
    (intake?.fields.find((f) => f.field_id === "client.company")?.value as string) ??
    "NovaCure Therapeutics";

  const body = [
    `Hi ${CROVI_BIO.contact.bd_name ?? "Crovi.bio BD"},`,
    ``,
    `Per our call, here's the filled intake + benchmarked quote for ${studyName} (${sponsorName}).`,
    ``,
    `Scope: 150 plasma + 75 matched FFPE/slides, Stage III-IV NSCLC,`,
    `EGFR/KRAS/ALK enriched. Total $213,750 (11% below industry median).`,
    ``,
    `Reply "I agree" to lock allocation — funds wire and meeting auto-book on your reply.`,
    ``,
    `— Crovi Agent on behalf of ${sponsorName}`,
  ].join("\n");

  const rendered = [
    `Subject: Crovi.bio × ${sponsorName} — Filled Intake + Quote ($213,750)`,
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
      text: `Sent to ${sent.envelope.to} with Filled Intake + Quote (${sent.envelope.subject})`,
      payload: {
        message_id: sent.message_id,
        thread_id: sent.thread_id,
        mode: sent.mode,
      },
    });
    state.stages.email.artifact_id = sent.message_id;
    // Localhost has no public webhook URL → AgentMail's reply webhook
    // doesn't reach us. The poller below hits threads.get(thread_id)
    // every 5s and treats each newly-seen inbound message exactly like
    // the webhook would: append + cascade-on-agree.
    if (sent.thread_id && !sent.thread_id.startsWith("unknown_")) {
      startEmailReplyPoller(runId, sent.thread_id);
    }
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
}

// ---------------------------------------------------------------------------
// Stage 5 — Meeting (Notion calendar Playwright booking). Fire-and-forget so
// the cascade returns immediately; the headed Chromium window completes in
// the background.
// ---------------------------------------------------------------------------

async function fireMeetingStage(
  state: ChainState,
  runId: string,
): Promise<void> {
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

      // Supermemory write — persist this run's outcomes against the
      // supplier so future chains can recall them. Surfaces in the next
      // chain's pre-Stage-1 Supermemory recall event.
      try {
        const { supermemory, supermemoryConfigured } = await import(
          "@/lib/integrations/supermemory"
        );
        if (supermemoryConfigured()) {
          const callOk = live.stages.call.status === "complete";
          const emailOk = live.stages.email.status === "complete";
          const smsOk = live.stages.sms_pay.status === "complete";
          const meetingOk = result.ok;
          const summary = [
            `Procurement chain completed for ${live.supplier_id}.`,
            `Outcomes: call=${callOk ? "ok" : "skipped"} email=${emailOk ? "agreed" : "n/a"} sms_pay=${smsOk ? "settled $1" : "stub"} meeting=${meetingOk ? "booked" : "partial"}.`,
            `Scope: 150 plasma + 75 FFPE, Stage III-IV NSCLC, budget $188K-$240K.`,
          ].join(" ");
          await supermemory.writeChainCompletion({
            supplierId: live.supplier_id,
            runId,
            summary,
            metadata: {
              attendee_email: attendeeEmail,
              meeting_event_id: result.event_id ?? null,
            },
          });
          const after = loadChainState(runId);
          if (after) {
            appendEvent(after, "meeting", {
              event_id: `supermemory:writeChainCompletion:${Date.now()}`,
              timestamp: new Date().toISOString(),
              direction: "system",
              actor: "agent",
              text: `Supermemory: chain summary persisted under supplier:${live.supplier_id} for future-run recall.`,
            });
            saveChainState(after);
          }
        }
      } catch {
        // best-effort — chain stays complete even if supermemory write fails
      }
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

/**
 * Email-agree fanout — fires Sponge transfer + SMS notification + meeting
 * IN PARALLEL when the supplier agrees to the contract.
 *
 * Replaces the old SMS-CONFIRMED gate. The user explicitly didn't want a
 * goodwill-confirmation step — agreeing to the contract is consent. We
 * now:
 *   1. Mark email complete
 *   2. Fire Sponge USDC transfer (real $1 wire, see sponge.ts)
 *   3. Send SMS as a NOTIFICATION ("✓ Allocation locked, $X settled")
 *   4. Fire meeting in parallel with #2 and #3 — calendar Playwright needs
 *      the runway and can't wait for SMS round-trips
 *
 * Both the agentmail webhook AND the email-reply poller call this when
 * isEmailAgreeReply returns true. Idempotent — safe to call twice (each
 * leg checks state and no-ops if already complete).
 */
export async function fanoutOnEmailAgree(
  runId: string,
  state: ChainState,
): Promise<void> {
  // 1. Mark email complete (idempotent).
  const now = new Date().toISOString();
  if (state.stages.email.status !== "complete") {
    state.stages.email.status = "complete";
    state.stages.email.completed_at = now;
    saveChainState(state);
  }

  // 2 + 3 + 4: launch all in parallel.
  const handlers = buildHandlersForRun(runId);
  const tasks: Array<Promise<unknown>> = [];

  if (state.stages.sms_pay.status !== "complete") {
    tasks.push(fireSpongeAndNotify(runId));
  }
  if (state.stages.meeting.status !== "complete") {
    tasks.push(Promise.resolve(handlers.fireMeeting(state)));
  }

  await Promise.allSettled(tasks);
}

/**
 * Stage 4 fast path — Sponge USDC transfer + outbound SMS notification.
 * The Sponge call writes the wire event and marks sms_pay complete
 * itself (see lib/integrations/sponge.ts createDownPayment). After
 * settlement we send a notification SMS with the Solscan link so the
 * buyer sees the chain hash in their messages app.
 */
async function fireSpongeAndNotify(runId: string): Promise<void> {
  const initial = loadChainState(runId);
  if (!initial) return;
  if (initial.stages.sms_pay.status === "complete") return;

  initial.stages.sms_pay.status = "in_progress";
  initial.stages.sms_pay.started_at = new Date().toISOString();
  saveChainState(initial);

  const envCents = Number(process.env.SPONGE_DEMO_AMOUNT_CENTS);
  const amountCents = Math.min(
    100,
    Number.isFinite(envCents) && envCents > 0 ? envCents : 100,
  );

  const { createDownPayment } = await import("@/lib/integrations/sponge");
  const tx = await createDownPayment({
    runId,
    supplierId: initial.supplier_id,
    amountCents,
  });

  // After Sponge: re-read state (createDownPayment mutates it) and append
  // an outbound SMS notification with the tx hash / solscan url.
  const after = loadChainState(runId);
  if (!after) return;

  let solscanUrl: string | undefined;
  let txHash: string | undefined;
  for (const e of after.stages.sms_pay.events) {
    const p = e.payload as
      | { solscanUrl?: string; txHash?: string; transferId?: string }
      | undefined;
    if (p?.solscanUrl || p?.txHash || p?.transferId) {
      solscanUrl = p.solscanUrl;
      txHash = p.txHash ?? p.transferId;
      break;
    }
  }
  const amountUsd = (amountCents / 100).toFixed(2);
  const body = tx.ok
    ? solscanUrl
      ? `✓ Allocation locked — $${amountUsd} USDC settled via Sponge. ${solscanUrl}`
      : `✓ Allocation locked — $${amountUsd} USDC settled via Sponge${txHash ? ` (tx ${txHash.slice(0, 10)}…)` : ""}.`
    : `Sponge transfer failed. We'll retry shortly.`;

  try {
    const { smsSend } = await import("@/lib/integrations/agentphone");
    const sms = await smsSend(BUYER_PHONE, body);
    appendEvent(after, "sms_pay", {
      event_id: `sms_pay:notify:${sms.sms_id}`,
      timestamp: sms.sent_at,
      direction: "outbound",
      actor: "agent",
      channel: "sms",
      text: body,
      payload: { sms_id: sms.sms_id, mode: sms.mode, error: sms.error },
    });
    saveChainState(after);
  } catch (err) {
    // SMS down — Sponge already settled, log and move on. Meeting is
    // already firing in parallel.
    appendEvent(after, "sms_pay", {
      event_id: `sms_pay:notify:failed_${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: "system",
      actor: "agent",
      channel: "sms",
      text: `SMS notification failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    saveChainState(after);
  }
}

/** Best-effort agree-detector for the email-reply webhook + poller.
 *
 * Broad on purpose — BD replies are noisy and the demo can't bounce on
 * phrasing. Matches: i agree, agree, agreed, approve, approved, confirm,
 * confirmed, yes / ya / yep / yeah (standalone OK), ok / okay, sure,
 * sounds good, lgtm, go (let's go / go ahead), perfect, great.
 *
 * Explicit no-detector wins so "no", "not now", "decline" don't false-fire.
 */
export function isEmailAgreeReply(body: string): boolean {
  const text = body.toLowerCase();
  if (/\b(no\b|nope|not\s+(now|interested|today)|declin|reject|pass\b|hold\s+off)/i.test(text)) {
    return false;
  }
  return /\b(i\s*agree|agreed?|approved?|confirm(ed)?|yes\b|yep\b|yeah\b|ya\b|ok(ay)?\b|sure\b|sounds?\s+good|lgtm|let'?s\s+(go|do)|go\s+ahead|perfect\b|great\b|👍|🤝)/i.test(
    text,
  );
}

// ---------------------------------------------------------------------------
// Call-completion poller — the no-webhook fallback path.
//
// AgentPhone webhooks need a public URL + AGENTPHONE_WEBHOOK_SECRET. On
// localhost without ngrok neither exists, so the `call.completed` event
// never reaches us → the chain stalls at Stage 2 even on successful calls.
//
// This poller is the workaround: after `callOut` returns a real call_id,
// we hit `getCall(call_id)` every POLL_INTERVAL_MS until status flips to
// completed / failed / no_answer, then run the exact same path the webhook
// handler does (write transcript events, parse evidence, completeStage →
// cascade to email).
//
// One active poller per (runId, callId). The interval is recorded in an
// in-process map so duplicate calls don't pile up; cleared on terminal
// state or on hitting MAX_POLL_DURATION_MS.
// ---------------------------------------------------------------------------

const ACTIVE_POLLERS = new Map<string, NodeJS.Timeout>();
const POLL_INTERVAL_MS = 3_000;
// Demo budget: the call prompt caps at 20s. We give the poller 60s to
// catch the post-call terminal status — anything past that, we cascade
// to email as fallback so the chain doesn't visibly stall.
const MAX_POLL_DURATION_MS = 60 * 1000;

export function startCallCompletionPoller(
  runId: string,
  callId: string,
): void {
  if (!callId || callId.startsWith("error_") || callId.startsWith("missing_env_") || callId.startsWith("unknown_")) {
    // Don't poll a call that never went out on the wire.
    return;
  }
  const key = `${runId}:${callId}`;
  if (ACTIVE_POLLERS.has(key)) return;

  const startedAt = Date.now();
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
        // Soft timeout: chain must keep moving for the demo. Mark the call
        // as a no-answer fallback and cascade to email so the audience sees
        // forward progress instead of a permanently spinning Stage 2.
        stopPoller(key);
        const stalled = loadChainState(runId);
        if (stalled) {
          const completedAt = new Date().toISOString();
          appendEvent(stalled, "call", {
            event_id: `call:${callId}:timeout`,
            timestamp: completedAt,
            direction: "system",
            actor: "agent",
            channel: "call",
            text: `Call did not reach a terminal status within ${Math.round(MAX_POLL_DURATION_MS / 1000)}s — treating as no-answer and cascading to email.`,
          });
          stalled.stages.call.artifact_id = callId;
          stalled.stages.call.completed_at = completedAt;
          stalled.stages.call.status = "fallback";
          saveChainState(stalled);
          const { completeStage } = await import(
            "@/lib/agents/runtime/chain-runtime"
          );
          const handlers = buildHandlersForRun(runId);
          await completeStage(
            stalled,
            { stage: "call", kind: "no_answer" },
            handlers,
          );
        }
        return;
      }
      const { getCall, getCallTranscript } = await import(
        "@/lib/integrations/agentphone"
      );
      const snap = await getCall(callId);
      if (snap.status !== "completed" && snap.status !== "failed" && snap.status !== "no_answer") {
        return; // still in flight
      }

      // Terminal — pull transcript, fire the same flow as the webhook.
      stopPoller(key);
      const transcriptResp = snap.status === "completed"
        ? await getCallTranscript(callId)
        : { call_id: callId, transcript: [], mode: "real" as const };

      const live = loadChainState(runId);
      if (!live) return;

      const completedAt = snap.ended_at ?? new Date().toISOString();
      const transcript = transcriptResp.transcript ?? [];
      transcript.forEach((turn, i) => {
        appendEvent(live, "call", {
          event_id: `call:${callId}:turn-${i}`,
          timestamp: turn.timestamp ?? completedAt,
          direction: turn.turn === "agent" ? "outbound" : "inbound",
          actor: turn.turn === "agent" ? "agent" : "supplier",
          channel: "call",
          text: turn.text,
        });
      });
      appendEvent(live, "call", {
        event_id: `call:${callId}:completed`,
        timestamp: completedAt,
        direction: "system",
        actor: "agent",
        channel: "call",
        text: `Call ${snap.status} (${snap.duration_sec ?? 0}s · via poller)`,
        payload: {
          call_id: callId,
          status: snap.status,
          via: "poller",
          duration_sec: snap.duration_sec,
        },
      });
      live.stages.call.artifact_id = callId;
      live.stages.call.completed_at = completedAt;
      live.stages.call.status = snap.status === "completed" ? "complete" : "fallback";
      saveChainState(live);

      // Supermemory: post-call interaction tracking. Persist (a) each Q&A
      // turn pair as an individual memory and (b) a high-level summary —
      // all scoped to `supplier:<id>` so they accumulate across runs for
      // audit + future-run recall. Surfaces as a Timeline event so the
      // audience sees the tracking write happen.
      try {
        const { supermemory, supermemoryConfigured } = await import(
          "@/lib/integrations/supermemory"
        );
        if (supermemoryConfigured() && transcript.length > 0) {
          // Pair each agent turn with the supplier's next reply.
          let pairsWritten = 0;
          for (let i = 0; i < transcript.length; i++) {
            const t = transcript[i];
            if (t.turn !== "agent") continue;
            const reply = transcript.slice(i + 1).find((x) => x.turn === "supplier");
            if (!reply) continue;
            await supermemory.add({
              contextId: `supplier:${live.supplier_id}`,
              content: `[run ${runId} · call ${callId}] Q: ${t.text.trim()} A: ${reply.text.trim()}`,
              metadata: {
                supplier_id: live.supplier_id,
                run_id: runId,
                call_id: callId,
                channel: "call",
                kind: "qa_pair",
                turn_idx: i,
                timestamp: reply.timestamp ?? completedAt,
              },
            });
            pairsWritten++;
          }
          // High-level call summary
          const agentTurns = transcript.filter((t) => t.turn === "agent").length;
          const supplierTurns = transcript.filter((t) => t.turn === "supplier").length;
          await supermemory.add({
            contextId: `supplier:${live.supplier_id}`,
            content: `[run ${runId} · call ${callId}] Stage-2 call complete · ${snap.duration_sec ?? 0}s · ${agentTurns} agent turns · ${supplierTurns} supplier turns · status=${snap.status}`,
            metadata: {
              supplier_id: live.supplier_id,
              run_id: runId,
              call_id: callId,
              channel: "call",
              kind: "call_summary",
              duration_sec: snap.duration_sec ?? 0,
              completed_at: completedAt,
            },
          });
          const after = loadChainState(runId);
          if (after) {
            appendEvent(after, "call", {
              event_id: `supermemory:tracking:${Date.now()}`,
              timestamp: new Date().toISOString(),
              direction: "system",
              actor: "agent",
              channel: "call",
              text: `Supermemory: persisted ${pairsWritten} Q&A pair${pairsWritten === 1 ? "" : "s"} + 1 call summary under supplier:${live.supplier_id} (future-run recall + audit trail).`,
            });
            saveChainState(after);
          }
        }
      } catch {
        // best-effort — tracking write must not block the cascade
      }

      // Write evidence (best-effort — the parser is tolerant of empty transcripts)
      try {
        const { parseCallOutcome } = await import("@/lib/agents/voice-persona");
        const evidence = parseCallOutcome({
          supplier_id: live.supplier_id,
          call: {
            type: "call.completed",
            call_id: callId,
            status: snap.status === "completed" ? "completed" : snap.status === "no_answer" ? "no_answer" : "failed",
            duration_sec: snap.duration_sec,
            transcript,
            completed_at: completedAt,
          },
        });
        if (evidence.length > 0) {
          const fs = await import("fs");
          const path = await import("path");
          const evidencePath = path.join(
            process.cwd(),
            "store",
            "runs",
            runId,
            "evidence.jsonl",
          );
          fs.appendFileSync(
            evidencePath,
            evidence.map((e) => JSON.stringify(e)).join("\n") + "\n",
          );
        }
      } catch {
        // best-effort
      }

      // Cascade — drive the chain to Stage 3 (email).
      const { completeStage } = await import("@/lib/agents/runtime/chain-runtime");
      const handlers = buildHandlersForRun(runId);
      const kind: "complete" | "no_answer" | "failed" =
        snap.status === "completed"
          ? "complete"
          : snap.status === "no_answer"
            ? "no_answer"
            : "failed";
      await completeStage(live, { stage: "call", kind }, handlers);
    } catch {
      // best-effort; next tick will retry
    } finally {
      inFlight = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  ACTIVE_POLLERS.set(key, handle);
}

function stopPoller(key: string): void {
  const h = ACTIVE_POLLERS.get(key);
  if (h) {
    clearInterval(h);
    ACTIVE_POLLERS.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Email-reply poller — the no-webhook fallback path (mirror of the call
// poller above).
//
// AgentMail's inbound webhook needs a public URL; on localhost without
// ngrok, replies never reach us → Stage 3 hangs forever even when the
// supplier replied "yes". This poller hits threads.get(thread_id) every
// 8s, walks new inbound messages we haven't threaded yet, appends each to
// the email stage timeline, and cascades to Stage 4 on the first
// agree-flavoured reply (same isEmailAgreeReply check the webhook uses).
//
// One active poller per (runId, threadId). 5-minute ceiling per thread.
// ---------------------------------------------------------------------------

// 3s tick so the cascade fires within seconds of an "I agree" reply (was 8s
// — 8s of lag during the demo's climax beat felt dead). 30-min ceiling so we
// don't time out if the supplier takes their time to reply (was 5 min, which
// silently killed the poller mid-demo).
const EMAIL_POLL_INTERVAL_MS = 3_000;
const EMAIL_MAX_POLL_DURATION_MS = 30 * 60 * 1000;
const PROCESSED_INBOUND_IDS = new Map<string, Set<string>>(); // runId → set

export function startEmailReplyPoller(runId: string, threadId: string): void {
  const key = `email:${runId}:${threadId}`;
  if (ACTIVE_POLLERS.has(key)) return;
  // Seed the processed set with any inbound message_ids we already threaded
  // (so a re-start after a hot reload doesn't double-fire).
  const seen = PROCESSED_INBOUND_IDS.get(runId) ?? new Set<string>();
  const live = loadChainState(runId);
  if (live) {
    for (const e of live.stages.email.events) {
      if (e.direction === "inbound") {
        const id = (e.payload as { message_id?: string } | undefined)?.message_id;
        if (id) seen.add(id);
      }
    }
  }
  PROCESSED_INBOUND_IDS.set(runId, seen);

  const startedAt = Date.now();
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      if (Date.now() - startedAt > EMAIL_MAX_POLL_DURATION_MS) {
        stopPoller(key);
        return;
      }
      const { getThread } = await import("@/lib/integrations/agentmail");
      const thread = await getThread(threadId);
      if (!thread) return;

      const cur = loadChainState(runId);
      if (!cur) return;
      if (cur.stages.email.status === "complete") {
        stopPoller(key);
        return;
      }

      const processed = PROCESSED_INBOUND_IDS.get(runId) ?? new Set<string>();
      const fresh = thread.messages.filter((m) => {
        if (processed.has(m.messageId)) return false;
        const labels = (m.labels as unknown as string[]) ?? [];
        // Only inbound — sent messages have "sent" in labels, received have
        // "received" or "inbox". Be permissive: anything NOT-labeled "sent"
        // and from outside our own inbox counts as inbound.
        const isSent = labels.some((l) => /sent/i.test(l));
        return !isSent;
      });
      if (fresh.length === 0) return;

      let agreed = false;
      for (const m of fresh) {
        processed.add(m.messageId);
        const text =
          m.extractedText ?? m.text ?? m.preview ?? "";
        appendEvent(cur, "email", {
          event_id: `email:inbound:${m.messageId}`,
          timestamp: m.timestamp ?? new Date().toISOString(),
          direction: "inbound",
          actor: "supplier",
          channel: "email",
          text: text.slice(0, 400),
          payload: { thread_id: threadId, from: m.from, message_id: m.messageId },
        });
        if (isEmailAgreeReply(text)) agreed = true;
      }
      saveChainState(cur);
      PROCESSED_INBOUND_IDS.set(runId, processed);

      if (agreed) {
        stopPoller(key);
        // Skip the old completeStage(email, replied_yes) → fireSmsPay path.
        // Email agree now fans out to Sponge wire + SMS notification +
        // meeting all in parallel (no CONFIRMED gate).
        await fanoutOnEmailAgree(runId, cur);
      }
    } catch {
      // best-effort; next tick will retry
    } finally {
      inFlight = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, EMAIL_POLL_INTERVAL_MS);
  ACTIVE_POLLERS.set(key, handle);
  // Fire one tick immediately so a fast supplier reply lands without an
  // 8-second wait.
  void tick();
}
