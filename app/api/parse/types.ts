import type { SpecimenFilters } from "@/lib/filters";

export type ParsedField = {
  key: string;
  label: string;
  value: string;
  source: "stated" | "inferred" | "default";
};

export type DetectedAssay = {
  assay: string;            // matches specific_assay in assay_catalog.tsv
  family: string;           // assay_family
  source: "stated" | "inferred";
  reason?: string;          // brief why ("user said 'methylation'", "implied by biomarker discovery + plasma")
};

export type Clarifier = {
  id: string;
  question: string;
  why: string;
  proposed_label: string;
  proposed_value: string | number | boolean | null;
  target_field: keyof SpecimenFilters | "min_n";
  options?: { label: string; value: string | number | boolean | null }[];
};

export type ParseResult = {
  parsed_text: string;
  filters: SpecimenFilters;
  fields: ParsedField[];
  assays: DetectedAssay[];
  clarifiers: Clarifier[];
  facets: {
    total_specimens: number;
    total_donors: number;
    total_institutes: number;
    estimated_match: number | null;
    top_specimen_types: { name: string; count: number }[];
    top_countries: { name: string; count: number }[];
  };
};

export type ClarifierAnswer = {
  id: string;
  // null = skipped, otherwise either the proposed value or a custom one
  value: string | number | boolean | null;
  custom_text?: string; // user wrote their own answer
};
