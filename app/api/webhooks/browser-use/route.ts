// Browser Use webhook — REMOVED.
//
// Local headed Chromium (Playwright) replaced the cloud Browser Use API,
// so there's no remote service to POST completion callbacks from. The
// enrichment pipeline now emits ChainStageEvent-shaped updates in-process
// via lib/integrations/browser-use.ts → subscribeToSupplier(), consumed
// by app/api/enrich/sessions/[supplierId]/stream/route.ts (SSE).
//
// Kept as a 410 endpoint so any cached external references fail loud
// instead of hanging.

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "webhook_removed",
      message:
        "Browser Use cloud webhook removed — local Playwright headed mode " +
        "fires events in-process. See lib/integrations/browser-use.ts.",
    },
    { status: 410 },
  );
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "webhook_removed" },
    { status: 410 },
  );
}
