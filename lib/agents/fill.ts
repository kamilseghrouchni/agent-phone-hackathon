// Fill agent — form channel.
// Same shape as Correspond but uses Browser Use as the integration.

import { randomUUID } from "crypto";
import type { ParsedQuery } from "@/types/parsed-query";
import type { BiobankOpportunity } from "@/types/biobank";
import type { ActionReasoningLog } from "@/types/action-log";
import { findAction } from "./action-spaces/loader";
import { runPlanner } from "./runtime/planner";
import { buildAction, type BuiltAction } from "./runtime/builder";
import { runExtractor } from "./runtime/extractor";
import { appendRecord, listRecords, queryCrossChannel, priorByAction } from "./runtime/reasoning-log";
import type { AgentIdentity, ResolveContext } from "./runtime/slot-resolver";
import { submitForm, type FormSubmitResult } from "@/lib/integrations/browser-use";

export interface FillInput {
  runId: string;
  runDir: string;
  parsed_query: ParsedQuery;
  supplier: BiobankOpportunity;
  agent_identity: AgentIdentity;
  infoNeeds: string[];
}

export interface StagedFormAction {
  action_id: string;
  channel: "form";
  reasoning: string;
  built: BuiltAction;
  staged_at: string;
}

export async function stageNext(input: FillInput): Promise<StagedFormAction> {
  const { runId, runDir, parsed_query, supplier, agent_identity, infoNeeds } = input;

  const all = await listRecords(runDir);
  const supplierRecords = all.filter((r) => r.supplier_id === supplier.id && r.channel === "form");
  const crossChannel = await queryCrossChannel({ runDir, currentSupplierId: supplier.id, infoNeeds });
  const prior = await priorByAction({ runDir, supplierId: supplier.id, channel: "form" });

  const isWarm = Boolean(supplier.reported.public_xlsx_url || supplier.reported.filterable_catalog_url);
  const totalBudget = isWarm ? 3 : 5;
  const questionsAsked = supplierRecords.filter((r) => {
    const a = findAction("form", r.action_id);
    return a?.category === "question";
  }).length;
  const questions_remaining = Math.max(0, totalBudget - questionsAsked);

  const pick = await runPlanner({
    channel: "form",
    parsed_query,
    supplier,
    priorActions: supplierRecords,
    crossChannelEvidence: crossChannel,
    infoNeeds,
    questions_remaining,
  });
  const action = findAction("form", pick.action_id);
  if (!action) throw new Error(`Planner picked unknown action ${pick.action_id}`);

  const ctx: ResolveContext = {
    parsed_query,
    supplier,
    prior,
    cross_channel: {},
    agent_identity,
    state: { run_id: runId },
  };
  const built = buildAction(action, ctx);
  return {
    action_id: pick.action_id,
    channel: "form",
    reasoning: pick.reasoning,
    built,
    staged_at: new Date().toISOString(),
  };
}

export interface ConfirmFormInput extends FillInput {
  staged: StagedFormAction;
}

export interface ConfirmFormResult {
  reasoning_log_id: string;
  submit_result: FormSubmitResult;
}

export async function confirmAndSubmit(input: ConfirmFormInput): Promise<ConfirmFormResult> {
  const { runId, runDir, supplier, staged } = input;
  if (staged.built.kind !== "parameters") {
    throw new Error("Form channel expected parameters built action");
  }

  const submit = await submitForm({
    runId,
    runDir,
    supplier,
    fields: staged.built.values,
  });

  const id = randomUUID();
  const record: ActionReasoningLog = {
    id,
    run_id: runId,
    supplier_id: supplier.id,
    channel: "form",
    action_id: staged.action_id,
    timestamp: new Date().toISOString(),
    reasoning: staged.reasoning,
    inputs: staged.built.values,
    output: {
      submission_id: { value: submit.submission_id },
      confirmation_message: { value: submit.confirmation_message ?? null },
      target_url: { value: submit.envelope.target_url },
    },
    cross_channel_refs: [],
    success: !submit.submission_id.startsWith("failed_"),
  };
  await appendRecord(runDir, record);
  return { reasoning_log_id: id, submit_result: submit };
}

export interface InboundFormInput {
  runId: string;
  runDir: string;
  supplier: BiobankOpportunity;
  // For form channel, "inbound" is typically a follow-up email; we still
  // record an extraction event tied to the most recent form action.
  reply_text: string;
  reply_id?: string;
}

export async function handleInbound(input: InboundFormInput): Promise<{ reasoning_log_id: string; extracted: Record<string, unknown> }> {
  const { runId, runDir, supplier, reply_text, reply_id } = input;
  const all = await listRecords(runDir);
  const lastForm = [...all].reverse().find((r) => r.supplier_id === supplier.id && r.channel === "form");
  if (!lastForm) throw new Error("No prior form action to attach inbound to");
  const action = findAction("form", lastForm.action_id);
  if (!action) throw new Error(`Unknown action ${lastForm.action_id}`);

  const extracted = await runExtractor({
    action,
    counterparty_response: reply_text,
    context_hint: `Follow-up after form submission to ${supplier.name}.`,
  });

  const id = randomUUID();
  const record: ActionReasoningLog = {
    id,
    run_id: runId,
    supplier_id: supplier.id,
    channel: "form",
    action_id: `${lastForm.action_id}__reply`,
    timestamp: new Date().toISOString(),
    reasoning: `Inbound on form thread parsed; extracted ${Object.keys(extracted).length} field(s).`,
    inputs: { reply_id: reply_id ?? null },
    output: extracted,
    cross_channel_refs: [],
    success: true,
  };
  await appendRecord(runDir, record);
  return { reasoning_log_id: id, extracted };
}
