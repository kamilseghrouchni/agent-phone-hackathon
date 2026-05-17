/**
 * Intent router for the chat agent.
 *
 * Replaces Sonnet-driven tool selection with a regex-first router that falls
 * back to Haiku only when the free-text doesn't match any known pattern.
 *
 * Pipeline: regex follow-up patterns → Haiku free-text parse → naive parse.
 */
import { generateObject } from "ai";
import { anthropic, hasLLMKey } from "@/lib/ai/anthropic";
import { z } from "zod";
import { canonicalize, type SpecimenFilters } from "../filters";
import { orgs } from "../orgs";

export type Intent =
  | {
      kind: "follow_up_query";
      delta: SpecimenFilters;
      hint: string;
    }
  | {
      kind: "follow_up_compare";
      institute_ids: string[];
      hint: string;
    }
  | {
      kind: "first_query";
      filters: SpecimenFilters;
      inferred_keys: string[];
    };

export type RouteContext = {
  userText: string;
  hasPriorState: boolean;
  priorInstituteIds: string[];
  /** Pre-parsed filters from /api/parse on the landing page. When present and
   *  no prior state exists, skip the Haiku parseFreeText call. */
  preparsedFilters?: SpecimenFilters;
};

export async function routeIntent(ctx: RouteContext): Promise<Intent> {
  const text = ctx.userText.trim();
  const t = text.toLowerCase();

  if (ctx.hasPriorState) {
    const followUp = matchFollowUp(t, ctx.priorInstituteIds);
    if (followUp) return followUp;
  }

  if (!ctx.hasPriorState && ctx.preparsedFilters && Object.keys(ctx.preparsedFilters).length > 0) {
    return {
      kind: "first_query",
      filters: canonicalize(ctx.preparsedFilters),
      inferred_keys: [],
    };
  }

  const parsed = await parseFreeText(text);
  return { kind: "first_query", filters: parsed.filters, inferred_keys: parsed.inferred_keys };
}

function matchFollowUp(t: string, priorInstituteIds: string[]): Intent | null {
  if (/(drop|remove|filter out|without)[^.]*contact/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { has_contact_email: true },
      hint: "Filtering to institutes with a public contact email.",
    };
  }
  if (/group by country/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { display_grouping: "country" },
      hint: "Same query, grouped by country.",
    };
  }
  if (/group by (specimen|sample) ?type/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { display_grouping: "specimen_type" },
      hint: "Same query, grouped by specimen type.",
    };
  }
  if (/group by treatment/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { display_grouping: "treatment_status" },
      hint: "Same query, grouped by treatment status.",
    };
  }
  if (/only longitudinal|just longitudinal|filter to longitudinal/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { longitudinal: true },
      hint: "Restricting to donors with multi-year collections.",
    };
  }
  if (/(only|just) (treatment.?naive|naive|untreated)/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { treatment_status: "naive" },
      hint: "Restricting to treatment-naive donors.",
    };
  }
  if (/only matched pairs|just matched pairs|require matched pairs/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { matched_pairs_required: true },
      hint: "Restricting to donors with matched specimen pairs.",
    };
  }
  if (/^(usa|us)( only)?$/.test(t) || /usa only|only us\b/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { countries: ["USA"] },
      hint: "Restricting to USA institutes.",
    };
  }
  if (/outside (the )?(usa|us)\b|non.?usa|non.?us\b|exclude usa/.test(t)) {
    return {
      kind: "follow_up_query",
      delta: { countries: ["non-USA"] },
      hint: "Excluding USA institutes.",
    };
  }
  const nMatch = t.match(/(?:n[≥>=\s]*|need\s*at\s*least\s*|min(?:imum)?\s*)(\d{2,5})/);
  if (nMatch) {
    return {
      kind: "follow_up_query",
      delta: { min_n: parseInt(nMatch[1], 10) },
      hint: `Setting minimum sample size to ${nMatch[1]}.`,
    };
  }

  if (/^compare /.test(t) || / vs\.? /.test(t) || / versus /.test(t)) {
    const ids = matchInstituteIds(t, priorInstituteIds);
    if (ids.length >= 2) {
      const orgsMap = orgs();
      const names = ids.slice(0, 2).map((id) => orgsMap[id]?.name).filter(Boolean);
      return {
        kind: "follow_up_compare",
        institute_ids: ids.slice(0, 2),
        hint: names.length === 2 ? `Comparing ${names.join(" vs ")}.` : "Comparing the two institutes.",
      };
    }
  }

  return null;
}

function matchInstituteIds(t: string, priorInstituteIds: string[]): string[] {
  const orgsMap = orgs();
  const candidates = priorInstituteIds.length > 0 ? priorInstituteIds : Object.keys(orgsMap);
  const hits: string[] = [];
  for (const id of candidates) {
    const o = orgsMap[id];
    if (!o?.name) continue;
    const stem = o.name.toLowerCase().slice(0, 6);
    if (stem.length >= 4 && t.includes(stem)) hits.push(id);
  }
  return hits;
}

