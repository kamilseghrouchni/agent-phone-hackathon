// lib/agents/pay-fallback.ts — manual wallet-increment trigger (spec §6 V7.3).
//
// Demo safety net: if the Sponge webhook hangs (rate limit, ngrok dropped,
// settlement delayed by chain congestion), the operator can fire this from a
// debug button to emit the same `payment_settled` event the webhook would
// have. WalletTile animates as if the real transfer settled.
//
// This is NOT a Sponge call — it just publishes the in-memory event. The
// real Sponge transfer either already landed wallet→wallet (audience sees
// it on the Sponge dashboard) or didn't (operator is intentionally simulating).

import {
  emitPaymentSettled,
  type PaymentSettledEvent,
} from "@/lib/integrations/payment-events";

export interface ManualSettleOptions {
  runId: string;
  supplierId: string;
  amountCents?: number;             // default 1000 ($10)
  currency?: string;                // default "usd"
  transferId?: string;              // default tr_manual_<timestamp>
  destination?: string;
}

export function manualSettleWallet(opts: ManualSettleOptions): PaymentSettledEvent {
  const payload: PaymentSettledEvent = {
    type: "payment_settled",
    run_id: opts.runId,
    supplier_id: opts.supplierId,
    amount_cents: opts.amountCents ?? 1000,
    currency: opts.currency ?? "usd",
    transfer_id: opts.transferId ?? `sponge_manual_${Date.now()}`,
    destination: opts.destination,
    livemode: false,
    at: new Date().toISOString(),
    source: "manual_fallback",
  };
  emitPaymentSettled(payload);
  return payload;
}

/**
 * The chain runtime can call this when it detects the Sponge webhook hasn't
 * fired within a deadline (e.g. 15s after the wallet.transfer call returns).
 * Keeps the demo flowing without the operator pressing a button.
 */
export async function settleAfterDeadline(opts: ManualSettleOptions & { deadlineMs?: number; alreadySettled: () => boolean }): Promise<PaymentSettledEvent | null> {
  await new Promise((r) => setTimeout(r, opts.deadlineMs ?? 15_000));
  if (opts.alreadySettled()) return null;
  return manualSettleWallet(opts);
}
