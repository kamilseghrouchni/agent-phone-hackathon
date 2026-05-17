// Hardcoded supplier set for Phase A. Real Browser Use scrape lands in
// Phase C polish if there's time. The 5 real suppliers + the crovi.bio
// meta sentinel mirror the spec § 4 channel matrix.

import type { BiobankOpportunity } from "@/types/biobank";
import type { AgentIdentity } from "@/lib/agents/runtime/slot-resolver";

export const SUPPLIERS: BiobankOpportunity[] = [
  {
    id: "refmed",
    name: "Reference Medicine",
    contact: {
      bd_name: "Sarah",
      email: "hello@referencemedicine.com",
      site_url: "https://referencemedicine.com",
      quote_form_url: "https://www.referencemedicine.com/order",
      calendar_url: "https://calendly.com/referencemedicine",
    },
    reported: {
      conditions: ["NSCLC", "Breast", "CRC", "Prostate", "Pancreatic", "Lung"],
      sample_types: ["FFPE block", "plasma", "serum", "frozen tissue", "buffy coat"],
      public_xlsx_url: "store/inventory/refmed_2026-05.xlsx",
      filterable_catalog_url: "https://airtable.com/embed/refmed-catalog",
    },
    source_evidence: [{ url: "https://referencemedicine.com", scraped_at: "2026-05-15T00:00:00Z", snippet: "RefMed catalog (XLSX, 14k specimens)" }],
    audit_state: "pending",
  },
  {
    id: "geneticist",
    name: "Geneticist",
    contact: {
      bd_name: "Vera",
      email: "Vera@geneticist.net",
      phone: "+18186626927",
      site_url: "https://geneticist.net",
      quote_form_url: "https://geneticist.net/contact",
    },
    reported: {
      conditions: ["NSCLC", "CRC", "lung", "colon"],
      sample_types: ["FFPE block", "plasma", "serum"],
    },
    source_evidence: [{ url: "https://geneticist.net", scraped_at: "2026-05-15T00:00:00Z", snippet: "Geneticist Inc. — biospecimen sourcing" }],
    audit_state: "pending",
  },
  {
    id: "ukraine_biobank",
    name: "Ukraine Biobank",
    contact: {
      bd_name: "Dr. Gramatyuk",
      email: "gramatyuk@ukrainebiobank.com",
      phone: "+43000000000",
      site_url: "https://ukrainebiobank.com",
      quote_form_url: "https://ukrainebiobank.com/contact",
    },
    reported: {
      conditions: ["NSCLC", "lung", "breast", "cancer"],
      sample_types: ["FFPE block", "frozen tissue", "plasma"],
    },
    source_evidence: [{ url: "https://ukrainebiobank.com", scraped_at: "2026-05-15T00:00:00Z", snippet: "Ukraine Biobank tissue archive" }],
    audit_state: "pending",
  },
  {
    id: "audubon",
    name: "Audubon Bioscience",
    contact: {
      bd_name: "Audubon BD",
      email: "info@audubonbio.com",
      phone: "+17137240338",
      site_url: "https://audubonbio.com",
      quote_form_url: "https://audubonbio.com/quote-request",
    },
    reported: {
      conditions: ["NSCLC", "lung", "cancer", "tumor"],
      sample_types: ["FFPE block", "plasma", "frozen tissue"],
    },
    source_evidence: [{ url: "https://audubonbio.com", scraped_at: "2026-05-15T00:00:00Z", snippet: "Audubon — global biospecimen procurement" }],
    audit_state: "pending",
  },
  {
    id: "biomedica",
    name: "Biomedica CRO",
    contact: {
      bd_name: "Biomedica BD",
      email: "office@biomedica-cro.com",
      phone: "+380000000000",
      site_url: "https://biomedica-cro.com",
    },
    reported: {
      conditions: ["NSCLC", "tumor", "cancer"],
      sample_types: ["FFPE block", "frozen tissue"],
    },
    source_evidence: [{ url: "https://biomedica-cro.com", scraped_at: "2026-05-15T00:00:00Z", snippet: "Biomedica CRO — taxonomy gated" }],
    audit_state: "pending",
  },
  {
    id: "crovi_bio",
    name: "Crovi.bio",
    contact: {
      bd_name: "Crovi Agent",
      email: "agents@crovi.bio",
      site_url: "https://crovi.bio",
      quote_form_url: "https://crovi.bio/waitlist",
      calendar_url: "https://calendar.notion.so/meet/kamilseghrouchni/fk7kv4pyk",
    },
    reported: {
      conditions: ["all"],
      sample_types: ["all"],
    },
    source_evidence: [{ url: "https://crovi.bio", scraped_at: "2026-05-15T00:00:00Z", snippet: "vCRO discovery layer (meta)" }],
    audit_state: "pending",
    meta_flag: "discovery_layer",
  },
];

export function getSupplier(id: string): BiobankOpportunity | undefined {
  return SUPPLIERS.find((s) => s.id === id);
}

export const DEFAULT_AGENT_IDENTITY: AgentIdentity = {
  name: "Alex Carter",
  email: process.env.AGENTMAIL_INBOX_ADDRESS ?? "agents@crovi.bio",
  phone: process.env.DEMO_CALL_TARGET_PHONE ?? "+15555550100",
  company: "Crovi BD",
  country: "USA",
};
