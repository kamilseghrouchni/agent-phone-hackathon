// Parsed user request — spec § 3.1.
//
// SEARCH-CRITICAL fields are answered deterministically against the RefMed
// XLSX (search-engine.ts). ORDER-CRITICAL fields require live audit and
// never appear in any public catalog.

export type Stage = "I" | "II" | "III" | "IV";
export type TreatmentStatus = "naive" | "treated" | "any";
export type ConsentType = "broad" | "narrow" | "specific" | "any";

export type SpecimenType =
  | "plasma"
  | "serum"
  | "PBMC"
  | "FFPE block"
  | "frozen tissue"
  | "fresh tissue"
  | "buffy coat"
  | "DNA"
  | "RNA"
  | string; // permissive — keep open for unusual asks

export interface SpecimenRequest {
  type: SpecimenType;
  n_cases: number;
  min_volume_mL?: number;
}

export type MatchedSetRequirement =
  | "tumor+adjacent_normal"
  | "tumor+plasma"
  | "longitudinal";

export interface ParsedQuery {
  // -- SEARCH-CRITICAL (answered against catalog deterministically) ----
  diseases?: string[];
  stages?: Stage[];
  treatment_status?: TreatmentStatus;
  specimens: SpecimenRequest[];
  anatomical_sites?: string[];
  matched_normal_required?: boolean;
  matched_set_required?: MatchedSetRequirement[];
  price_cap_usd?: number;

  // -- ORDER-CRITICAL (require audit to obtain) ------------------------
  biomarkers?: string[]; // e.g. ["EGFR", "KRAS", "ALK"]
  age_range?: [number, number];
  consent_type?: ConsentType;
  irb_required?: boolean;
  quality_grade?: string;
  turnaround_max_weeks?: number;
  collection_protocol_constraints?: string[];

  // -- META ------------------------------------------------------------
  use_case: string;
  raw_query: string;
}

// What the Understand agent emits when the query is incomplete.
export type SearchCriticalField =
  | "diseases"
  | "stages"
  | "treatment_status"
  | "specimens"
  | "anatomical_sites"
  | "price_cap_usd";

export interface UnderstandResult {
  parsed: ParsedQuery;
  missing_search_critical: SearchCriticalField[];
}
