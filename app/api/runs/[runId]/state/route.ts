// /api/runs/[runId]/state — current state for the UI to render.
// Returns parsed_query + per-supplier audit state + reasoning log entries.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot } from "@/lib/ai/pipeline-utils";
import { listRecords } from "@/lib/agents/runtime/reasoning-log";
import type { ParsedQuery } from "@/types/parsed-query";
import type { ActionReasoningLog } from "@/types/action-log";

interface SupplierState {
  audit_state: "pending" | "in_progress" | "responded" | "confirmed";
  channels: Record<string, { last_action_id?: string; sent_at?: string; replied_at?: string; extracted: Record<string, unknown> }>;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const runDir = path.join(getRepoRoot(), "store", "runs", runId);
  if (!fs.existsSync(runDir)) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const requestJsonPath = path.join(runDir, "request.json");
  const request = fs.existsSync(requestJsonPath)
    ? JSON.parse(fs.readFileSync(requestJsonPath, "utf-8")) as { parsed_query: ParsedQuery; info_needs: string[]; original_text: string }
    : null;

  const records = await listRecords(runDir);
  const bySupplier: Record<string, SupplierState> = {};

  for (const r of records as ActionReasoningLog[]) {
    const sup = bySupplier[r.supplier_id] ?? { audit_state: "in_progress" as const, channels: {} };
    const ch = sup.channels[r.channel] ?? { extracted: {} as Record<string, unknown> };
    if (r.action_id.endsWith("__reply")) {
      ch.replied_at = r.timestamp;
      // Merge extracted fields (each field {value, evidence_quote})
      for (const [k, v] of Object.entries(r.output)) {
        ch.extracted[k] = v;
      }
      sup.audit_state = "responded";
    } else {
      ch.last_action_id = r.action_id;
      ch.sent_at = r.timestamp;
    }
    sup.channels[r.channel] = ch;
    bySupplier[r.supplier_id] = sup;
  }

  return NextResponse.json({
    runId,
    request,
    suppliers: bySupplier,
    reasoning_log: records,
  });
}
