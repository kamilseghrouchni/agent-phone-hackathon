// /api/webhooks/agentmail — real inbound webhook from AgentMail.
// Looks up which run owns the thread by scanning store/runs/* outbox/email.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot, emitProgress } from "@/lib/ai/pipeline-utils";
import { parseInboundWebhook } from "@/lib/integrations/agentmail";
import { getSupplier } from "@/lib/data/suppliers";
import { handleInbound } from "@/lib/agents/correspond";
import {
  buildHandlersForRun,
  isEmailAgreeReply,
} from "@/lib/agents/runtime/build-handlers";
import {
  loadChainState,
  appendEvent,
  saveChainState,
  completeStage,
} from "@/lib/agents/runtime/chain-runtime";

function findRunBySupplierThread(threadId: string): { runId: string; supplierId: string } | null {
  const runsDir = path.join(getRepoRoot(), "store", "runs");
  if (!fs.existsSync(runsDir)) return null;
  for (const runId of fs.readdirSync(runsDir)) {
    // First: scan chain.json email events (real-mode sends record thread_id
    // in payload.thread_id, not in outbox).
    const chainPath = path.join(runsDir, runId, "chain.json");
    if (fs.existsSync(chainPath)) {
      try {
        const chain = JSON.parse(fs.readFileSync(chainPath, "utf-8"));
        const evs = chain?.stages?.email?.events ?? [];
        for (const e of evs) {
          if (e?.payload?.thread_id === threadId) {
            return { runId, supplierId: chain.supplier_id ?? "crovi_bio" };
          }
        }
      } catch { /* skip */ }
    }
    // Fallback: stub-mode outbox files.
    const outbox = path.join(runsDir, runId, "outbox", "email");
    if (!fs.existsSync(outbox)) continue;
    for (const f of fs.readdirSync(outbox)) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(outbox, f), "utf-8"));
        if (r.thread_id === threadId) {
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
  // handleInbound runs the audit-phase reply parser; it expects a prior
  // email action to exist in the audit timeline. For chain-flow runs the
  // audit timeline may be empty (this is a Stage-3 reply, not an audit
  // exchange), so wrap in try/catch — the cascade below is what matters.
  let extractedCount = 0;
  try {
    const result = await handleInbound({ runId: found.runId, runDir, supplier, reply });
    extractedCount = Object.keys(result.extracted).length;
    emitProgress(runDir, {
      phase: "audit",
      event: "finding",
      message: `Reply from ${supplier.name} parsed; ${extractedCount} field(s) extracted.`,
    });
  } catch (err) {
    // chain-flow reply: no audit prior to attach to. Non-fatal.
    console.warn(
      `[agentmail webhook] handleInbound non-fatal: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Thread the reply into Stage 3 (email) timeline + cascade to Stage 4
  // (sms_pay) when the supplier signals agreement. The cascade is gated on
  // a permissive yes-detector (isEmailAgreeReply) so "I agree", "agreed",
  // "yes proceed", etc. all land. Non-agreement replies still get
  // threaded into the timeline but don't fire SMS.
  const live = loadChainState(found.runId);
  let cascaded = false;
  if (live) {
    appendEvent(live, "email", {
      event_id: `email:inbound:${reply.message_id ?? Date.now()}`,
      timestamp: reply.received_at ?? new Date().toISOString(),
      direction: "inbound",
      actor: "supplier",
      channel: "email",
      text: (reply.text ?? "").slice(0, 400),
      payload: { thread_id: reply.thread_id, from: reply.from },
    });
    saveChainState(live);

    if (isEmailAgreeReply(reply.text ?? "")) {
      try {
        const handlers = buildHandlersForRun(found.runId);
        await completeStage(
          live,
          { stage: "email", kind: "replied_yes" },
          handlers,
        );
        cascaded = true;
      } catch {
        // best-effort; webhook returns success either way
      }
    }
  }

  return NextResponse.json({
    runId: found.runId,
    supplierId: supplier.id,
    extractedFields: extractedCount,
    cascadedToSmsPay: cascaded,
  });
}
