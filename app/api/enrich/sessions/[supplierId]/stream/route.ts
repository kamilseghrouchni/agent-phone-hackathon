// SSE: stream a supplier's local headed-Chromium session updates.
//
// The browser-use integration keeps the running session handle in an
// in-memory bus. This route subscribes to that bus per-supplier and
// pushes JSON-serialised handles ({status, action_log, extracted, ...})
// to the connected EventSource. The workspace's SessionPanel reads from
// here. Reconnects are handled by the browser EventSource API itself.

import { NextRequest } from "next/server";
import {
  subscribeToSupplier,
  subscribeToFrames,
  getSessionBySupplier,
} from "@/lib/integrations/browser-use";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ supplierId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { supplierId } = await ctx.params;
  // eslint-disable-next-line no-console
  console.log(`[sse] GET /api/enrich/sessions/${supplierId}/stream`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let frameForwardCount = 0;
      const send = (data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream may be closed; subscribe()'s cleanup will detach us.
        }
      };
      const sendNamed = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream closed.
        }
      };

      // Initial snapshot if a session already exists.
      const current = getSessionBySupplier(supplierId);
      if (current) send(current);

      // Open heartbeat so proxies don't kill the connection.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(ping);
        }
      }, 15_000);

      // Existing channel: full handle snapshot (action log + extracted fields).
      const unsubscribe = subscribeToSupplier(supplierId, (handle) => {
        send(handle);
      });

      // New channel: JPEG screenshot frames at ~4 fps. Named SSE event so the
      // client can route by `event.type === 'frame'` without re-parsing the
      // default message stream.
      const unsubscribeFrames = subscribeToFrames(supplierId, (frame) => {
        frameForwardCount += 1;
        if (frameForwardCount <= 3 || frameForwardCount % 20 === 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[sse] forward frame supplier=${supplierId} bytes=${frame.b64.length} n=${frameForwardCount}`,
          );
        }
        sendNamed("frame", { ts: frame.ts, b64: frame.b64 });
      });

      // Tear down when the consumer disconnects.
      const cleanup = () => {
        clearInterval(ping);
        unsubscribe();
        unsubscribeFrames();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // `cancel` on the stream side will trip the controller's close path,
      // but we also need to react to abort: Next 15's ReadableStream impl
      // calls `cancel` for us. Hook into req.signal as a belt-and-braces.
      const signal = _req.signal;
      if (signal) {
        if (signal.aborted) cleanup();
        else signal.addEventListener("abort", cleanup, { once: true });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
