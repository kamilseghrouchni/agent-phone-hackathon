// /api/webhooks/sponge — validates Sponge webhook signatures and emits
// payment_settled / payout_started events through the lib/integrations/
// payment-events.ts pubsub. Trunk's chain runtime and WalletTile subscribe.
//
// Sponge's webhook signature format is documented at spongewallet.com/docs/mcp
// (currently behind a marketing redirect). We implement the conventional
// `t=<unix>,v1=<hex>` HMAC-SHA256 scheme — see verifyWebhook() in
// lib/integrations/sponge.ts. If Sponge ships a different shape it'll surface
// here as a 401.
//
// Event types we route on (best-guess naming; adjust when Sponge ships docs):
//   - "transfer.settled" / "wallet.transfer.settled"  → payment_settled
//   - "transfer.created" / "wallet.transfer.pending"  → payout_started (intermediate)

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/integrations/sponge";
import { emitPaymentSettled, type PaymentSettledEvent } from "@/lib/integrations/payment-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimum shape we read off a Sponge webhook payload. Fields are best-guess —
// fall back gracefully if missing.
interface SpongeWebhookBody {
  type?: string;                                     // "transfer.settled" etc.
  event?: string;                                    // alt naming
  id?: string;
  data?: {
    object?: SpongeTransferObject;
    transfer?: SpongeTransferObject;
  } & SpongeTransferObject;
  transfer?: SpongeTransferObject;
  livemode?: boolean;
  created_at?: string;
  [k: string]: unknown;
}

interface SpongeTransferObject {
  id?: string;
  transfer_id?: string;
  amount?: number;
  amount_cents?: number;
  currency?: string;
  from?: string;
  to?: string;
  status?: string;
  chain?: string;
  metadata?: Record<string, string>;
  created_at?: string;
  settled_at?: string;
}

function extractTransfer(body: SpongeWebhookBody): SpongeTransferObject | undefined {
  return body.transfer
    ?? body.data?.transfer
    ?? body.data?.object
    ?? (body.data as SpongeTransferObject | undefined)
    ?? (body as unknown as SpongeTransferObject);
}

function extractRunIds(meta?: Record<string, string>): { run_id: string; supplier_id: string } {
  return {
    run_id: meta?.run_id ?? meta?.runId ?? "unknown",
    supplier_id: meta?.supplier_id ?? meta?.supplierId ?? "unknown",
  };
}

function eventType(body: SpongeWebhookBody): string {
  return (body.type ?? body.event ?? "").toLowerCase();
}

function isSettledType(type: string): boolean {
  return /settled|completed|paid|succeed/.test(type);
}

function isPendingType(type: string): boolean {
  return /created|pending|started|submitted/.test(type);
}

export async function POST(req: NextRequest) {
  // 1. Read raw body bytes (required for signature check).
  const rawBody = await req.text();
  // Accept either header name — exact casing TBD until Sponge publishes docs.
  const sigHeader =
    req.headers.get("x-sponge-signature") ??
    req.headers.get("sponge-signature") ??
    req.headers.get("x-signature");

  if (!verifyWebhook(rawBody, sigHeader)) {
    return NextResponse.json(
      { ok: false, error: "Invalid Sponge webhook signature" },
      { status: 401 },
    );
  }

  let body: SpongeWebhookBody;
  try {
    body = JSON.parse(rawBody) as SpongeWebhookBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const type = eventType(body);
  const transfer = extractTransfer(body);

  // Unknown event types are acknowledged with 200 so Sponge doesn't retry.
  if (!transfer || (!isSettledType(type) && !isPendingType(type))) {
    return NextResponse.json({ ok: true, type, ignored: true });
  }

  const { run_id, supplier_id } = extractRunIds(transfer.metadata);
  const amount_cents = transfer.amount_cents ?? transfer.amount ?? 0;
  const at = transfer.settled_at ?? transfer.created_at ?? body.created_at ?? new Date().toISOString();

  const payload: PaymentSettledEvent = {
    type: isSettledType(type) ? "payment_settled" : "payout_started",
    run_id,
    supplier_id,
    amount_cents,
    currency: transfer.currency ?? "usd",
    transfer_id: transfer.id ?? transfer.transfer_id ?? body.id ?? `sponge_${Date.now()}`,
    destination: transfer.to,
    livemode: Boolean(body.livemode ?? false),
    at,
    source: "sponge_webhook",
  };
  emitPaymentSettled(payload);

  return NextResponse.json({ ok: true, type, id: payload.transfer_id });
}

// Sponge dashboard test pings GET sometimes — respond 200 with hint.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "sponge webhook",
    accepts: "POST with X-Sponge-Signature",
  });
}
