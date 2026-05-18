// AgentPhone integration — outbound voice (Stage 2) + outbound SMS (Stage 4)
// + inbound webhook signature verification.
//
// Powered by the official `agentphone` SDK (AgentPhoneClient). The voice agent
// id, phone number, and webhook secret are all provisioned once by
// `scripts/setup-agentphone.ts` and pasted into .env.local. At runtime we only
// touch the SDK — no raw fetch — so request/response shapes stay in lockstep
// with the vendor.
//
// External function names (callOut, smsSend, isAuthorizationSms,
// verifyWebhookSignature, parseInboundEvent) are STABLE — they are the
// contract with lib/agents/runtime/chain-runtime.ts and
// app/api/webhooks/agentphone/route.ts. Do not rename.

import crypto from "crypto";
import { AgentPhoneClient, AgentPhone } from "agentphone";

// ---------------------------------------------------------------------------
// Lazy client singleton. Throws if AGENTPHONE_API_KEY is missing so callers
// that legitimately want a "missing_env" mode can catch and degrade.
// ---------------------------------------------------------------------------

let _client: AgentPhoneClient | null = null;

export function getClient(): AgentPhoneClient {
  if (_client) return _client;
  const token = process.env.AGENTPHONE_API_KEY;
  if (!token) {
    throw new Error(
      "AGENTPHONE_API_KEY missing. Set it in .env.local (run `npm run setup:agentphone` to provision).",
    );
  }
  _client = new AgentPhoneClient({
    token,
    baseUrl: process.env.AGENTPHONE_BASE_URL || undefined,
  });
  return _client;
}

// ---------------------------------------------------------------------------
// Phone-number resolver
//
// Background: AgentPhone exposes lines by an internal `number_id` (opaque
// string) but humans read .env.local in E.164. The PLATFORM SOURCE OF TRUTH
// is the two E.164 env vars:
//
//   AGENTPHONE_PHONE_NUMBER  → the line CALLS go out on (must be voice-capable —
//                              iMessage-type lines silently fail outbound voice)
//   AGENTPHONE_SMS_NUMBER    → the line SMS and iMessage go out on
//                              (set this to the iMessage line for blue bubbles,
//                               or to the 10DLC line for green SMS)
//
// Legacy `_NUMBER_ID` env vars are kept as explicit overrides for callers that
// have already pinned an id, but the E.164 vars are the primary knob. This
// avoids the foot-gun where someone updates AGENTPHONE_PHONE_NUMBER to a new
// line and forgets to also update AGENTPHONE_*_NUMBER_ID, leading to the
// "can't make calls with iMessage numbers" class of bug.
// ---------------------------------------------------------------------------

interface NumberIndexEntry {
  id: string;
  phoneNumber: string;
  type: string;
  status: string;
}

let _numberIndex: Map<string, NumberIndexEntry> | null = null;
let _numberIndexPromise: Promise<Map<string, NumberIndexEntry>> | null = null;

async function loadNumberIndex(
  client: AgentPhoneClient,
): Promise<Map<string, NumberIndexEntry>> {
  if (_numberIndex) return _numberIndex;
  if (_numberIndexPromise) return _numberIndexPromise;
  _numberIndexPromise = (async () => {
    const resp = (await client.numbers.listNumbers()) as unknown as {
      data?: Array<{
        id?: string;
        phoneNumber?: string;
        type?: string;
        status?: string;
      }>;
    };
    const map = new Map<string, NumberIndexEntry>();
    for (const n of resp.data ?? []) {
      if (!n.id || !n.phoneNumber) continue;
      map.set(n.phoneNumber, {
        id: n.id,
        phoneNumber: n.phoneNumber,
        type: n.type ?? "unknown",
        status: n.status ?? "unknown",
      });
    }
    _numberIndex = map;
    return map;
  })();
  return _numberIndexPromise;
}

/**
 * Resolve an E.164 number string to its AgentPhone number_id by looking it up
 * in the account's line list. Returns null when the number isn't on the
 * account. Cached after first call — bounce the process to refresh.
 */
