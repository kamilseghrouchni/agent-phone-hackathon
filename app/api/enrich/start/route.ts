// app/api/enrich/start/route.ts
//
// POST { runId, intake } — fires the V1 enrichment orchestrator server-side.
// Returns the EnrichResult immediately (sessions continue running async in
// the background). Real-time updates per supplier flow through SSE at
// /api/enrich/sessions/[supplierId]/stream.
//
// The client (workspace) calls this once when it enters the Enrich phase.

import { NextRequest, NextResponse } from "next/server";
import { enrich } from "@/lib/agents/enrich";
import type { IntakeForm } from "@/types/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { runId?: string; intake?: IntakeForm } = {};
  try {
    body = (await req.json()) as { runId?: string; intake?: IntakeForm };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.runId) {
    return NextResponse.json({ error: "missing runId" }, { status: 400 });
  }

  // Pull buyer's claimed conditions from intake for conviction scoring.
  const buyerConditions: string[] = (() => {
    const f = body.intake?.fields?.find((x) => x.field_id === "study.therapeutic_area" || x.field_id === "diagnosis.indication");
    if (f?.value && typeof f.value === "string") return [f.value];
    return ["NSCLC"];
  })();

  const t0 = Date.now();
  try {
    const result = await enrich(body.runId, { buyer_conditions: buyerConditions });
    // eslint-disable-next-line no-console
    console.log(
      `[enrich/start] POST runId=${body.runId} returning +${Date.now() - t0}ms`,
    );
    return NextResponse.json({
      runId: result.run_id,
      started_at: result.started_at,
      states: result.states,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[enrich/start] error", err);
    return NextResponse.json({ error: `enrich failed: ${message}` }, { status: 500 });
  }
}
