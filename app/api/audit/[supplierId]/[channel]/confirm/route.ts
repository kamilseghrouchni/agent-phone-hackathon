// /api/audit/[supplierId]/[channel]/confirm — fires the staged action.
// Body must include the staged action object returned by /stage so we
// don't re-Plan in between (the user may have edited the preview).

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot, emitProgress } from "@/lib/ai/pipeline-utils";
import { getSupplier, DEFAULT_AGENT_IDENTITY } from "@/lib/data/suppliers";
import { confirmAndSend, type StagedAction } from "@/lib/agents/correspond";
import { confirmAndSubmit, type StagedFormAction } from "@/lib/agents/fill";
import type { ParsedQuery } from "@/types/parsed-query";

interface Body {
  runId: string;
  staged: StagedAction | StagedFormAction;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ supplierId: string; channel: string }> },
) {
  const { supplierId, channel } = await params;
  const body = (await req.json()) as Body;
  const supplier = getSupplier(supplierId);
  if (!supplier) return NextResponse.json({ error: `Unknown supplier ${supplierId}` }, { status: 404 });

  const runDir = path.join(getRepoRoot(), "store", "runs", body.runId);
  const requestJson = JSON.parse(fs.readFileSync(path.join(runDir, "request.json"), "utf-8")) as {
    parsed_query: ParsedQuery;
    info_needs?: string[];
  };

  try {
    const base = {
      runId: body.runId,
      runDir,
      parsed_query: requestJson.parsed_query,
      supplier,
      agent_identity: DEFAULT_AGENT_IDENTITY,
      infoNeeds: requestJson.info_needs ?? [],
    };

    if (channel === "email") {
      const result = await confirmAndSend({ ...base, staged: body.staged as StagedAction });
      emitProgress(runDir, {
        phase: "audit",
        event: "finding",
        message: `Email sent to ${supplier.name} via ${result.send_result.mode} mode → ${result.send_result.envelope.to}`,
      });
      return NextResponse.json({ result });
    }
    if (channel === "form") {
      const result = await confirmAndSubmit({ ...base, staged: body.staged as StagedFormAction });
      emitProgress(runDir, {
        phase: "audit",
        event: "finding",
        message: `Form submitted to ${supplier.name} via ${result.submit_result.mode} mode → ${result.submit_result.envelope.target_url}`,
      });
      return NextResponse.json({ result });
    }
    return NextResponse.json({ error: `Channel ${channel} not implemented yet` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
