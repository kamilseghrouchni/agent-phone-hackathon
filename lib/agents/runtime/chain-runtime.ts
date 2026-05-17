// chain-runtime.ts — owns the V4 chain state machine.
//
// TODO(stage-1-frame-stream): when the real Playwright form-fill lands here
// (replacing the lib/integrations/browser-use.ts submitForm() stub), wrap
// the page launch with a screenshot loop that calls
// emitStageFrame({ run_id, stage: "form", ts, b64 }) from
// lib/integrations/chain-frames.ts. The chain SSE endpoint already forwards
// `stage_frame` events to the Timeline; the Stage 1 card has the embedded
// <img> slot wired (see components/Chain/Timeline.tsx). Pattern to mirror:
// startCalendarFrameLoop() in lib/integrations/calcom.ts.
//
// Trunk:
//   1. init/load ChainState at store/runs/<runId>/chain.json
//   2. fireStage() runs the integration side-effect for a stage
//      (form / call / email / sms_pay / meeting) then transitions status
//   3. completeStage(outcome) hands off to chain-transitions.onStageComplete
//      which fires the *next* stage via the ChainHandlers we inject below
//
// CHAIN-OPS contract (per coordination patch):
//   When Stage 2 (call) or Stage 4 (sms_pay) fires AgentPhone, this module
//   writes/append-updates store/runs/<runId>/agentphone.json with shape:
//     {
//       run_id, supplier_id, buyer_phone,
//       call_ids: string[], outbound_sms_ids: string[]
//     }
//   The AgentPhone webhook handler (app/api/webhooks/agentphone/route.ts)
//   reads this file to map inbound call/SMS events back to the right run.
//
// Append-update semantics: on every AgentPhone call/SMS we INITIATE, push
// the new id into the appropriate array and rewrite the whole file. We never
// drop existing ids — multiple Stage-2 retries / Stage-4 reminder SMS each
// land their id in the same pointer file.

import fs from "fs";
import path from "path";
import {
  callOut,
  smsSend,
  type CallOutContext,
  type CallOutResult,
  type SmsSendResult,
} from "@/lib/integrations/agentphone";
// voice-persona transitively imports @moss-dev/moss (native binary; server-only).
// Lazy-load inside fireCall / handlers so this module can be referenced from
// shared code (e.g. mock-chain in client bundles) without pulling Moss native
// bindings into the browser webpack bundle.
import { readIntake } from "@/lib/store/runs";
import {
  onStageComplete,
  type ChainHandlers,
  type StageOutcome,
} from "@/lib/agents/runtime/chain-transitions";
import type { ChainStage, ChainStageEvent, ChainState } from "@/types/chain";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function runDir(runId: string): string {
  return path.join(getRepoRoot(), "store", "runs", runId);
}

function chainPath(runId: string): string {
  return path.join(runDir(runId), "chain.json");
}

function agentphonePointerPath(runId: string): string {
  return path.join(runDir(runId), "agentphone.json");
}

// ---------------------------------------------------------------------------
// ChainState persistence
// ---------------------------------------------------------------------------

const EMPTY_STAGES: ChainState["stages"] = {
  form: { status: "ready", events: [] },
  call: { status: "locked", events: [] },
  email: { status: "locked", events: [] },
  sms_pay: { status: "locked", events: [] },
  meeting: { status: "locked", events: [] },
};

export function loadChainState(runId: string): ChainState | null {
  const p = chainPath(runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ChainState;
  } catch {
    return null;
  }
}

