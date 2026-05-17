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
    const req: AgentPhone.CreateOutboundCallRequest = {
      agentId: voiceAgentId,
      toNumber,
      initialGreeting: contextPayload.initialGreeting,
      systemPrompt: contextPayload.systemPrompt,
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
  const fromNumber = process.env.AGENTPHONE_PHONE_NUMBER ?? "(unset)";
  const agentId = process.env.AGENTPHONE_VOICE_AGENT_ID;

  if (!process.env.AGENTPHONE_API_KEY || !process.env.AGENTPHONE_PHONE_NUMBER) {
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
    const req: AgentPhone.SendMessageRequest = {
      agent_id: agentId,
      to_number: toNumber,
      body,
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
    return {
      sms_id: `error_${Date.now()}`,
      to: toNumber,
      from: fromNumber,
      body,
      sent_at,
      mode: "real",
      error: err instanceof Error ? err.message : String(err),
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
  if (!webhookSecret || !signatureHeader) return false;
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