const llmFiltersSchema = z.object({
  indication: z.array(z.string()).optional(),
  specimen_types: z.array(z.string()).optional(),
  anatomy: z.array(z.string()).optional(),
  preservation: z.array(z.string()).optional(),
  treatment_status: z.enum(["naive", "any", "post"]).optional(),
  age_range: z.tuple([z.number().nullable(), z.number().nullable()]).optional(),
  countries: z.array(z.string()).optional(),
  matched_pairs_required: z.boolean().optional(),
  longitudinal: z.boolean().optional(),
  has_contact_email: z.boolean().optional(),
  min_n: z.number().nullable().optional(),
  inferred_keys: z.array(z.string()),
});

const PARSE_SYSTEM = `You parse biospecimen sourcing requests into structured filters.

Catalog facts:
- Specimen types: Tissue, Plasma, Serum, Urine, DNA, RNA, PBMCs, Buffy coat, Bone marrow, CSF.
- Preservation values: Frozen, Fixed (FFPE), Cryopreservation, Fresh, RNA-stabilizing Solution.
- Synonym hints: "MM"→multiple myeloma, "BMMC"→bone marrow, "FFPE"→preservation Fixed + Tissue, "TNBC"→triple-negative breast cancer.

Rules:
- Pull only what the user actually said. Use "inferred_keys" for fields you guessed (e.g., specimen_types: Tissue inferred from "tumor").
- Do NOT fabricate counts, dates, or hard-negatives.
- "longitudinal"/"multi-timepoint"/"across visits" → longitudinal: true.
- "FFPE" → preservation: ["Fixed"] AND specimen_types should include "Tissue".
- For matched-pair queries (FFPE tissue + frozen plasma), set matched_pairs_required: true and DO NOT set preservation.
`;

const PARSE_TIMEOUT_MS = 8000;

async function parseFreeText(text: string): Promise<{ filters: SpecimenFilters; inferred_keys: string[] }> {
  if (!hasLLMKey()) {
    return { filters: canonicalize(naiveParse(text)), inferred_keys: [] };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: PARSE_SYSTEM,
      prompt: `User request:\n"""${text}"""\n\nReturn the structured parse.`,
      schema: llmFiltersSchema,
      abortSignal: controller.signal,
    });
    const { inferred_keys, ...rest } = object;
    return { filters: canonicalize(rest as SpecimenFilters), inferred_keys: inferred_keys ?? [] };
  } catch {
    return { filters: canonicalize(naiveParse(text)), inferred_keys: [] };
  } finally {
    clearTimeout(timer);
  }
}

function naiveParse(q: string): SpecimenFilters {
  const t = q.toLowerCase();
  const f: SpecimenFilters = { free_text: q };
  const indMap: Record<string, string> = {
    melanoma: "melanoma",
    "multiple myeloma": "multiple myeloma",
    " mm ": "multiple myeloma",
    lymphoma: "lymphoma",
    "follicular lymphoma": "follicular lymphoma",
    "triple-negative breast cancer": "triple-negative breast cancer",
    tnbc: "triple-negative breast cancer",
    "breast cancer": "breast cancer",
    "lung cancer": "lung cancer",
    parkinson: "parkinson",
    alzheimer: "alzheimer",
    "lung scc": "lung squamous cell carcinoma",
    "ductal carcinoma": "invasive ductal carcinoma",
    idc: "invasive ductal carcinoma",
  };
  for (const [k, v] of Object.entries(indMap)) {
    if (t.includes(k)) f.indication = Array.from(new Set([...(f.indication ?? []), v]));
  }
  if (/ffpe|fixed/.test(t)) f.preservation = "Fixed";
  if (/frozen|cryo/.test(t)) f.preservation = (f.preservation ? [f.preservation as string, "Frozen"] : "Frozen") as any;
  const types: string[] = [];
  if (/plasma/.test(t)) types.push("Plasma");
  if (/serum/.test(t)) types.push("Serum");
  if (/tissue|tumor|biopsy/.test(t)) types.push("Tissue");
  if (/pbmc/.test(t)) types.push("Peripheral blood mononuclear cells (PBMCs)");
  if (types.length) f.specimen_types = types;
  if (/longitudinal|multi.?timepoint|over time|across visits/.test(t)) f.longitudinal = true;
  if (/treatment.?naive|untreated/.test(t)) f.treatment_status = "naive";
  if (/matched (plasma|serum|tumor|tissue)|paired (plasma|serum|tumor|tissue)/.test(t)) f.matched_pairs_required = true;
  const nMatch = t.match(/(?:n[≥>=\s]*|need[a-z\s]*)(\d{2,5})/);
  if (nMatch) f.min_n = parseInt(nMatch[1], 10);
  return f;
}
