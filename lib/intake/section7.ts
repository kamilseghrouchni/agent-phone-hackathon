// lib/intake/section7.ts
// Pure function — computes the §7 agent-filled rows from the evidence pool
// for the suppliers the buyer ultimately selected.
//
// §7 fields per spec §2: Potential Suppliers, Availability, ETA, Status, Risks, Notes.
// All entries have class: "agent_filled", section: 7, status: "agent_filled".

import type { IntakeField, IntakeForm } from "@/types/intake";
import type { SupplierEvidence } from "@/types/evidence";

export interface Section7Input {
  intake: IntakeForm;
  evidence: SupplierEvidence[];
  selectedSupplierIds: string[];
}

const SECTION_7_FIELD_IDS = {
  potentialSuppliers: "section7.potential_suppliers",
  availability: "section7.availability",
  eta: "section7.eta",
  status: "section7.status",
  risks: "section7.risks",
  notes: "section7.notes",
} as const;

/**
 * Summarise a list of strings into a single, comma-joined value.
 * Returns null when empty so downstream rendering can show "—".
 */
function joinOrNull(values: string[]): string | null {
  const cleaned = values.filter(Boolean);
  return cleaned.length === 0 ? null : cleaned.join(", ");
}

/**
 * Pure: project the evidence pool onto §7 rows.
 *
 * No I/O. Same inputs → same outputs. Suitable for unit tests and SSR.
 */
export function computeSection7(
  intake: IntakeForm,
  evidence: SupplierEvidence[],
  selectedSupplierIds: string[],
): IntakeField[] {
  const selectedSet = new Set(selectedSupplierIds);
  const supplierEvidence = evidence.filter((e) => selectedSet.has(e.supplier_id));

  // Derive supplier names purely from evidence (no I/O / no directory lookup).
  // If no evidence exists for a supplier, fall back to the raw id.
  const supplierNames: string[] = selectedSupplierIds.map((id) => {
    const nameEv = supplierEvidence.find(
      (e) => e.supplier_id === id && e.field_id === "supplier.name" && typeof e.value === "string",
    );
    return nameEv ? (nameEv.value as string) : id;
  });

  // Availability: aggregate any evidence whose field_id targets quantity-like rows.
  const availabilityEvidence = supplierEvidence.filter((e) =>
    e.field_id === "specimen.total_quantity" || e.field_id === "supplier.availability",
  );
  const availabilityValue = availabilityEvidence
    .map((e) => {
      const supplier = e.supplier_id;
      const v = typeof e.value === "string" || typeof e.value === "number" ? String(e.value) : "available";
      return `${supplier}: ${v}`;
    });

  // ETA: prefer any direct supplier.eta evidence.
  const etaEvidence = supplierEvidence.filter((e) => e.field_id === "supplier.eta");
  const etaValue = etaEvidence.map((e) => `${e.supplier_id}: ${String(e.value)}`);

  // Status: derived overall picture.
  let statusValue: string;
  if (selectedSupplierIds.length === 0) {
    statusValue = "Awaiting supplier selection";
  } else if (supplierEvidence.length === 0) {
    statusValue = "Selected, no replies yet";
  } else {
    statusValue = "Confirmed via outreach";
  }

  // Risks: heuristic surfacing — non-US suppliers (§6 risk flag) + commercial-only AMC mismatch.
  const risks: string[] = [];
  const domesticField = intake.fields.find((f) => f.field_id === "shipping.domestic_or_intl");
  const internationalSupplierEv = supplierEvidence.filter(
    (e) => e.field_id === "supplier.country" && e.value !== "US" && e.value !== "USA",
  );
  if (domesticField?.value === "Domestic only" && internationalSupplierEv.length > 0) {
    risks.push("International supplier on a domestic-only request");
  }
  const amcField = intake.fields.find((f) => f.field_id === "supplier.preferred_amc");
  const commercialOnlyEv = supplierEvidence.filter(
    (e) => e.field_id === "supplier.type" && e.value === "commercial",
  );
  if (amcField?.value === "AMC preferred" && commercialOnlyEv.length === selectedSupplierIds.length && selectedSupplierIds.length > 0) {
    risks.push("All selected suppliers are commercial; AMC preference unmet");
  }

  // Notes: free-form aggregation of high-confidence supplier notes.
  const notesEvidence = supplierEvidence.filter(
    (e) => e.field_id === "supplier.notes" && e.confidence === "high",
  );
  const notesValue = notesEvidence.map((e) => `${e.supplier_id}: ${String(e.value)}`);

  const stamp = (
    field_id: string,
    label: string,
    value: string | null,
  ): IntakeField => ({
    field_id,
    section: 7,
    label,
    class: "agent_filled",
    value,
    status: "agent_filled",
  });

  return [
    stamp(SECTION_7_FIELD_IDS.potentialSuppliers, "Potential Suppliers", joinOrNull(supplierNames)),
    stamp(SECTION_7_FIELD_IDS.availability, "Availability", joinOrNull(availabilityValue)),
    stamp(SECTION_7_FIELD_IDS.eta, "ETA", joinOrNull(etaValue)),
    stamp(SECTION_7_FIELD_IDS.status, "Status", statusValue),
    stamp(SECTION_7_FIELD_IDS.risks, "Risks", joinOrNull(risks)),
    stamp(SECTION_7_FIELD_IDS.notes, "Notes", joinOrNull(notesValue)),
  ];
}
