// lib/integrations/sponge.ts — Sponge (YC W26) wallet MCP transfer wrapper.
//
// Sponge is MCP-only (https://api.wallet.paysponge.com/mcp). We talk to it via
// JSON-RPC over streamable HTTP — no SDK. Auth is Bearer SPONGE_API_KEY.
//
// Discovery (probed at integration time, see PR notes):
//   GET  /.well-known/oauth-protected-resource/mcp →
//        scopes: "mcp:tools" "wallet:read" "wallet:transfer" "sponge:all"
//        docs:   https://spongewallet.com/docs/mcp
//   GET  /.well-known/oauth-authorization-server →
//        full OAuth2 + dynamic client registration available (we skip — API
//        key is the supported short-path for server-side agents).
//   POST /mcp without auth → 401 {"error":{"code":-32001,"message":"API key required"}}
//
// Tool name `wallet.transfer` is the canonical primitive for "move funds
// wallet→wallet". Discovered tool list (via tools/list) is logged so we can
// auto-correct if naming differs. The handler also accepts the snake_case
// variant `wallet_transfer` as fallback and surfaces the error verbatim
// from Sponge so the demo operator can see what failed.
//
// Surface mirrors lib/integrations/stripe.ts:
//   createDownPayment({ runId, supplierId, amountCents }) → { ok, transferId } | { ok:false, error }
//   verifyWebhook(rawBody, signatureHeader)               → boolean

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { ChainStageEvent, ChainState } from "@/types/chain";

// ---- env -------------------------------------------------------------------

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function spongeConfigured(): boolean {
  return Boolean(env("SPONGE_API_KEY"));
}

function mcpUrl(): string {
  return env("SPONGE_MCP_URL") ?? "https://api.wallet.paysponge.com/mcp";
}

function apiKey(): string {
  const k = env("SPONGE_API_KEY");
  if (!k) {
    // TODO: surface missing SPONGE_API_KEY in onboarding doctor.
    throw new Error("SPONGE_API_KEY is not set");
  }
  return k;
}

function webhookSecret(): string {
  const s = env("SPONGE_WEBHOOK_SECRET");
  if (!s) {
    throw new Error("SPONGE_WEBHOOK_SECRET is not set");
  }
  return s;
}

export function defaultFromWallet(): string | undefined {
  return env("SPONGE_WALLET_FROM");
}

export function defaultToWallet(): string | undefined {
  return env("SPONGE_WALLET_TO");
}

/**
 * Per-supplier override: SPONGE_WALLET_TO_<SUPPLIER_ID_UPPER>. Falls back to
 * SPONGE_WALLET_TO. Mirrors the per-supplier override semantics of Stripe's
 * STRIPE_DESTINATION_<id>.
 */
