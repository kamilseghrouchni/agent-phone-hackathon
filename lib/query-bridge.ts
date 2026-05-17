// Bridge: turn the existing HandoffModal's SpecimenFilters into the
// ParsedQuery shape the new Correspond / Fill agents consume.

import type { ParsedQuery, SpecimenRequest, SpecimenType, Stage } from "@/types/parsed-query";
import type { SpecimenFilters } from "@/lib/filters";

const SPECIMEN_TYPE_MAP: Record<string, SpecimenType> = {
  Tissue: "FFPE block",
  Plasma: "plasma",
  Serum: "serum",
  Urine: "plasma", // not a great map but agents extract details in audit
  DNA: "DNA",
  RNA: "RNA",
  PBMCs: "PBMC",
  "Buffy coat": "buffy coat",
  "Peripheral blood mononuclear cells (PBMCs)": "PBMC",
};

function mapSpecimenType(t: string): SpecimenType {
  return SPECIMEN_TYPE_MAP[t] ?? (t as SpecimenType);
}

export function buildParsedQuery(
  rawQuery: string,
  filters: SpecimenFilters,
  defaultUseCase = "biospecimen sourcing audit",
): ParsedQuery {
  const presList = Array.isArray(filters.preservation)
    ? filters.preservation
    : filters.preservation
      ? [filters.preservation as string]
      : [];

  const isFFPE = presList.some((p) => /fixed|ffpe/i.test(String(p)));

  const types = filters.specimen_types ?? [];
  const specimens: SpecimenRequest[] = types.length
    ? types.map((t) => ({
        type: isFFPE && /tissue/i.test(t) ? "FFPE block" : mapSpecimenType(t),
        n_cases: filters.min_n ?? 50,
      }))
    : [{ type: "FFPE block", n_cases: filters.min_n ?? 50 }];

  const treatment_status =
    filters.treatment_status === "naive"
      ? "naive"
      : filters.treatment_status === "post"
        ? "treated"
        : "any";

  return {
    diseases: filters.indication,
    stages: undefined,
    treatment_status,
    specimens,
    anatomical_sites: filters.anatomy,
    matched_normal_required: filters.matched_pairs_required ?? false,
    matched_set_required: filters.longitudinal ? ["longitudinal"] : undefined,
    age_range:
      filters.age_range && (filters.age_range[0] != null || filters.age_range[1] != null)
        ? [filters.age_range[0] ?? 0, filters.age_range[1] ?? 120]
        : undefined,
    use_case: defaultUseCase,
    raw_query: rawQuery,
  };
}

// Order-critical fields the audit should chase down. The spec uses these as
// `info_needs` — Planner picks actions that extract these.
export function defaultInfoNeeds(query: ParsedQuery): string[] {
  const needs = [
    "biomarker_status",
    "turnaround_weeks",
    "price_per_case_usd",
    "consent_scope",
    "collection_protocol",
  ];
  if (query.matched_set_required?.includes("longitudinal")) {
    needs.unshift("longitudinal_visit_coverage");
  }
  if (query.specimens.some((s) => /tissue|FFPE/i.test(s.type))) {
    needs.push("tissue_quality_grade");
  }
  return needs;
}
