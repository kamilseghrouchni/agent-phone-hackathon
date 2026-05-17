// /api/audit/[supplierId]/[channel]/stage — request the next staged
// action for one supplier on one channel. Does NOT fire the integration.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot } from "@/lib/ai/pipeline-utils";
import { getSupplier, DEFAULT_AGENT_IDENTITY } from "@/lib/data/suppliers";
import { stageNext as stageEmail } from "@/lib/agents/correspond";
import { stageNext as stageForm } from "@/lib/agents/fill";
import type { ParsedQuery } from "@/types/parsed-query";

interface Body {
  runId: string;
  infoNeeds?: string[];
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
  if (!fs.existsSync(runDir)) {
    return NextResponse.json({ error: `Run ${body.runId} not found` }, { status: 404 });
  }
  const requestJson = JSON.parse(fs.readFileSync(path.join(runDir, "request.json"), "utf-8")) as {
    parsed_query: ParsedQuery;
    info_needs?: string[];
  };
  const infoNeeds = body.infoNeeds ?? requestJson.info_needs ?? [];

  try {
    const input = {
      runId: body.runId,
      runDir,
      parsed_query: requestJson.parsed_query,
      supplier,
      agent_identity: DEFAULT_AGENT_IDENTITY,
      infoNeeds,
    };
    if (channel === "email") {
      const staged = await stageEmail(input);
      return NextResponse.json({ staged });
    }
    if (channel === "form") {
      const staged = await stageForm(input);
      return NextResponse.json({ staged });
    }
    return NextResponse.json({ error: `Channel ${channel} not implemented yet (Phase A = email + form only)` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
