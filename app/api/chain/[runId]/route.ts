// app/api/chain/[runId]/route.ts
//
// GET — returns the current ChainState for a run (initial paint).
// The workspace SSE-subscribes to /stream for live updates, but uses this
// endpoint to grab the first snapshot before the EventSource catches up.

import { NextRequest, NextResponse } from "next/server";
import { loadChainState } from "@/lib/agents/runtime/chain-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ runId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { runId } = await ctx.params;
  const state = loadChainState(runId);
  if (!state) {
    return NextResponse.json({ error: "chain not initialized" }, { status: 404 });
  }
  return NextResponse.json({ chain: state });
}
