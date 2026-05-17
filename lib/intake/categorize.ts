// lib/intake/categorize.ts
// Applies the 35-field class table from spec §2.
// - categorizeIntake(raw) → returns an IntakeForm with all 35 fields, classed.
// - projectEvidence(intake, pool) → recomputes per-field status from evidence pool.

import type { IntakeField, IntakeForm, FieldStatus } from "@/types/intake";
import type { SupplierEvidence } from "@/types/evidence";

export type FieldClass = "frozen" | "confirmable" | "updatable" | "agent_filled";

export interface FieldSpec {
  field_id: string;
  section: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  label: string;
  class: FieldClass;
}

// The 35-field table — order matches spec §2.
export const FIELD_TABLE: FieldSpec[] = [
  // §1 Client & Project Information (7)
  { field_id: "client.company", section: 1, label: "Company Name", class: "frozen" },
  { field_id: "client.contact", section: 1, label: "Primary Contact Name", class: "frozen" },
  { field_id: "client.title", section: 1, label: "Title / Department", class: "frozen" },
  { field_id: "client.email", section: 1, label: "Email Address", class: "frozen" },
  { field_id: "client.phone", section: 1, label: "Phone Number", class: "frozen" },
  { field_id: "client.study_name", section: 1, label: "Project / Study Name", class: "frozen" },
  { field_id: "client.timeline", section: 1, label: "Requested Timeline / Deadline", class: "frozen" },

  // §2 Project Overview (5)
  { field_id: "project.purpose", section: 2, label: "Purpose of Request", class: "frozen" },
  { field_id: "project.therapeutic_area", section: 2, label: "Therapeutic Area / Disease State", class: "frozen" },
  { field_id: "project.irb_status", section: 2, label: "IRB / Ethics Approval Status", class: "confirmable" },
  { field_id: "project.consent", section: 2, label: "Patient Consent Requirements", class: "confirmable" },
  { field_id: "project.regulatory", section: 2, label: "Special Regulatory Requirements", class: "confirmable" },

  // §3 Specimen Requirements (9)
  { field_id: "specimen.types", section: 3, label: "Specimen Type(s) Requested", class: "updatable" },
  { field_id: "specimen.diagnosis", section: 3, label: "Diagnosis / Indication", class: "frozen" },
  { field_id: "specimen.quantity", section: 3, label: "Total Quantity Needed", class: "confirmable" },
  { field_id: "specimen.timepoints", section: 3, label: "Collection Timepoints", class: "confirmable" },
  { field_id: "specimen.format", section: 3, label: "Sample Format", class: "updatable" },
  { field_id: "specimen.min_volume", section: 3, label: "Minimum Volume / Tissue Size", class: "confirmable" },
  { field_id: "specimen.aliquot", section: 3, label: "Aliquot Requirements", class: "updatable" },
  { field_id: "specimen.matched_normal", section: 3, label: "Matched Normal Samples Required", class: "confirmable" },
  { field_id: "specimen.longitudinal", section: 3, label: "Longitudinal Samples Required", class: "frozen" },

  // §4 Patient Demographics & Clinical Criteria (8)
  { field_id: "demo.age_range", section: 4, label: "Age Range", class: "confirmable" },
  { field_id: "demo.gender", section: 4, label: "Gender Requirements", class: "frozen" },
  { field_id: "demo.ethnicity", section: 4, label: "Ethnicity Requirements", class: "confirmable" },
  { field_id: "demo.disease_stage", section: 4, label: "Disease Stage / Severity", class: "frozen" },
  { field_id: "demo.treatment_history", section: 4, label: "Treatment History Requirements", class: "confirmable" },
  { field_id: "demo.inclusion", section: 4, label: "Inclusion Criteria", class: "confirmable" },
  { field_id: "demo.exclusion", section: 4, label: "Exclusion Criteria", class: "confirmable" },
  { field_id: "demo.biomarker", section: 4, label: "Biomarker / Mutation Requirements", class: "updatable" },

  // §5 Clinical Data & Documentation (5)
  { field_id: "data.pathology", section: 5, label: "Pathology Reports Required", class: "confirmable" },
  { field_id: "data.emr", section: 5, label: "EMR / Clinical Data Required", class: "confirmable" },
  { field_id: "data.genomic", section: 5, label: "Genomic / Molecular Data Required", class: "updatable" },
  { field_id: "data.deidentified", section: 5, label: "De-identified or Coded Samples", class: "frozen" },
  { field_id: "data.additional_docs", section: 5, label: "Additional Required Documentation", class: "confirmable" },

  // §6 Logistics & Shipping (6)
  { field_id: "ship.schedule", section: 6, label: "Preferred Shipping Schedule", class: "updatable" },
  { field_id: "ship.temperature", section: 6, label: "Temperature Requirements", class: "confirmable" },
  { field_id: "ship.geography", section: 6, label: "Domestic or International Shipping", class: "frozen" },
  { field_id: "ship.packaging", section: 6, label: "Packaging Requirements", class: "confirmable" },
  { field_id: "ship.supplier_pref", section: 6, label: "Preferred Supplier Restrictions", class: "confirmable" },
  { field_id: "ship.special_handling", section: 6, label: "Special Handling Instructions", class: "confirmable" },

  // §7 Internal Feasibility Review — agent-filled (6)
  { field_id: "feas.suppliers", section: 7, label: "Potential Supplier(s) Identified", class: "agent_filled" },
  { field_id: "feas.availability", section: 7, label: "Estimated Availability", class: "agent_filled" },
  { field_id: "feas.eta", section: 7, label: "Estimated Turnaround Time", class: "agent_filled" },
  { field_id: "feas.status", section: 7, label: "Feasibility Status", class: "agent_filled" },
  { field_id: "feas.risks", section: 7, label: "Potential Risks / Challenges", class: "agent_filled" },
  { field_id: "feas.notes", section: 7, label: "Internal Notes", class: "agent_filled" },

  // §8 Contract — agent-filled NEW (4)
  { field_id: "contract.acceptance", section: 8, label: "Contract Acceptance", class: "agent_filled" },
  { field_id: "contract.down_payment", section: 8, label: "Down Payment", class: "agent_filled" },
  { field_id: "contract.meeting", section: 8, label: "Meeting Scheduled", class: "agent_filled" },
  { field_id: "contract.status", section: 8, label: "Status", class: "agent_filled" },
];