export async function resolveNumberIdFromE164(
  phoneE164: string | undefined | null,
): Promise<NumberIndexEntry | null> {
  if (!phoneE164) return null;
  const client = getClient();
  const idx = await loadNumberIndex(client);
  return idx.get(phoneE164) ?? null;
}

/**
 * Resolve the outbound CALL line. Priority:
 *   1. AGENTPHONE_CALL_FROM_NUMBER_ID (explicit override — power-user / scripts)
 *   2. AGENTPHONE_PHONE_NUMBER (E.164, resolved via loadNumberIndex)
 * Returns null if neither yields a valid id.
 */
async function resolveCallFromNumberId(): Promise<string | null> {
  const explicit = process.env.AGENTPHONE_CALL_FROM_NUMBER_ID;
  if (explicit) return explicit;
  const e164 = process.env.AGENTPHONE_PHONE_NUMBER;
  const hit = await resolveNumberIdFromE164(e164);
  return hit?.id ?? null;
}

/**
 * Resolve the outbound SMS / iMessage line. Priority:
 *   1. AGENTPHONE_SMS_NUMBER (E.164 — the new primary knob)
 *   2. Legacy _NUMBER_ID vars (back-compat): AGENTPHONE_PREFER_IMESSAGE picks
 *      between AGENTPHONE_IMESSAGE_NUMBER_ID and AGENTPHONE_SMS_NUMBER_ID.
 * Returns null if nothing resolves.
 */
