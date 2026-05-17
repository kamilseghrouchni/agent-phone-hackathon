// /api/runs/[runId]/intake — returns the persisted IntakeForm for a run.
//
// Used by the workspace page as a fallback when sessionStorage doesn't have
// the intake stashed (e.g. when opening /workspace?runId=X&phase=chain
// directly without going through the PDF upload flow).

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot } from "@/lib/ai/pipeline-utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const file = path.join(getRepoRoot(), "store", "runs", runId, "intake.json");
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { error: `no intake.json at store/runs/${runId}/` },
      { status: 404 },
    );
  }
  try {
    const intake = JSON.parse(fs.readFileSync(file, "utf-8"));
    return NextResponse.json({ runId, intake });
  } catch (err) {
    return NextResponse.json(
      { error: `parse error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
