// lib/integrations/payment-events.ts — in-memory pubsub for payment events.
//
// The Sponge webhook route emits "payment_settled" here; Trunk's chain runtime
// subscribes and advances stages 4 → 5. Wallet tiles also subscribe directly
// via the /api/wallet SSE stream (see app/api/wallet/[runId]/[supplierId]/route.ts).
//
// Process-local only. Sufficient for a single-Next-process demo. If the demo
// ever sharded across processes, swap this for a store write + file watcher.

import { EventEmitter } from "events";

export type PaymentEventType = "payment_settled" | "payout_started";

export interface PaymentSettledEvent {
  type: PaymentEventType;
  run_id: string;
  supplier_id: string;
  amount_cents: number;
  currency: string;
  transfer_id: string;
  destination?: string;
  livemode: boolean;
  at: string;                    // ISO timestamp
  source: "sponge_webhook" | "manual_fallback";
}

// Singleton across hot reloads in dev: stash on globalThis.
const GLOBAL_KEY = "__crovi_payment_bus__";
type Bus = EventEmitter & { history: PaymentSettledEvent[] };

function makeBus(): Bus {
  const bus = new EventEmitter() as Bus;
  bus.setMaxListeners(64);
  bus.history = [];
  return bus;
}

function getBus(): Bus {
  const g = globalThis as unknown as Record<string, Bus | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = makeBus();
  return g[GLOBAL_KEY] as Bus;
}

export function emitPaymentSettled(evt: PaymentSettledEvent): void {
  const bus = getBus();
  bus.history.push(evt);
  // keep history bounded — last 200 events is plenty for a single demo run
  if (bus.history.length > 200) bus.history.splice(0, bus.history.length - 200);
  bus.emit(evt.type, evt);
  bus.emit("*", evt);
}

export function onPaymentSettled(
  cb: (evt: PaymentSettledEvent) => void,
): () => void {
  const bus = getBus();
  bus.on("payment_settled", cb);
  return () => bus.off("payment_settled", cb);
}

export function onAnyPaymentEvent(
  cb: (evt: PaymentSettledEvent) => void,
): () => void {
  const bus = getBus();
  bus.on("*", cb);
  return () => bus.off("*", cb);
}

/** Replay history for a (runId, supplierId). Used by SSE consumers that connect
 * after the webhook already fired (e.g. WalletTile mounts late). */
export function replayFor(runId: string, supplierId: string): PaymentSettledEvent[] {
  return getBus().history.filter((e) => e.run_id === runId && e.supplier_id === supplierId);
}