async function resolveSmsFromNumberId(): Promise<string | null> {
  const e164 = process.env.AGENTPHONE_SMS_NUMBER;
  if (e164) {
    const hit = await resolveNumberIdFromE164(e164);
    if (hit) return hit.id;
  }
  // Legacy override path — kept so existing demos and CI keep working.
  if (process.env.AGENTPHONE_PREFER_IMESSAGE === "true") {
    return (
      process.env.AGENTPHONE_IMESSAGE_NUMBER_ID ??
      process.env.AGENTPHONE_SMS_NUMBER_ID ??
      null
    );
  }
  return (
    process.env.AGENTPHONE_SMS_NUMBER_ID ??
    process.env.AGENTPHONE_IMESSAGE_NUMBER_ID ??
    null
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — outbound voice call
// ---------------------------------------------------------------------------

export interface CallOutContext {
  // Arbitrary JSON the voice agent will receive as initial context.
  // The voice agent's system prompt (lib/agents/voice-persona.ts) reads
  // buyer + supplier specifics from here to drive the 3 substantive questions.
  buyer?: { company: string; contact: string; study: string };
  supplier?: { id: string; name: string };
  intake?: Record<string, unknown>;
  evidence_targets?: string[]; // field_ids the call should aim to fill
  // Optional override for the per-call system prompt. chain-runtime injects
  // VOICE_PERSONA_SYSTEM_PROMPT here on Stage 2 fires.
  systemPrompt?: string;
  // Optional initial greeting override.
  initialGreeting?: string;
  [key: string]: unknown;
}

export interface CallOutResult {
  call_id: string;
  status: "queued" | "ringing" | "in_progress" | "completed" | "failed";
  to: string;
  from: string;
  started_at: string;
  mode: "real" | "missing_env";
  error?: string;
}

interface SdkCreateCallResponseShape {
  id?: string;
  call_id?: string;
  callId?: string;
  status?: CallOutResult["status"];
  from_number?: string;
  fromNumber?: string;
}

/**
 * Place an outbound voice call via AgentPhone. Returns the AgentPhone call id
 * which is used to correlate the inbound `call.completed` webhook back to the
 * run (see chain-runtime.recordAgentPhoneId).
 */
export async function callOut(
  toNumber: string,
  voiceAgentId: string,
  contextPayload: CallOutContext,
): Promise<CallOutResult> {
  const started_at = new Date().toISOString();
  const fromNumber = process.env.AGENTPHONE_PHONE_NUMBER ?? "(unset)";

  if (!process.env.AGENTPHONE_API_KEY || !process.env.AGENTPHONE_PHONE_NUMBER) {
    return {
      call_id: `missing_env_${Date.now()}`,
      status: "failed",
      to: toNumber,
      from: fromNumber,
      started_at,
      mode: "missing_env",
      error:
        "AGENTPHONE_API_KEY or AGENTPHONE_PHONE_NUMBER missing. Set both in .env.local (run `npm run setup:agentphone`).",
    };
  }

  try {
    const client = getClient();

    // CRITICAL: passing `systemPrompt` / `initialGreeting` directly on
    // createOutboundCall causes AgentPhone to silently fail (call connects
    // but audio is dead — see "(inaudible speech)" pattern in call logs).
    // The fix: update the AGENT's stored prompt via PATCH, then call without
    // overrides. The agent uses its stored config and voice works.
    if (contextPayload.systemPrompt || contextPayload.initialGreeting) {
      try {
        const updatePayload: Record<string, unknown> = { agent_id: voiceAgentId };
        if (contextPayload.systemPrompt) {
          updatePayload.systemPrompt = contextPayload.systemPrompt;
        }
        if (contextPayload.initialGreeting) {
          updatePayload.beginMessage = contextPayload.initialGreeting;
        }
        await (client.agents as unknown as {
          updateAgent: (r: Record<string, unknown>) => Promise<unknown>;
        }).updateAgent(updatePayload);
      } catch (updateErr) {
        // Non-fatal — if update fails, fall through to call with stored prompt.
        // eslint-disable-next-line no-console
        console.warn(
          "[agentphone] agent update failed, calling with stored prompt:",
          updateErr instanceof Error ? updateErr.message.slice(0, 120) : String(updateErr).slice(0, 120),
        );
      }
    }

    // Pin the caller-ID. Source of truth is AGENTPHONE_PHONE_NUMBER (E.164),
    // resolved to a number_id via the account's line list — with the legacy
    // AGENTPHONE_CALL_FROM_NUMBER_ID env var honored first for explicit
    // overrides. We hard-fail if neither yields an id, because if we let the
    // SDK fall back to "the agent's first attached number" we could end up
    // dialing out from the iMessage-type line, which silently rejects voice
    // (the exact bug class we're guarding against — "can't make calls with
    // iMessage numbers").
    const fromNumberId = await resolveCallFromNumberId();
    if (!fromNumberId) {
      return {
        call_id: `missing_env_${Date.now()}`,
        status: "failed",
        to: toNumber,
        from: fromNumber,
        started_at,
        mode: "missing_env",
        error:
          "Outbound voice line unresolved. Set AGENTPHONE_PHONE_NUMBER in .env.local to the E.164 number of a VOICE-CAPABLE line attached to the agent (iMessage-type lines do not support outbound voice).",
      };
    }
    const req: AgentPhone.CreateOutboundCallRequest = {
      agentId: voiceAgentId,
      toNumber,
      fromNumberId,
      // DO NOT set systemPrompt / initialGreeting here — agent uses its
      // stored prompt (updated above per-run when needed).
    };
    const raw = (await client.calls.createOutboundCall(
      req,
    )) as SdkCreateCallResponseShape;
    return {
      call_id: raw.call_id ?? raw.callId ?? raw.id ?? `unknown_${Date.now()}`,
      status: raw.status ?? "queued",
      to: toNumber,
      from: raw.from_number ?? raw.fromNumber ?? fromNumber,
      started_at,
      mode: "real",
    };
  } catch (err) {
    return {
      call_id: `error_${Date.now()}`,
      status: "failed",
      to: toNumber,
      from: fromNumber,
      started_at,
      mode: "real",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Stage 4 — outbound SMS
// ---------------------------------------------------------------------------

export interface SmsSendResult {
  sms_id: string;
  to: string;
  from: string;
  body: string;
  sent_at: string;
  mode: "real" | "missing_env";
  error?: string;
}

/**
 * Send an SMS via AgentPhone. Stage 4 uses this to fire the authorization
 * prompt: "Reply CONFIRMED to authorize $10 down payment ...". Inbound replies
 * are matched by `isAuthorizationSms` in the webhook handler.
 *
 * Requires AGENTPHONE_VOICE_AGENT_ID — the SDK's `messages.sendMessage`
 * routes the SMS through the agent's attached phone number.
 */
export async function smsSend(
  toNumber: string,
  body: string,
): Promise<SmsSendResult> {
  const sent_at = new Date().toISOString();
  // Display string priority: AGENTPHONE_SMS_NUMBER (the SMS-channel knob)
  // falling back to AGENTPHONE_PHONE_NUMBER (legacy single-line config).
  const fromNumber =
    process.env.AGENTPHONE_SMS_NUMBER ??
    process.env.AGENTPHONE_PHONE_NUMBER ??
    "(unset)";
  const agentId = process.env.AGENTPHONE_VOICE_AGENT_ID;

  // STUB MODE — US 10DLC registration is required for outbound SMS via
  // AgentPhone (same KYC class as Sponge wallet setup). Until that's
  // complete, SMS_STUB_MODE=true (or auto-detect on 403) synthesizes a
  // successful send so the chain cascades. The Stage-4 UI button still
  // accepts a manual "simulate CONFIRMED" to advance to Sponge stub.
  if (process.env.SMS_STUB_MODE === "true") {
    return {
      sms_id: `sms_stub_${Date.now()}`,
      to: toNumber,
      from: fromNumber,
      body,
      sent_at,
      mode: "real",
    };
  }

  // Guard on either AGENTPHONE_SMS_NUMBER (new primary) or the legacy
  // AGENTPHONE_PHONE_NUMBER. We do NOT require both — a project that's only
  // wired the new var should still be able to send.
  const hasSmsLine =
    process.env.AGENTPHONE_SMS_NUMBER ||
    process.env.AGENTPHONE_PHONE_NUMBER ||
    process.env.AGENTPHONE_SMS_NUMBER_ID ||
    process.env.AGENTPHONE_IMESSAGE_NUMBER_ID;
  if (!process.env.AGENTPHONE_API_KEY || !hasSmsLine) {
    return {
      sms_id: `missing_env_${Date.now()}`,
      to: toNumber,
      from: fromNumber,
      body,
      sent_at,
      mode: "missing_env",
      error:
        "AGENTPHONE_API_KEY or AGENTPHONE_PHONE_NUMBER missing. Set both in .env.local (run `npm run setup:agentphone`).",
    };
  }
  if (!agentId) {
    return {
      sms_id: `missing_env_${Date.now()}`,
      to: toNumber,
      from: fromNumber,
      body,
      sent_at,
      mode: "missing_env",
      error:
        "AGENTPHONE_VOICE_AGENT_ID missing. Run `npm run setup:agentphone` and paste the captured agent id into .env.local.",
    };
  }

  try {
    const client = getClient();
    // Source of truth: AGENTPHONE_SMS_NUMBER (E.164). When that line is an
    // iMessage shared line the message renders as iMessage; when it's a
    // 10DLC SMS line it renders as plain SMS. AgentPhone's shared-imessage
    // lines enforce a per-line allowlist ("registered contacts on this
    // shared line") that the project-level contacts API doesn't manage —
    // sends to non-allowlisted destinations 403.
    //
    // Legacy AGENTPHONE_*_NUMBER_ID env vars (+ AGENTPHONE_PREFER_IMESSAGE)
    // are kept as a fallback for back-compat with older demos and CI.
    const numberId = await resolveSmsFromNumberId();
    const req: AgentPhone.SendMessageRequest = {
      agent_id: agentId,
      to_number: toNumber,
      body,
      ...(numberId ? { number_id: numberId } : {}),
    };
    const res = (await client.messages.sendMessage(
      req,
    )) as AgentPhone.SendMessageResponse;
    return {
      sms_id: res.id ?? `unknown_${Date.now()}`,
      to: res.to_number ?? toNumber,
      from: res.from_number ?? fromNumber,
      body,
      sent_at,
      mode: "real",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Auto-stub on 10DLC block — same effect as SMS_STUB_MODE=true. Keeps
    // the chain flowing when the AgentPhone account isn't 10DLC-registered.
    if (/10DLC|Outbound SMS is not enabled/i.test(msg)) {
      console.warn(`[agentphone] auto-stubbing SMS (10DLC not registered): ${msg.slice(0, 120)}`);
      return {
        sms_id: `sms_stub_${Date.now()}`,
        to: toNumber,
        from: fromNumber,
        body,
        sent_at,
        mode: "real",
      };
    }
    return {
      sms_id: `error_${Date.now()}`,
      to: toNumber,
      from: fromNumber,
      body,
      sent_at,
      mode: "real",
      error: msg,
    };
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify an AgentPhone inbound webhook signature.
 * Expected header: `X-AgentPhone-Signature: sha256=<hex>` (or bare hex).
 * Uses HMAC-SHA256(webhookSecret, rawBody) with a timing-safe equal compare.
 * The webhook secret is captured by `scripts/setup-agentphone.ts` from
 * `client.webhooks.createOrUpdateWebhook(...)` and lives in
 * AGENTPHONE_WEBHOOK_SECRET.
 *
 * Returns false if the secret or signature header is missing — webhook routes
 * MUST 401 in that case rather than skipping verification.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const webhookSecret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  // DEV-MODE BYPASS: when the secret hasn't been provisioned yet (e.g. user
  // is testing locally without ngrok), DEMO_MODE=true lets simulated/local
  // webhook POSTs through. Never enable this in production.
  if (!webhookSecret) {
    if (process.env.DEMO_MODE === "true") {
      console.warn(
        "[agentphone] DEMO_MODE bypass — AGENTPHONE_WEBHOOK_SECRET unset, skipping signature check",
      );
      return true;
    }
    return false;
  }
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(provided, "hex"),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Inbound webhook payload shapes (subset we care about for Stage 2 + Stage 4)
// ---------------------------------------------------------------------------

export interface InboundSmsEvent {
  type: "sms.received";
  sms_id: string;
  from: string; // buyer's phone
  to: string; // AGENTPHONE_PHONE_NUMBER
  body: string;
  received_at: string;
}

export interface CallCompletedEvent {
  type: "call.completed" | "call.failed";
  call_id: string;
  status: "completed" | "failed" | "no_answer";
  duration_sec?: number;
  transcript?: Array<{
    turn: "agent" | "supplier";
    text: string;
    timestamp: string;
  }>;
  completed_at: string;
}

export type AgentPhoneInboundEvent = InboundSmsEvent | CallCompletedEvent;

export function parseInboundEvent(
  raw: unknown,
): AgentPhoneInboundEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = String(r.type ?? r.event ?? "");
  if (type === "sms.received" || type === "message.received") {
    return {
      type: "sms.received",
      sms_id: String(r.sms_id ?? r.message_id ?? r.id ?? ""),
      from: String(r.from ?? r.from_number ?? ""),
      to: String(r.to ?? r.to_number ?? ""),
      body: String(r.body ?? r.text ?? ""),
      received_at: String(r.received_at ?? r.created_at ?? new Date().toISOString()),
    };
  }
  if (type === "call.completed" || type === "call.failed") {
    return {
      type: type as "call.completed" | "call.failed",
      call_id: String(r.call_id ?? r.id ?? ""),
      status: (r.status as CallCompletedEvent["status"]) ?? "completed",
      duration_sec:
        typeof r.duration_sec === "number"
          ? r.duration_sec
          : typeof r.durationSec === "number"
            ? (r.durationSec as number)
            : undefined,
      transcript: Array.isArray(r.transcript)
        ? (r.transcript as CallCompletedEvent["transcript"])
        : undefined,
      completed_at: String(r.completed_at ?? r.completedAt ?? new Date().toISOString()),
    };
  }
  return null;
}

/**
 * "CONFIRMED" authorization pattern — matched against the buyer's inbound SMS.
 * Permissive: matches "CONFIRMED" anywhere in the body (case-insensitive),
 * optionally followed by qualifying text like "legally binding".
 */
export function isAuthorizationSms(body: string): boolean {
  return /\bCONFIRMED\b/i.test(body);
}

// ---------------------------------------------------------------------------
// Call status retrieval — for the no-webhook poll path. The chain's call
// stage uses `startCallCompletionPoller` (in build-handlers.ts) to call
// `getCall` every ~5s while a call is in-flight, then `getCallTranscript`
// once the SDK reports status=completed. This is the localhost-friendly
// alternative to inbound webhooks (which need ngrok + AGENTPHONE_WEBHOOK_SECRET).
// ---------------------------------------------------------------------------

export interface CallStatusSnapshot {
  call_id: string;
  status: "queued" | "ringing" | "in_progress" | "completed" | "failed" | "no_answer" | "unknown";
  duration_sec?: number;
  ended_at?: string;
  mode: "real" | "missing_env";
  error?: string;
}

export async function getCall(callId: string): Promise<CallStatusSnapshot> {
  if (!process.env.AGENTPHONE_API_KEY) {
    return {
      call_id: callId,
      status: "unknown",
      mode: "missing_env",
      error: "AGENTPHONE_API_KEY missing",
    };
  }
  try {
    const client = getClient();
    const raw = (await (client.calls as unknown as {
      getCall: (id: string) => Promise<Record<string, unknown>>;
    }).getCall(callId)) as Record<string, unknown>;
    const status = String(raw.status ?? raw.call_status ?? "unknown") as CallStatusSnapshot["status"];
    const duration =
      typeof raw.duration_sec === "number"
        ? (raw.duration_sec as number)
        : typeof raw.durationSec === "number"
          ? (raw.durationSec as number)
          : undefined;
    return {
      call_id: callId,
      status,
      duration_sec: duration,
      ended_at:
        typeof raw.ended_at === "string"
          ? (raw.ended_at as string)
          : typeof raw.endedAt === "string"
            ? (raw.endedAt as string)
            : undefined,
      mode: "real",
    };
  } catch (err) {
    return {
      call_id: callId,
      status: "unknown",
      mode: "real",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface CallTranscriptResult {
  call_id: string;
  transcript: CallCompletedEvent["transcript"];
  raw_status?: string;
  mode: "real" | "missing_env";
  error?: string;
}

export async function getCallTranscript(
  callId: string,
): Promise<CallTranscriptResult> {
  if (!process.env.AGENTPHONE_API_KEY) {
    return {
      call_id: callId,
      transcript: [],
      mode: "missing_env",
      error: "AGENTPHONE_API_KEY missing",
    };
  }
  try {
    const client = getClient();
    const raw = (await (client.calls as unknown as {
      getCallTranscript: (id: string) => Promise<Record<string, unknown>>;
    }).getCallTranscript(callId)) as Record<string, unknown>;
    // SDK may return either an array directly or { transcript: [...] }.
    const rawTurns: unknown[] = Array.isArray(raw)
      ? (raw as unknown[])
      : Array.isArray(raw.transcript)
        ? (raw.transcript as unknown[])
        : Array.isArray(raw.turns)
          ? (raw.turns as unknown[])
          : [];
    const transcript: NonNullable<CallCompletedEvent["transcript"]> = rawTurns.map((t) => {
      const o = t as Record<string, unknown>;
      const role = String(o.role ?? o.turn ?? o.speaker ?? "supplier").toLowerCase();
      const turn: "agent" | "supplier" =
        role === "agent" || role === "ai" || role === "assistant" ? "agent" : "supplier";
      return {
        turn,
        text: String(o.text ?? o.content ?? o.transcript ?? ""),
        timestamp: String(o.timestamp ?? o.ts ?? new Date().toISOString()),
      };
    });
    return {
      call_id: callId,
      transcript,
      raw_status: typeof raw.status === "string" ? (raw.status as string) : undefined,
      mode: "real",
    };
  } catch (err) {
    return {
      call_id: callId,
      transcript: [],
      mode: "real",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
