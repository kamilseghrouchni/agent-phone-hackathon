// /api/webhooks/agentmail — real inbound webhook from AgentMail.
// Looks up which run owns the thread by scanning store/runs/* outbox/email.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot, emitProgress } from "@/lib/ai/pipeline-utils";
import { parseInboundWebhook } from "@/lib/integrations/agentmail";
import { getSupplier } from "@/lib/data/suppliers";
import { handleInbound } from "@/lib/agents/correspond";

function findRunBySupplierThread(threadId: string): { runId: string; supplierId: string } | null {
  const runsDir = path.join(getRepoRoot(), "store", "runs");
  if (!fs.existsSync(runsDir)) return null;
  for (const runId of fs.readdirSync(runsDir)) {
    const outbox = path.join(runsDir, runId, "outbox", "email");
    if (!fs.existsSync(outbox)) continue;
    for (const f of fs.readdirSync(outbox)) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(outbox, f), "utf-8"));
        if (r.thread_id === threadId) {
          // filename pattern "<ts>_<supplierId>.json"
          const match = f.match(/_([a-z0-9_]+)\.json$/);
          return { runId, supplierId: match?.[1] ?? "" };
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const raw = await req.json();
  const reply = parseInboundWebhook(raw);
  if (!reply) return NextResponse.json({ error: "Invalid AgentMail payload" }, { status: 400 });

  const found = findRunBySupplierThread(reply.thread_id);
  if (!found) return NextResponse.json({ error: `No run owns thread ${reply.thread_id}` }, { status: 404 });

  const supplier = getSupplier(found.supplierId);
  if (!supplier) return NextResponse.json({ error: `Unknown supplier ${found.supplierId}` }, { status: 404 });

  const runDir = path.join(getRepoRoot(), "store", "runs", found.runId);
  const result = await handleInbound({ runId: found.runId, runDir, supplier, reply });

  emitProgress(runDir, {
    phase: "audit",
    event: "finding",
    message: `Reply from ${supplier.name} parsed; ${Object.keys(result.extracted).length} field(s) extracted.`,
  });

  return NextResponse.json({ runId: found.runId, supplierId: supplier.id, result });
}
