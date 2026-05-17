// types/evidence.ts — SupplierEvidence pool (spec §3, verbatim)

export type Channel =
  | "browse"
  | "email"
  | "sms"
  | "call"
  | "form"
  | "calendar"
  | "inventory_file"
  | "pay";

export interface SupplierEvidence {
  supplier_id: string;
  field_id: string;
  value: unknown;
  channel: Channel;
  evidence_id: string;          // pointer to source record (msg id, call id, scrape id)
  quote?: string;               // verbatim snippet
  confidence: "low" | "medium" | "high";
  timestamp: string;
}
