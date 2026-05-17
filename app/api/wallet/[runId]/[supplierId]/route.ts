// /api/wallet/[runId]/[supplierId] — SSE stream of payment_settled events for
// one (run, supplier). WalletTile subscribes here to animate $0 → $10.
//
// On connect: replays any historical events that already fired (so a late mount
// still sees the increment). Then streams new events as they emit.

import { NextRequest } from "next/server";
import { onAnyPaymentEvent, replayFor, type PaymentSettledEvent } from "@/lib/integrations/payment-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ runId: string; supplierId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { runId, supplierId } = await ctx.params;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (evt: PaymentSettledEvent) => {
        const data = `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      // Replay history first
      for (const evt of replayFor(runId, supplierId)) send(evt);

      // Subscribe to live events
      const unsubscribe = onAnyPaymentEvent((evt) => {
        if (evt.run_id !== runId || evt.supplier_id !== supplierId) return;
        try {
          send(evt);
        } catch {
          // controller closed — clean up
          unsubscribe();
        }
      });

      // Heartbeat every 15s to keep the connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);

      // Best-effort cleanup if the stream cancels
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      // Stash cleanup on the controller so cancel() below can reach it
      (controller as unknown as { __cleanup?: () => void }).__cleanup = cleanup;
    },
    cancel() {
      const c = this as unknown as { __cleanup?: () => void };
      c.__cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
