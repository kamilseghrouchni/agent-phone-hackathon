// Synthetic follow-up after a form submission. Browser Use's real
// session-update webhook is wired separately; this is the dev tool that
// the UI's Simulate-reply panel posts to for the form lane.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot, emitProgress } from "@/lib/ai/pipeline-utils";
import { getSupplier } from "@/lib/data/suppliers";
import { handleInbound } from "@/lib/agents/fill";

interface Body {
  runId: string;
  supplierId: string;
  text: string;
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
    reply_text: body.text,
    reply_id: `sim_${Date.now()}`,
  });
  emitProgress(runDir, {
    phase: "audit",
    event: "finding",
    message: `[SIMULATED] form follow-up from ${supplier.name}; extracted ${Object.keys(result.extracted).length} field(s).`,
  });
  return NextResponse.json({ result });
}