export function saveChainState(state: ChainState): void {
  const p = chainPath(state.run_id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

export function initChainState(
  runId: string,
  supplierId: string,
): ChainState {
  const existing = loadChainState(runId);
  if (existing) return existing;
  const state: ChainState = {
    run_id: runId,
    supplier_id: supplierId,
    stages: JSON.parse(JSON.stringify(EMPTY_STAGES)),
    evidence_added: [],
  };
  saveChainState(state);
  return state;
}

// ---------------------------------------------------------------------------
// AgentPhone pointer file — the CHAIN-OPS contract.
//
// One file per run. The webhook handler scans store/runs/*/agentphone.json
// and matches inbound events by call_id (call.completed) or buyer_phone
// (sms.received). Each outbound call/SMS we initiate appends its id here.
// ---------------------------------------------------------------------------

export interface AgentPhonePointer {
  run_id: string;
  supplier_id: string;
  buyer_phone: string;
  call_ids: string[];
  outbound_sms_ids: string[];
}

function readPointer(runId: string): AgentPhonePointer | null {
  const p = agentphonePointerPath(runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as AgentPhonePointer;
  } catch {
    return null;
  }
}

function writePointer(ptr: AgentPhonePointer): void {
  const p = agentphonePointerPath(ptr.run_id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ptr, null, 2));
}

/**
 * Append-update the pointer with a new AgentPhone outbound id.
 *
 * - Creates the file on first call.
 * - Preserves existing call_ids / outbound_sms_ids; pushes the new id onto
 *   the matching array. De-dupes so retries don't bloat the file.
 * - buyer_phone is set from the first call and not overwritten (CHAIN-OPS
 *   uses it as a stable inbound-SMS matcher).
 */
export function recordAgentPhoneId(opts: {
  runId: string;
  supplierId: string;
  buyerPhone: string;
  kind: "call" | "sms";
  id: string;
}): AgentPhonePointer {
  const existing = readPointer(opts.runId);
  const ptr: AgentPhonePointer = existing ?? {
    run_id: opts.runId,
    supplier_id: opts.supplierId,
    buyer_phone: opts.buyerPhone,
    call_ids: [],
    outbound_sms_ids: [],
  };
  // Keep buyer_phone stable across appends; only fill if absent.
  if (!ptr.buyer_phone && opts.buyerPhone) ptr.buyer_phone = opts.buyerPhone;
  const bucket = opts.kind === "call" ? ptr.call_ids : ptr.outbound_sms_ids;
  if (!bucket.includes(opts.id)) bucket.push(opts.id);
  writePointer(ptr);
  return ptr;
}

// ---------------------------------------------------------------------------
// Stage status / event helpers
// ---------------------------------------------------------------------------

function setStageStatus(
  state: ChainState,
  stage: ChainStage,
  status: ChainState["stages"][ChainStage]["status"],
  patch?: Partial<ChainState["stages"][ChainStage]>,
): void {
  state.stages[stage] = {
    ...state.stages[stage],
    ...patch,
    status,
  };
}

// ---------------------------------------------------------------------------
// Stage fire — Stage 2 (call) and Stage 4 (sms_pay) hit AgentPhone and
// MUST update the pointer file. Stage 3 (email) and Stage 5 (meeting) are
// owned by other integrations and don't touch agentphone.json.
// ---------------------------------------------------------------------------

export interface FireCallInput {
  state: ChainState;
  toNumber: string; // supplier BD phone
  buyerPhone: string; // buyer's phone (for inbound SMS matching later)
  voiceAgentId: string; // AgentPhone voice agent id
  context: CallOutContext;
}

export async function fireCall(input: FireCallInput): Promise<CallOutResult> {
  const { state, toNumber, buyerPhone, voiceAgentId, context } = input;
  setStageStatus(state, "call", "in_progress", {
    started_at: new Date().toISOString(),
  });

  // Pre-call retrieval + per-call Crovi-AI operator prompt build. The new
  // 4-beat script (technical confirm → market budget window → interest +
  // capacity qualification → close) is templated against the live intake.
  // Both `systemPrompt` and `initialGreeting` are overridden per call so
  // we get a Crovi-branded opening regardless of the vendor agent's
  // default greeting. If Moss is offline or intake hasn't been written
  // yet, preparePerTurnPrompt cleanly falls back to a static rendering.
  // Dynamic import: keeps Moss native binding out of client bundles.
  const supplierName = context.supplier?.name ?? "crovi.bio";
  const {
    preparePerTurnPrompt,
    buildCroviOperatorGreeting,
    buildCroviOperatorPrompt,
    VOICE_PERSONA_SYSTEM_PROMPT,
  } = await import("@/lib/agents/voice-persona");
  const intake = readIntake(state.run_id);
  const enrichedPrompt = await preparePerTurnPrompt(
    state.run_id,
    intake,
    supplierName,
  ).catch(() =>
    intake
      ? buildCroviOperatorPrompt({ intake, supplierName })
      : context.systemPrompt ?? VOICE_PERSONA_SYSTEM_PROMPT,
  );
  const initialGreeting = buildCroviOperatorGreeting({ intake, supplierName });
  const enrichedContext: CallOutContext = {
    ...context,
    systemPrompt: enrichedPrompt,
    initialGreeting,
  };

  const result = await callOut(toNumber, voiceAgentId, enrichedContext);

  // CHAIN-OPS contract: record the call_id in agentphone.json so the
  // webhook can route call.completed back to this run.
  recordAgentPhoneId({
    runId: state.run_id,
    supplierId: state.supplier_id,
    buyerPhone,
    kind: "call",
    id: result.call_id,
  });

  // Start the poll-based completion fallback. The poller hits AgentPhone's
  // getCall(call_id) every 5s and, when the call terminates, fires the
  // cascade to email — same path the call.completed webhook would take.
  // Webhook still works if provisioned; poller just removes the ngrok
  // dependency for local testing.
  if (result.mode === "real" && result.status !== "failed") {
    try {
      const { startCallCompletionPoller } = await import(
        "@/lib/agents/runtime/build-handlers"
      );
      startCallCompletionPoller(state.run_id, result.call_id);
    } catch {
      // best-effort — webhook path still works if configured
    }
  }

  appendEvent(state, "call", {
    event_id: `call:${result.call_id}:initiated`,
    timestamp: result.started_at,
    direction: "system",
    actor: "agent",
    channel: "call",
    text: `Outbound call to ${toNumber} (status=${result.status})`,
    payload: { call_id: result.call_id, mode: result.mode, error: result.error },
  });

  // Both failure shapes — missing env AND vendor down — escalate to "failed"
  // so the transition table can route call.failed → email and the rest of
  // the chain stays alive. A visible event narrates why.
  // Why both: when AgentPhone's API is unreachable, callOut catches the
  // throw and returns { status: "failed", mode: "real", error: "..." }.
  // Previously only missing_env was marked, leaving real outages stuck
  // in_progress forever (no webhook ever fires).
  if (result.status === "failed") {
    setStageStatus(state, "call", "failed");
    appendEvent(state, "call", {
      event_id: `call:${result.call_id}:unavailable`,
      timestamp: new Date().toISOString(),
      direction: "system",
      actor: "agent",
      channel: "call",
      text:
        result.mode === "missing_env"
          ? "Phone leg unavailable — AgentPhone credentials not configured. Skipping to email."
          : `Phone leg unavailable — AgentPhone error: ${result.error ?? "unknown"}. Skipping to email.`,
    });
  }
  saveChainState(state);
  return result;
}

export interface FireSmsPayInput {
  state: ChainState;
  toNumber: string; // buyer's phone (Stage 4 SMS goes to the buyer)
  buyerPhone: string; // same as toNumber here; kept explicit for clarity
  body: string;
}

export async function fireSmsPay(
  input: FireSmsPayInput,
): Promise<SmsSendResult> {
  const { state, toNumber, buyerPhone, body } = input;
  setStageStatus(state, "sms_pay", "in_progress", {
    started_at: new Date().toISOString(),
  });

  const result = await smsSend(toNumber, body);

  // CHAIN-OPS contract: record the outbound sms_id. The webhook matches
  // INBOUND sms.received events by buyer_phone (not by sms_id), but we
  // also persist outbound ids for audit / Lineage view.
  recordAgentPhoneId({
    runId: state.run_id,
    supplierId: state.supplier_id,
    buyerPhone,
    kind: "sms",
    id: result.sms_id,
  });

  appendEvent(state, "sms_pay", {
    event_id: `sms_pay:outbound:${result.sms_id}`,
    timestamp: result.sent_at,
    direction: "outbound",
    actor: "agent",
    channel: "sms",
    text: body,
    payload: { sms_id: result.sms_id, mode: result.mode, error: result.error },
  });

  // Same shape as the call leg: any failure (missing env or vendor down)
  // marks the stage failed and narrates why, so the cockpit clearly shows
  // the SMS leg degraded instead of spinning forever.
  if (result.error || result.mode === "missing_env") {
    setStageStatus(state, "sms_pay", "failed");
    appendEvent(state, "sms_pay", {
      event_id: `sms_pay:${result.sms_id}:unavailable`,
      timestamp: new Date().toISOString(),
      direction: "system",
      actor: "agent",
      channel: "sms",
      text:
        result.mode === "missing_env"
          ? "SMS leg unavailable — AgentPhone credentials not configured."
          : `SMS leg unavailable — AgentPhone error: ${result.error}.`,
    });
  }
  saveChainState(state);
  return result;
}

// ---------------------------------------------------------------------------
// Default ChainHandlers — wires Stage 2 / Stage 4 fires through this module
// so chain-transitions.onStageComplete can drive the cascade. Stage 3 (email)
// and Stage 5 (meeting) handlers are stubs that callers override per-run.
// ---------------------------------------------------------------------------

export interface ChainHandlerContext {
  supplierPhone: string;
  buyerPhone: string;
  voiceAgentId: string;
  callContext: CallOutContext;
  smsBody: string;
}

export function defaultChainHandlers(
  ctx: ChainHandlerContext,
  overrides: Partial<ChainHandlers> = {},
): ChainHandlers {
  // Two-step bag construction so the fire-* closures can call completeStage
  // with the very same handlers object on phone-leg failure. JS closure
  // capture across the assignment makes this safe.
  const handlers: ChainHandlers = {
    fireCall: async (state) => {
      // Dynamic import: keep Moss native binding out of client bundles.
      const { VOICE_PERSONA_SYSTEM_PROMPT } = await import(
        "@/lib/agents/voice-persona"
      );
      const result = await fireCall({
        state,
        toNumber: ctx.supplierPhone,
        buyerPhone: ctx.buyerPhone,
        voiceAgentId: ctx.voiceAgentId,
        context: {
          systemPrompt: VOICE_PERSONA_SYSTEM_PROMPT,
          ...ctx.callContext,
        },
      });
      // Phone leg down? Cascade to email immediately rather than hang
      // waiting for a call.completed webhook that will never arrive.
      if (result.status === "failed") {
        await completeStage(state, { stage: "call", kind: "failed" }, handlers);
      }
    },
    fireSmsPay: async (state) => {
      const result = await fireSmsPay({
        state,
        toNumber: ctx.buyerPhone,
        buyerPhone: ctx.buyerPhone,
        body: ctx.smsBody,
      });
      // SMS leg down? Treat as "no_reply" so the chain terminates cleanly
      // instead of waiting indefinitely for an inbound CONFIRMED.
      if (result.error || result.mode === "missing_env") {
        await completeStage(
          state,
          { stage: "sms_pay", kind: "no_reply" },
          handlers,
        );
      }
    },
    // Owned by other agents — overridden by the caller wiring.
    fireEmail: overrides.fireEmail ?? (() => {}),
    fireMeeting: overrides.fireMeeting ?? (() => {}),
    onFallback: overrides.onFallback,
    ...overrides,
  };
  return handlers;
}

/**
 * Mark a stage complete with an outcome and trigger the next stage via
 * the transition table. Persists state before AND after the transition so
 * a crash mid-cascade still leaves a coherent ChainState on disk.
 */
export async function completeStage(
  state: ChainState,
  outcome: StageOutcome,
  handlers: ChainHandlers,
): Promise<void> {
  setStageStatus(state, outcome.stage, "complete", {
    completed_at: new Date().toISOString(),
  });
  saveChainState(state);
  await onStageComplete(state, outcome, handlers);
  saveChainState(state);
}

// ---------------------------------------------------------------------------
// Compatibility shims for Trunk's mock-chain.ts (immutable-style helpers).
// ---------------------------------------------------------------------------

export const initChain = (runId: string, supplierId: string): ChainState =>
  initChainState(runId, supplierId);

export function makeEventId(stage: ChainStage, n: number): string {
  return `stage-${stage}-event-${n}`;
}

export function appendEvent(
  state: ChainState,
  stage: ChainStage,
  evt: ChainStageEvent,
): ChainState {
  state.stages[stage].events.push(evt);
  return state;
}
