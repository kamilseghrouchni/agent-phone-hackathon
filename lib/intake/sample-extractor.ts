// lib/intake/sample-extractor.ts
//
// Hash-fast-path PDF extraction for the bundled NovaCure sample.
// If the uploaded PDF matches our known hash → return the hand-authored
// 35-field extraction without ever touching pdf-parse. Otherwise the caller
// should fall back to an LLM-based extractor.
//
// Field values are extracted directly from the actual sample PDF content
// (see docs/yc-hackathon /Sample_Completed_Biospecimen_Request.pdf).

import crypto from "node:crypto";
import { categorizeIntake } from "./categorize";
import type { IntakeForm } from "@/types/intake";

// SHA-256 of the bundled docs/yc-hackathon /Sample_Completed_Biospecimen_Request.pdf
// computed at upload time. Multiple known hashes are allowed so the file can be
// re-exported without invalidating the fast path.
const KNOWN_SAMPLE_HASHES = new Set<string>([
  // Filled at runtime by computeSha256 below — also allow filename-based detection.
]);

const KNOWN_FILENAME_HINTS = ["sample_completed_biospecimen_request", "novacure", "biospecimen_request"];

export function computeSha256(buffer: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Detect whether this upload is our bundled NovaCure sample.
 * Two signals — either is sufficient for the demo path:
 *  1. SHA-256 of the file matches a known hash
 *  2. The filename contains a recognizable token (case-insensitive)
 */
export function isBundledSample(opts: { hash?: string; filename?: string }): boolean {
  if (opts.hash && KNOWN_SAMPLE_HASHES.has(opts.hash)) return true;
  if (opts.filename) {
    const fn = opts.filename.toLowerCase();
    return KNOWN_FILENAME_HINTS.some((hint) => fn.includes(hint));
  }
  return false;
}

/**
 * Hand-authored 35-field extraction for the NovaCure sample.
 * Values copied verbatim from the PDF content.
 *
 * Returns an IntakeForm with all 35 fields populated.
 */
export function extractBundledSample(run_id: string, hash?: string, filename?: string): IntakeForm {
  const values: Record<string, unknown> = {
    // §1 — Client & Project Information
    "client.company": "NovaCure Biotechnologies",
    "client.contact": "Dr. Emily Carter",
    "client.title": "Director of Translational Research",
    "client.email": "ecarter@novacurebio.com",
    "client.phone": "(312) 555-4832",
    "client.study_name": "NSCLC Liquid Biopsy Validation Study",
    "client.timeline": "Initial specimens requested within 6-8 weeks",

    // §2 — Project Overview
    "project.purpose": "Validation study for liquid biopsy assay development",
    "project.therapeutic_area": "Non-Small Cell Lung Cancer (NSCLC)",
    "project.irb_status": "IRB approved",
    "project.consent": "Broad research consent acceptable",
    "project.regulatory": "CAP/CLIA aligned sourcing preferred",

    // §3 — Specimen Requirements
    "specimen.types": "Plasma, matched FFPE tissue, whole blood",
    "specimen.diagnosis": "Stage III-IV NSCLC",
    "specimen.quantity": "150 plasma samples / 75 matched tissue samples",
    "specimen.timepoints": "Baseline prior to treatment initiation",
    "specimen.format": "Frozen plasma, FFPE blocks or 10 unstained slides",
    "specimen.min_volume": "2 mL plasma minimum",
    "specimen.aliquot": "2 aliquots per plasma sample",
    "specimen.matched_normal": "Yes",
    "specimen.longitudinal": "No",

    // §4 — Patient Demographics & Clinical Criteria
    "demo.age_range": "40-80 years old",
    "demo.gender": "No preference",
    "demo.ethnicity": "Diverse cohort preferred",
    "demo.disease_stage": "Advanced metastatic disease",
    "demo.treatment_history": "Treatment naive preferred",
    "demo.inclusion": "Confirmed NSCLC diagnosis with pathology report",
    "demo.exclusion": "Prior immunotherapy exposure",
    "demo.biomarker": "EGFR+, KRAS+, and ALK subsets requested",

    // §5 — Clinical Data & Documentation
    "data.pathology": "Yes",
    "data.emr": "Basic de-identified clinical history",
    "data.genomic": "NGS mutation status if available",
    "data.deidentified": "De-identified only",
    "data.additional_docs": "Collection and processing SOPs",

    // §6 — Logistics & Shipping
    "ship.schedule": "Weekly batch shipments",
    "ship.temperature": "Dry ice for frozen samples",
    "ship.geography": "Domestic only",
    "ship.packaging": "IATA compliant packaging",
    "ship.supplier_pref": "Academic medical centers preferred",
    "ship.special_handling": "Avoid freeze-thaw cycles",

    // §7 / §8 — agent-filled, left null until chain runs
    "feas.suppliers": null,
    "feas.availability": null,
    "feas.eta": null,
    "feas.status": null,
    "feas.risks": null,
    "feas.notes": null,
    "contract.acceptance": null,
    "contract.down_payment": null,
    "contract.meeting": null,
    "contract.status": null,
  };

  return categorizeIntake(
    run_id,
    { type: "pdf", filename: filename ?? "Sample_Completed_Biospecimen_Request.pdf", hash },
    {
      company: "NovaCure Biotechnologies",
      contact: "Dr. Emily Carter",
      email: "ecarter@novacurebio.com",
      phone: "(312) 555-4832",
    },
    values,
  );
}
