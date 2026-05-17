// Entity model — spec § 3.1.
//
// BiobankOpportunity is the shallow row we get from sourcing (scraped from
// the public web). DataOpportunity is added when an audit succeeds OR a
// public catalog (RefMed XLSX) gives us listings deterministically.

export type AuditState =
  | "pending"
  | "in_progress"
  | "responded"
  | "confirmed"
  | "rejected"
  | "failed";

export type Channel = "browse" | "call" | "email" | "sms" | "form" | "calendar" | "inventory_file";

export interface SourceEvidence {
  url: string;
  scraped_at: string; // ISO timestamp
  snippet: string;
}

export interface BiobankContact {
  bd_name?: string;
  email?: string;
  phone?: string;
  site_url: string;
  quote_form_url?: string;
  calendar_url?: string;
}

export interface BiobankReported {
  conditions: string[];
  sample_types: string[];
  filterable_catalog_url?: string;
  public_xlsx_url?: string;
}

export interface BiobankOpportunity {
  id: string;
  name: string;
  contact: BiobankContact;
  reported: BiobankReported;
  source_evidence: SourceEvidence[];
  audit_state: AuditState;
  meta_flag?: "discovery_layer"; // crovi.bio sentinel
}

export interface SpecimenLine {
  type: string; // "plasma" | "FFPE block" | "frozen tissue" | ...
  n?: number;
  n_range?: [number, number];
  volume_mL?: number;
}

export interface Listing {
  case_id?: string;
  donor_id?: string;
  diagnosis: string;
  tumor_site?: string;
  stage?: string;
  treatment_status?: string;
  specimens: SpecimenLine[];
  biomarkers?: string[];
  source: {
    channel: Channel;
    evidence_id: string; // pointer to ActionReasoningLog id OR catalog row id
  };
}

export interface DataOpportunityMeta {
  quote_per_case_usd?: number;
  turnaround_weeks?: number;
  quality_grade?: string;
  collection_protocol_notes?: string;
  quote_source?: {
    channel: Channel;
    evidence_id: string;
  };
}

export interface DataOpportunity {
  biobank_id: string;
  brief_description: string;
  listings: Listing[];
  meta?: DataOpportunityMeta;
}
