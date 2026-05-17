// app/api/chain/[runId]/stream/route.ts
//
// SSE endpoint streaming ChainState updates. Watches the chain.json file
// for the run and pushes a full snapshot on every change (mtime poll).
// Cheap, decoupled, and crash-safe — the workspace UI reads from here to
// drive the Timeline + SequenceTemplate in live mode.
//
// Also forwards `event: stage_frame` JPEG frames from headless Chromium
// sessions (Stage 1 form-fill, Stage 5 meeting booking) into the timeline
// stage cards. See lib/integrations/chain-frames.ts for the bus.

import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { subscribeToChainFrames } from "@/lib/integrations/chain-frames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ runId: string }>;
}

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

const POLL_INTERVAL_MS = 700;

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { runId } = await ctx.params;
  const filePath = chainPath(runId);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let lastMtime = 0;
      let lastPayload = "";
      let closed = false;

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const sendNamed = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const pushSnapshot = () => {
        if (!fs.existsSync(filePath)) {
          return;
        }
        try {
          const stat = fs.statSync(filePath);
          const mt = stat.mtimeMs;
          if (mt === lastMtime) return;
          const raw = fs.readFileSync(filePath, "utf-8");
          if (raw === lastPayload) return;
          lastMtime = mt;
          lastPayload = raw;
          try {
            const parsed = JSON.parse(raw);
            send({ chain: parsed });
          } catch {
            // skip malformed
          }
        } catch {
          // skip transient fs errors
        }
      };

      // Initial snapshot if available.
      pushSnapshot();

      const poll = setInterval(pushSnapshot, POLL_INTERVAL_MS);
      // Heartbeat so proxies / browsers don't drop the connection.
      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      // Forward JPEG frames from headless Chromium sessions (Stage 1 + 5).
      // Named SSE event so the Timeline component can route without parsing
      // the default chain-snapshot stream.
      const unsubscribeFrames = subscribeToChainFrames(runId, (frame) => {
        sendNamed("stage_frame", {
          stage: frame.stage,
          ts: frame.ts,
          b64: frame.b64,
        });
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(ping);
        unsubscribeFrames();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const signal = req.signal;
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
