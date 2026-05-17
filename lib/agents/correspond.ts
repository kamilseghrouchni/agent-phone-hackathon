// Correspond agent — email channel.
// Wraps the runtime (Planner/Builder/Extractor) with the AgentMail
// integration. Two phases per turn:
//
//   stageNext()  — Planner picks an action, Builder renders, returns
//                  preview. Nothing fires.
//   confirmAndSend(stagedAction) — actually invokes AgentMail.sendEmail,
//                  writes a Sent reasoning-log entry.
//   handleInbound(reply) — Extractor pulls fields from a real (or
//                  simulated) inbound reply, writes a Replied entry.

import { randomUUID } from "crypto";
import type { ParsedQuery } from "@/types/parsed-query";
import type { BiobankOpportunity } from "@/types/biobank";
import type { ActionReasoningLog } from "@/types/action-log";
import type { Action } from "./action-spaces/schema";
import { findAction } from "./action-spaces/loader";
import { runPlanner } from "./runtime/planner";
import { buildAction, type BuiltAction } from "./runtime/builder";
import { runExtractor } from "./runtime/extractor";
import { appendRecord, listRecords, queryCrossChannel, priorByAction } from "./runtime/reasoning-log";
import type { AgentIdentity, ResolveContext } from "./runtime/slot-resolver";
import { sendEmail, type EmailSendResult, type InboundEmail } from "@/lib/integrations/agentmail";

export interface CorrespondInput {
  runId: string;
  runDir: string;
  parsed_query: ParsedQuery;
  supplier: BiobankOpportunity;
  agent_identity: AgentIdentity;
  infoNeeds: string[];
}

export interface StagedAction {
  action_id: string;
  channel: "email";
  reasoning: string;
  built: BuiltAction;
  staged_at: string;
}

export async function stageNext(input: CorrespondInput): Promise<StagedAction> {
  const { runId, runDir, parsed_query, supplier, agent_identity, infoNeeds } = input;

  const allRecords = await listRecords(runDir);
  const supplierRecords = allRecords.filter((r) => r.supplier_id === supplier.id && r.channel === "email");
  const crossChannel = await queryCrossChannel({ runDir, currentSupplierId: supplier.id, infoNeeds });
  const prior = await priorByAction({ runDir, supplierId: supplier.id, channel: "email" });

  // Question budget: warm = 3, cold = 5 — for now check if supplier has a
  // catalog (RefMed-like). Cold/warm action-space refactor is later.
  const isWarm = Boolean(supplier.reported.public_xlsx_url || supplier.reported.filterable_catalog_url);
  const totalBudget = isWarm ? 3 : 5;
  const questionsAsked = supplierRecords.filter((r) => {
    const a = findAction("email", r.action_id);
    return a?.category === "question";
  }).length;
  const questions_remaining = Math.max(0, totalBudget - questionsAsked);

  const pick = await runPlanner({
    channel: "email",
    parsed_query,
    supplier,
    priorActions: supplierRecords,
    crossChannelEvidence: crossChannel,
    infoNeeds,
    questions_remaining,
  });

  const action = findAction("email", pick.action_id);
  if (!action) throw new Error(`Planner picked unknown action ${pick.action_id}`);

  const ctx: ResolveContext = {
    parsed_query,
    supplier,
    prior,
    cross_channel: extractCrossChannelFields(crossChannel, infoNeeds),
    agent_identity,
    state: { run_id: runId },
  };
  const built = buildAction(action, ctx);

  return {
    action_id: pick.action_id,
    channel: "email",
    reasoning: pick.reasoning,
    built,
    staged_at: new Date().toISOString(),
  };
}

export interface ConfirmInput extends CorrespondInput {
  staged: StagedAction;
}

export interface ConfirmResult {
  reasoning_log_id: string;
  send_result: EmailSendResult;
}

export async function confirmAndSend(input: ConfirmInput): Promise<ConfirmResult> {
  const { runId, runDir, supplier, staged } = input;
  if (staged.built.kind !== "utterance") {
    throw new Error("Email channel expected utterance built action");
  }

  const sendResult = await sendEmail({
    runId,
    runDir,
    supplier,
    rendered: staged.built.text,
  });

  const id = randomUUID();
  const record: ActionReasoningLog = {
    id,
    run_id: runId,
    supplier_id: supplier.id,
    channel: "email",
    action_id: staged.action_id,
    timestamp: new Date().toISOString(),
    reasoning: staged.reasoning,
    inputs: staged.built.slot_values,
    output: {
      thread_id: { value: sendResult.thread_id },
      message_id: { value: sendResult.message_id },
    },
    cross_channel_refs: [],
    success: true,
  };
  await appendRecord(runDir, record);
  return { reasoning_log_id: id, send_result: sendResult };
}

export interface InboundInput {
  runId: string;
  runDir: string;
  supplier: BiobankOpportunity;
  reply: InboundEmail;
}

export async function handleInbound(input: InboundInput): Promise<{ reasoning_log_id: string; extracted: Record<string, unknown> }> {
  const { runId, runDir, supplier, reply } = input;

  // Find the most recent staged action on this thread to know what extract schema to use.
  const all = await listRecords(runDir);
  const lastEmail = [...all].reverse().find((r) => r.supplier_id === supplier.id && r.channel === "email");
  if (!lastEmail) throw new Error("No prior email action to attach reply to");
  const action = findAction("email", lastEmail.action_id);
  if (!action) throw new Error(`Unknown action ${lastEmail.action_id}`);

  const extracted = await runExtractor({
    action,
    counterparty_response: reply.text || reply.subject,
    context_hint: `Reply on thread "${reply.subject}" from ${reply.from}.`,
  });

  const id = randomUUID();
  const record: ActionReasoningLog = {
    id,
    run_id: runId,
    supplier_id: supplier.id,
    channel: "email",
    action_id: `${lastEmail.action_id}__reply`,
    timestamp: new Date().toISOString(),
    reasoning: `Inbound reply parsed; extracted ${Object.keys(extracted).length} field(s).`,
    inputs: { reply_message_id: reply.message_id, reply_thread_id: reply.thread_id },
    output: extracted,
    cross_channel_refs: [],
    success: true,
  };
  await appendRecord(runDir, record);
  return { reasoning_log_id: id, extracted };
}

function extractCrossChannelFields(records: ActionReasoningLog[], infoNeeds: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of records) {
    for (const need of infoNeeds) {
      const raw = r.output[need];
      if (raw == null) continue;
      const value = (raw as { value?: unknown }).value ?? raw;
      // Build a competitor-context bundle for the leverage move.
      if (need === "price_per_case_usd" && typeof value === "number" && !out.competitor_price_usd) {
        out.competitor_price_usd = value;
        out.competitor_name = r.supplier_id;
      }
      if (!out[need]) out[need] = value;
    }
  }
  return out;
}