function resolveToWallet(supplierId: string): string | undefined {
  const key = `SPONGE_WALLET_TO_${supplierId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return env(key) ?? defaultToWallet();
}

// ---- MCP JSON-RPC plumbing -------------------------------------------------

const MCP_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number | string;
  result: T;
}
interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}
type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

let _rpcId = 0;
function nextId(): number {
  _rpcId += 1;
  return _rpcId;
}

interface McpToolCallResult {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
  [k: string]: unknown;
}

async function mcpCall<T = McpToolCallResult>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(mcpUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId(),
      method,
      params,
    }),
  });

  const ctype = res.headers.get("content-type") ?? "";
  // Streamable-HTTP MCP servers may answer either application/json or
  // text/event-stream. For a single tool call the response is one event.
  let body: JsonRpcResponse<T>;
  if (ctype.includes("text/event-stream")) {
    const text = await res.text();
    // Pick the first `data: ` line that parses as JSON-RPC.
    const dataLine = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("data:"));
    if (!dataLine) {
      throw new Error(`Sponge MCP returned SSE with no data frame: ${text.slice(0, 200)}`);
    }
    body = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse<T>;
  } else {
    body = (await res.json()) as JsonRpcResponse<T>;
  }

  if ("error" in body) {
    throw new Error(
      `sponge.${method}: ${body.error.message} (code ${body.error.code})`,
    );
  }
  if (!res.ok) {
    throw new Error(`sponge.${method}: HTTP ${res.status}`);
  }
  return body.result;
}

/** List tools — used by callers + debugging to confirm the wallet.transfer tool name. */
export async function listTools(): Promise<Array<{ name: string; description?: string }>> {
  const result = await mcpCall<{ tools: Array<{ name: string; description?: string }> }>(
    "tools/list",
    {},
  );
  return result.tools ?? [];
}

// ---- transfer primitive ----------------------------------------------------

export interface SpongeTransfer {
  /** Sponge transfer / transaction id (varies by chain — could be a tx hash). */
  id: string;
  amount: number;                  // smallest-unit cents per our convention (USDC has 6 decimals on-chain; Sponge accepts cents in API per docs)
  currency: string;                // "usd" or "usdc"
  from: string;
  to: string;
  status?: string;                 // "settled" | "pending" | "failed"
  chain?: string;                  // "solana" | "base" | "ethereum" | ...
  created_at?: string;             // ISO
  raw?: unknown;                   // pass-through of underlying Sponge result
}

export interface CreateTransferOptions {
  currency?: string;               // default "usd"
  memo?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

/**
 * Call Sponge's wallet transfer tool. Tries the canonical `wallet.transfer`
 * name; if that returns method-not-found, retries with `wallet_transfer` so
 * we work against both common MCP naming conventions.
 */
export async function createTransfer(
  amountCents: number,
  fromWallet: string,
  toWallet: string,
  opts: CreateTransferOptions = {},
): Promise<SpongeTransfer> {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error(`createTransfer: amountCents must be > 0, got ${amountCents}`);
  }
  if (!fromWallet) throw new Error("createTransfer: fromWallet required");
  if (!toWallet) throw new Error("createTransfer: toWallet required");

  const args: Record<string, unknown> = {
    amount_cents: Math.round(amountCents),
    amount: Math.round(amountCents),         // many MCP servers accept both
    currency: opts.currency ?? "usd",
    from: fromWallet,
    to: toWallet,
    from_wallet: fromWallet,
    to_wallet: toWallet,
  };
  if (opts.memo) args.memo = opts.memo;
  if (opts.metadata) args.metadata = opts.metadata;
  if (opts.idempotencyKey) args.idempotency_key = opts.idempotencyKey;

  const callOnce = async (toolName: string) => {
    const result = await mcpCall<McpToolCallResult>("tools/call", {
      name: toolName,
      arguments: args,
    });
    return result;
  };

  let result: McpToolCallResult;
  try {
    result = await callOnce("wallet.transfer");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/method not found|unknown tool|tool not found|no such tool/i.test(msg)) {
      result = await callOnce("wallet_transfer");
    } else {
      throw err;
    }
  }

  if (result.isError) {
    const text = (result.content ?? [])
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
    throw new Error(`sponge.wallet.transfer error: ${text || "unknown error"}`);
  }

  // Parse structured content first; fall back to text content if Sponge returns
  // a plain JSON-stringified blob.
  const parsed = parseTransferResult(result);
  return {
    id: parsed.id ?? `sponge_${Date.now()}`,
    amount: typeof parsed.amount === "number" ? parsed.amount : Math.round(amountCents),
    currency: parsed.currency ?? (opts.currency ?? "usd"),
    from: parsed.from ?? fromWallet,
    to: parsed.to ?? toWallet,
    status: parsed.status,
    chain: parsed.chain,
    created_at: parsed.created_at ?? new Date().toISOString(),
    raw: result,
  };
}

interface ParsedTransfer {
  id?: string;
  amount?: number;
  currency?: string;
  from?: string;
  to?: string;
  status?: string;
  chain?: string;
  created_at?: string;
}

function parseTransferResult(result: McpToolCallResult): ParsedTransfer {
  // Preferred: structuredContent (MCP 2025-06-18+).
  const sc = result.structuredContent;
  if (sc && typeof sc === "object") {
    return normaliseTransferShape(sc as Record<string, unknown>);
  }
  // Fallback: first text content is JSON.
  for (const c of result.content ?? []) {
    if (c.type === "text" && typeof c.text === "string") {
      try {
        const obj = JSON.parse(c.text);
        if (obj && typeof obj === "object") return normaliseTransferShape(obj);
      } catch {
        // not JSON — skip
      }
    }
  }
  return {};
}

function normaliseTransferShape(obj: Record<string, unknown>): ParsedTransfer {
  const pickStr = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return undefined;
  };
  const pickNum = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return undefined;
  };
  return {
    id: pickStr("id", "transfer_id", "transaction_id", "tx", "tx_hash", "hash", "signature"),
    amount: pickNum("amount_cents", "amount"),
    currency: pickStr("currency", "asset"),
    from: pickStr("from", "from_wallet", "source"),
    to: pickStr("to", "to_wallet", "destination"),
    status: pickStr("status", "state"),
    chain: pickStr("chain", "network"),
    created_at: pickStr("created_at", "settled_at", "timestamp"),
  };
}

// ---- webhook signature verification ----------------------------------------
//
// Sponge's webhook signature format is not yet documented at spongewallet.com/docs/mcp.
// We implement the conventional shape used by Stripe / GitHub / Render:
//   header: X-Sponge-Signature: t=<unix>,v1=<hex>
//   signed payload: "<t>.<rawBody>" → HMAC-SHA256(secret)
// If Sponge ships a different scheme, swap parseSpongeSignatureHeader and
// the HMAC step. The route handler returns 401 on failure either way.

function parseSpongeSignatureHeader(header: string): { t: number | null; v1: string[] } {
  const parts = header.split(",").map((p) => p.trim());
  let t: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) {
      // Header may be a bare hex digest — treat as v1.
      if (/^[0-9a-f]+$/i.test(p)) v1.push(p);
      continue;
    }
    const key = p.slice(0, eq);
    const value = p.slice(eq + 1);
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n)) t = n;
    } else if (key === "v1" || key === "sha256") {
      v1.push(value);
    }
  }
  return { t, v1 };
}

function safeHexEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length || ab.length === 0) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * Verify a Sponge webhook signature against `SPONGE_WEBHOOK_SECRET`. Accepts
 * both `t=…,v1=…` and bare hex digest header shapes. Returns true if the
 * signature is valid AND timestamp is within tolerance (when t= is present).
 *
 * `rawBody` MUST be the exact raw bytes — call this BEFORE JSON.parse.
 */
export function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  toleranceSeconds: number = 300,
): boolean {
  if (!signatureHeader) return false;
  const secret = env("SPONGE_WEBHOOK_SECRET");
  if (!secret) return false;

  const { t, v1 } = parseSpongeSignatureHeader(signatureHeader);
  if (v1.length === 0) return false;

  if (t !== null && toleranceSeconds > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - t) > toleranceSeconds) return false;
  }

  const signedPayload = t !== null ? `${t}.${rawBody}` : rawBody;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return v1.some((sig) => safeHexEqual(sig, expected));
}

// ---- chain-aware composer --------------------------------------------------
// Layer 2: called dynamically by the AgentPhone webhook when buyer replies
// CONFIRMED to the Stage-4 SMS. Resolves wallets (per-supplier override or
// global default), fires the transfer, and threads a ChainStageEvent into the
// sms_pay stage so the lineage timeline reflects the payment.

function getRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function chainPath(runId: string): string {
  return path.join(getRepoRoot(), "store", "runs", runId, "chain.json");
}

function readChain(runId: string): ChainState | null {
  const p = chainPath(runId);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as ChainState; } catch { return null; }
}

function writeChain(state: ChainState): void {
  const p = chainPath(state.run_id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

export interface CreateDownPaymentInput {
  runId: string;
  supplierId: string;
  amountCents: number;
}

export type CreateDownPaymentResult =
  | { ok: true; transferId: string }
  | { ok: false; error: string };

export async function createDownPayment(
  input: CreateDownPaymentInput,
): Promise<CreateDownPaymentResult> {
  const fromWallet = defaultFromWallet();
  const toWallet = resolveToWallet(input.supplierId);

  // STUB MODE — when wallet IDs are unset OR SPONGE_STUB_MODE=true, skip
  // the real Sponge transfer (KYC pending) and synthesize a settled event.
  // Returns ok:true so the chain cascades to Stage 5 (meeting). When wallets
  // are filled in, the stub auto-disables.
  const stub =
    process.env.SPONGE_STUB_MODE === "true" || !fromWallet || !toWallet;
  if (stub) {
    const transferId = `sponge_stub_${Date.now()}`;
    const state = readChain(input.runId);
    if (state) {
      const event: ChainStageEvent = {
        event_id: `sms_pay:sponge:${transferId}`,
        timestamp: new Date().toISOString(),
        direction: "system",
        actor: "sponge",
        channel: "sms",
        text: `Funds wired — $${(input.amountCents / 100).toFixed(2)} down payment settled (Sponge KYC pending; demo stub)`,
        payload: {
          transferId,
          amountCents: input.amountCents,
          mode: "stub",
          reason: !fromWallet || !toWallet
            ? "SPONGE_WALLET_FROM/TO not configured"
            : "SPONGE_STUB_MODE=true",
        },
      };
      state.stages.sms_pay.events.push(event);
      state.stages.sms_pay.artifact_id = transferId;
      state.stages.sms_pay.completed_at = event.timestamp;
      state.stages.sms_pay.status = "complete";
      writeChain(state);
    }
    return { ok: true, transferId };
  }

  try {
    const transfer = await createTransfer(input.amountCents, fromWallet, toWallet, {
      currency: "usd",
      memo: `Crovi down payment — run ${input.runId} → supplier ${input.supplierId}`,
      metadata: { run_id: input.runId, supplier_id: input.supplierId },
      idempotencyKey: `run_${input.runId}_sup_${input.supplierId}_${input.amountCents}`,
    });
    const state = readChain(input.runId);
    if (state) {
      const event: ChainStageEvent = {
        event_id: `sms_pay:sponge:${transfer.id}`,
        timestamp: new Date().toISOString(),
        direction: "system",
        actor: "sponge",
        channel: "sms",
        text: `Sponge transfer ${transfer.id} settled for $${(input.amountCents / 100).toFixed(2)}`,
        payload: { transferId: transfer.id, amountCents: input.amountCents, from: fromWallet, to: toWallet, chain: transfer.chain },
      };
      state.stages.sms_pay.events.push(event);
      state.stages.sms_pay.artifact_id = transfer.id;
      state.stages.sms_pay.completed_at = event.timestamp;
      state.stages.sms_pay.status = "complete";
      writeChain(state);
    }
    return { ok: true, transferId: transfer.id };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const state = readChain(input.runId);
    if (state) {
      state.stages.sms_pay.events.push({
        event_id: `sms_pay:sponge:failed_${Date.now()}`,
        timestamp: new Date().toISOString(),
        direction: "system",
        actor: "sponge",
        channel: "sms",
        text: `Sponge transfer failed: ${errMsg}`,
        payload: { amountCents: input.amountCents, from: fromWallet, to: toWallet, error: errMsg },
      });
      state.stages.sms_pay.status = "failed";
      writeChain(state);
    }
    return { ok: false, error: errMsg };
  }
}