export function initialStatus(klass: FieldClass, value: unknown): FieldStatus {
  if (klass === "frozen") return "frozen";
  if (klass === "agent_filled") return value == null || value === "" ? "empty" : "agent_filled";
  // confirmable | updatable both start empty until evidence lands
  return "empty";
}

/**
 * Build a complete IntakeForm.fields[] from a partial values map keyed by field_id.
 * Missing keys land as empty (or "frozen" if class is frozen — UI shows the buyer value if present).
 */
export function categorizeIntake(
  run_id: string,
  source: IntakeForm["source"],
  buyer: IntakeForm["buyer"],
  values: Record<string, unknown>,
): IntakeForm {
  const fields: IntakeField[] = FIELD_TABLE.map((spec) => {
    const value = values[spec.field_id] ?? null;
    return {
      field_id: spec.field_id,
      section: spec.section,
      label: spec.label,
      class: spec.class,
      value,
      status: initialStatus(spec.class, value),
    };
  });
  return { run_id, source, buyer, fields };
}

/**
 * Project evidence onto the intake.
 *
 * - confirmable fields with matching evidence flip to "confirmed" (value preserved)
 * - updatable fields with matching evidence flip to "updated" (value overwritten)
 * - agent_filled fields with matching evidence get populated + status "agent_filled"
 * - frozen fields are never touched
 *
 * Returns a new IntakeForm (does not mutate input).
 */
export function projectEvidence(intake: IntakeForm, pool: SupplierEvidence[]): IntakeForm {
  // Index latest evidence per (field_id) — high-confidence wins ties; later timestamp breaks ties.
  const byField = new Map<string, SupplierEvidence>();
  const confidenceRank: Record<SupplierEvidence["confidence"], number> = { low: 0, medium: 1, high: 2 };
  for (const ev of pool) {
    const prev = byField.get(ev.field_id);
    if (!prev) {
      byField.set(ev.field_id, ev);
      continue;
    }
    const newer = ev.timestamp > prev.timestamp;
    const stronger = confidenceRank[ev.confidence] > confidenceRank[prev.confidence];
    if (stronger || (confidenceRank[ev.confidence] === confidenceRank[prev.confidence] && newer)) {
      byField.set(ev.field_id, ev);
    }
  }

  const fields: IntakeField[] = intake.fields.map((f) => {
    const ev = byField.get(f.field_id);
    if (!ev) return f;
    if (f.class === "frozen") return f;
    if (f.class === "confirmable") {
      return {
        ...f,
        status: "confirmed",
        provenance: {
          supplier_id: ev.supplier_id,
          channel: ev.channel,
          evidence_id: ev.evidence_id,
          quote: ev.quote,
        },
      };
    }
    if (f.class === "updatable") {
      return {
        ...f,
        value: ev.value,
        status: "updated",
        provenance: {
          supplier_id: ev.supplier_id,
          channel: ev.channel,
          evidence_id: ev.evidence_id,
          quote: ev.quote,
        },
      };
    }
    // agent_filled
    return {
      ...f,
      value: ev.value,
      status: "agent_filled",
      provenance: {
        supplier_id: ev.supplier_id,
        channel: ev.channel,
        evidence_id: ev.evidence_id,
        quote: ev.quote,
      },
    };
  });

  return { ...intake, fields };
}

/** The 6 "search-key" fields surfaced in the ConfirmStrip (spec §4 Beat 2). */
export const SEARCH_KEY_FIELDS: { field_id: string; label: string }[] = [
  { field_id: "specimen.diagnosis", label: "Indication" },
  { field_id: "specimen.types", label: "Specimen types" },
  { field_id: "specimen.quantity", label: "Quantity" },
  { field_id: "demo.biomarker", label: "Biomarker" },
  { field_id: "demo.treatment_history", label: "Treatment" },
  { field_id: "ship.geography", label: "Geography" },
];

/** Group intake.fields by section, ordered 1→8. */
export function groupBySection(intake: IntakeForm): { section: number; fields: IntakeField[] }[] {
  const groups = new Map<number, IntakeField[]>();
  for (const f of intake.fields) {
    if (!groups.has(f.section)) groups.set(f.section, []);
    groups.get(f.section)!.push(f);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([section, fields]) => ({ section, fields }));
}

export const SECTION_TITLES: Record<number, string> = {
  1: "Client & Project Information",
  2: "Project Overview",
  3: "Specimen Requirements",
  4: "Patient Demographics & Clinical Criteria",
  5: "Clinical Data & Documentation",
  6: "Logistics & Shipping Requirements",
  7: "Internal Feasibility Review",
  8: "Contract & Close",
};
