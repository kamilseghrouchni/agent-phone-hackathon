// Synthetic email reply — same code path as the real webhook, but the
// payload is hand-crafted in the UI's Simulate-reply panel. Lets us
// exercise the Extractor without a real inbound.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot, emitProgress } from "@/lib/ai/pipeline-utils";
import { getSupplier } from "@/lib/data/suppliers";
import { handleInbound } from "@/lib/agents/correspond";

interface Body {
  runId: string;
  supplierId: string;
  text: string;
  subject?: string;
  from?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const supplier = getSupplier(body.supplierId);
  if (!supplier) return NextResponse.json({ error: `Unknown supplier ${body.supplierId}` }, { status: 404 });

  const runDir = path.join(getRepoRoot(), "store", "runs", body.runId);
  if (!fs.existsSync(runDir)) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const result = await handleInbound({
    runId: body.runId,
    runDir,
    supplier,
    reply: {
      message_id: `sim_${Date.now()}`,
      thread_id: `sim_thread_${supplier.id}`,
      from: body.from ?? supplier.contact.email ?? "simulated@example.com",
      to: "(stub)",
      subject: body.subject ?? `Re: RFQ`,
      text: body.text,
      received_at: new Date().toISOString(),
    },
  });

  emitProgress(runDir, {
    phase: "audit",
    event: "finding",
    message: `[SIMULATED] reply from ${supplier.name}; extracted ${Object.keys(result.extracted).length} field(s).`,
  });

  return NextResponse.json({ result });
}
