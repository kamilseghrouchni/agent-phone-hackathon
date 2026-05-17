// Planner — constrained LLM pick from an action menu.
//
// Filters the channel's action space against:
//   1. prerequisites met (all listed action_ids must appear in priorActions)
//   2. cross_channel_required → only if Supermemory has cross-channel evidence
//   3. budget_exhausted → only `wrap` / `escalate` / outreach actions remain
//
// Then asks the LLM to pick exactly one action and explain WHY in one
// sentence. Temperature is low; the schema is tight.

import { z } from "zod";
import { plan as llmPlan } from "@/lib/llm";
import { loadActionSpace } from "../action-spaces/loader";
import type { Action, ActionCategory, ChannelName } from "../action-spaces/schema";
import type { ParsedQuery } from "@/types/parsed-query";
import type { BiobankOpportunity } from "@/types/biobank";
import type { ActionReasoningLog } from "@/types/action-log";

export interface PlannerInput {
  channel: ChannelName;
  parsed_query: ParsedQuery;
  supplier: BiobankOpportunity;
  priorActions: ActionReasoningLog[];      // all prior records for this run+supplier+channel
  crossChannelEvidence: ActionReasoningLog[]; // result of queryCrossChannel
  infoNeeds: string[];                      // priority order-critical fields not yet extracted
  questions_remaining: number;              // hard-cap budget (cold≤5, warm≤3)
  transcript_so_far?: string;
}

export interface PlannerPick {
  action_id: string;
  reasoning: string;
}

const NON_QUESTION_CATEGORIES: ActionCategory[] = ["outreach", "wrap", "escalate", "confirmation"];

function filterCandidates(opts: {
  actions: Action[];
  priorActionIds: Set<string>;
  hasCrossChannel: boolean;
  budgetExhausted: boolean;
}): Action[] {
  const { actions, priorActionIds, hasCrossChannel, budgetExhausted } = opts;
  return actions.filter((a) => {
    // Fallback actions (rate_limit, captcha, no_slot etc.) are out-of-band
    // and only pickable via the runtime's escape-hatch path, never via the
    // normal Planner menu.
    if (a.fallback_for) return false;
    if (a.cross_channel_required && !hasCrossChannel) return false;
    for (const p of a.prerequisites) {
      if (!priorActionIds.has(p)) return false;
    }
    if (budgetExhausted && !NON_QUESTION_CATEGORIES.includes(a.category)) return false;
    return true;
  });
}

export async function runPlanner(input: PlannerInput): Promise<PlannerPick> {
  const space = loadActionSpace(input.channel);
  const priorActionIds = new Set(input.priorActions.map((r) => r.action_id));
  const hasCrossChannel = input.crossChannelEvidence.length > 0;
  const budgetExhausted = input.questions_remaining <= 0;

  const candidates = filterCandidates({
    actions: space.actions,
    priorActionIds,
    hasCrossChannel,
    budgetExhausted,
  });

  if (candidates.length === 0) {
    // Nothing valid — fall back to the channel's wrap action if any, else the first action.
    const fallback = space.actions.find((a) => a.category === "wrap") ?? space.actions[0];
    return { action_id: fallback.id, reasoning: "no candidates passed filter; falling back to wrap" };
  }

  // If only one valid candidate and it's an outreach with no priors, just pick it without LLM.
  if (candidates.length === 1) {
    return {
      action_id: candidates[0].id,
      reasoning: `single valid candidate (${candidates[0].id}); other actions failed prerequisite or gating filter`,
    };
  }

  const allowedIds = candidates.map((a) => a.id);
  const schema = z.object({
    action_id: z.enum(allowedIds as [string, ...string[]]),
    reasoning: z.string().min(8).max(280),
  });

  const menuLines = candidates
    .map((a) => `  - ${a.id} [${a.category}] — extracts: ${(a.extracts ?? []).map((e) => e.field).join(", ") || "(none)"}`)
    .join("\n");
  const priorLines = input.priorActions.length > 0
    ? input.priorActions.map((r) => `  - ${r.action_id} → ${Object.keys(r.output).join(", ") || "(no fields)"}`).join("\n")
    : "  (no prior turns)";
  const crossLines = hasCrossChannel
    ? input.crossChannelEvidence
        .slice(0, 5)
        .map((r) => `  - ${r.supplier_id}.${r.channel}.${r.action_id} → ${Object.keys(r.output).join(", ")}`)
        .join("\n")
    : "  (none)";

  const system = `You are the Planner for the ${input.channel} channel of vCRO Audit.

Pick exactly ONE action from the menu. Cannot pick anything outside the menu.

Decision priorities:
  1. Cover info_needs that the user prioritized (order-critical fields).
  2. If prior actions already extracted some info_needs, move on — don't re-ask.
  3. If cross-channel evidence is non-empty, the leverage move (counter_*) is on the table.
  4. If the budget hits 0 you only see wrap/outreach/escalate — choose to wrap gracefully.

Output JSON only.`;

  const state = {
    supplier: { id: input.supplier.id, name: input.supplier.name, audit_state: input.supplier.audit_state },
    parsed_query: {
      diseases: input.parsed_query.diseases,
      specimens: input.parsed_query.specimens,
      stages: input.parsed_query.stages,
      treatment_status: input.parsed_query.treatment_status,
      use_case: input.parsed_query.use_case,
    },
    info_needs: input.infoNeeds,
    questions_remaining: input.questions_remaining,
    transcript_so_far: input.transcript_so_far ?? "(none)",
    menu: `\n${menuLines}\n`,
    prior_turns: `\n${priorLines}\n`,
    cross_channel_evidence: `\n${crossLines}\n`,
  };

  const pick = await llmPlan({ system, state, schema });
  return pick;
}
