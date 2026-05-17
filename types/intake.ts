// types/intake.ts — IntakeForm schema (spec §3, verbatim base)
//
// Source of truth for the 35-field intake form. Status flips as evidence lands.

import type { Channel } from "./evidence";

export type FieldStatus = "frozen" | "empty" | "confirmed" | "updated" | "agent_filled";

export interface IntakeField {
  field_id: string;             // e.g. "specimen.format"
  section: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  label: string;
  class: "frozen" | "confirmable" | "updatable" | "agent_filled";
  value: unknown;               // buyer's value (or null for §7/§8 until filled)
  status: FieldStatus;
  provenance?: { supplier_id: string; channel: Channel; evidence_id: string; quote?: string };
}

export interface IntakeForm {
  run_id: string;
  source: { type: "pdf" | "text"; filename?: string; hash?: string };
  buyer: { company: string; contact: string; email: string; phone: string };
  fields: IntakeField[];        // 35 entries
}
