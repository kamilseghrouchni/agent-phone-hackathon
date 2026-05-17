// Inline fixture for FilledIntake rendering — used only by the demo + local testing.
// Mirrors the 35-field categorization. Values are hand-authored; provenance
// references mock evidence_ids that match anchors used in the chain timeline ("stage-2-event-7" etc.).

import type { IntakeForm, IntakeField } from "@/types/intake";
import type { SupplierEvidence } from "@/types/evidence";
import type { ChainState } from "@/types/chain";

// Module-load epoch + offset helper: keeps fixture timestamps stable across
// renders within a single run without hardcoding a calendar date.
const FX_BASE = Date.now();
const fxTs = (ms: number): string => new Date(FX_BASE + ms).toISOString();

// 25 base fields from §1-§6 (frozen / confirmable / updatable).
const baseFields: IntakeField[] = [
  // §1 Frozen identity
  { field_id: "buyer.company", section: 1, label: "Company", class: "frozen", value: "NovaCure Therapeutics", status: "frozen" },
  { field_id: "buyer.contact", section: 1, label: "Contact", class: "frozen", value: "Dr. Lena Park", status: "frozen" },
  { field_id: "buyer.title", section: 1, label: "Title", class: "frozen", value: "Director, Translational Research", status: "frozen" },
  { field_id: "buyer.email", section: 1, label: "Email", class: "frozen", value: "lpark@novacure.bio", status: "frozen" },
  { field_id: "buyer.phone", section: 1, label: "Phone", class: "frozen", value: "+1 415 555 0142", status: "frozen" },
  { field_id: "study.name", section: 1, label: "Study Name", class: "frozen", value: "NSCLC Liquid Biopsy Validation Study", status: "frozen" },
  { field_id: "study.timeline", section: 1, label: "Requested Timeline", class: "frozen", value: "6–8 weeks (annotated: supplier ETA 5 weeks)", status: "frozen" },

  // §2
  { field_id: "study.purpose", section: 2, label: "Purpose of Request", class: "frozen", value: "Analytical + clinical validation of ctDNA assay", status: "frozen" },
  { field_id: "study.therapeutic_area", section: 2, label: "Therapeutic Area", class: "frozen", value: "NSCLC", status: "frozen" },
  {
    field_id: "compliance.irb",
    section: 2,
    label: "IRB / Ethics Status",
    class: "confirmable",
    value: "Central IRB approved",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-5", quote: "We work under a central IRB with broad-research consent on file." },
  },
  {
    field_id: "compliance.consent",
    section: 2,
    label: "Patient Consent Requirements",
    class: "confirmable",
    value: "Broad-research consent",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-5", quote: "Broad-research consent applies to all enrolled donors." },
  },
  {
    field_id: "compliance.cap_clia",
    section: 2,
    label: "Special Regulatory (CAP/CLIA)",
    class: "confirmable",
    value: "CAP + CLIA certified",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "email", evidence_id: "stage-3-event-2", quote: "CAP/CLIA certified lab — happy to share certificates." },
  },

  // §3
  {
    field_id: "specimen.types",
    section: 3,
    label: "Specimen Type(s) Requested",
    class: "updatable",
    value: "Plasma + FFPE blocks (slides optional)",
    status: "updated",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6", quote: "We can offer plasma plus FFPE blocks; slide sets available on request." },
  },
  { field_id: "specimen.diagnosis", section: 3, label: "Diagnosis", class: "frozen", value: "Stage III–IV NSCLC", status: "frozen" },
  {
    field_id: "specimen.total_quantity",
    section: 3,
    label: "Total Quantity",
    class: "confirmable",
    value: "150 plasma + 75 FFPE",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6", quote: "150 plasma and 75 matched FFPE — confirmed availability." },
  },
  {
    field_id: "specimen.timepoints",
    section: 3,
    label: "Collection Timepoints",
    class: "confirmable",
    value: "Pre-treatment baseline",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6", quote: "All baseline pre-treatment, matched to FFPE collection." },
  },
  {
    field_id: "specimen.format",
    section: 3,
    label: "Sample Format",
    class: "updatable",
    value: "Frozen plasma + FFPE blocks",
    status: "updated",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6", quote: "Plasma frozen at −80°C; FFPE blocks shipped ambient." },
  },
  {
    field_id: "specimen.min_volume",
    section: 3,
    label: "Minimum Volume",
    class: "confirmable",
    value: "≥2 mL plasma",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6", quote: "Minimum 2 mL plasma per draw — most donors yield 4–6 mL." },
  },
  {
    field_id: "specimen.aliquots",
    section: 3,
    label: "Aliquot Requirements",
    class: "updatable",
    value: "2 aliquots per donor",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6" },
  },
  {
    field_id: "specimen.matched_normal",
    section: 3,
    label: "Matched Normal Required",
    class: "confirmable",
    value: "Yes",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6" },
  },
  { field_id: "specimen.longitudinal", section: 3, label: "Longitudinal Required", class: "frozen", value: "No", status: "frozen" },

  // §4
  {
    field_id: "cohort.age_range",
    section: 4,
    label: "Age Range",
    class: "confirmable",
    value: "40–80",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6" },
  },
  { field_id: "cohort.gender", section: 4, label: "Gender", class: "frozen", value: "No preference", status: "frozen" },
  {
    field_id: "cohort.ethnicity",
    section: 4,
    label: "Ethnicity",
    class: "confirmable",
    value: "Diverse cohort",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-6" },
  },
  { field_id: "cohort.disease_stage", section: 4, label: "Disease Stage", class: "frozen", value: "Advanced / metastatic", status: "frozen" },
  {
    field_id: "cohort.treatment_history",
    section: 4,
    label: "Treatment History",
    class: "confirmable",
    value: "Treatment-naive subset (~62%)",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-7", quote: "About 62% of our Stage III-IV pool are treatment-naive at draw." },
  },
  {
    field_id: "cohort.inclusion",
    section: 4,
    label: "Inclusion",
    class: "confirmable",
    value: "NSCLC + path report",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-7" },
  },
  {
    field_id: "cohort.exclusion",
    section: 4,
    label: "Exclusion",
    class: "confirmable",
    value: "Prior immunotherapy excluded",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-7" },
  },
  {
    field_id: "cohort.biomarker",
    section: 4,
    label: "Biomarker Distribution",
    class: "updatable",
    value: "EGFR+ ~12% · KRAS+ ~28% · ALK ~5%",
    status: "updated",
    provenance: {
      supplier_id: "crovi_bio",
      channel: "call",
      evidence_id: "stage-2-event-7",
      quote: "About 12% of our naive cases are EGFR+, 28% KRAS+, ~5% ALK rearrangements.",
    },
  },

  // §5
  {
    field_id: "data.path_reports",
    section: 5,
    label: "Pathology Reports Required",
    class: "confirmable",
    value: "Yes — de-identified",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-8" },
  },
  {
    field_id: "data.emr",
    section: 5,
    label: "EMR / Clinical Data",
    class: "confirmable",
    value: "De-identified clinical history",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-8" },
  },
  {
    field_id: "data.genomic",
    section: 5,
    label: "Genomic / Molecular Data",
    class: "updatable",
    value: "Targeted NGS panel results on file",
    status: "updated",
    provenance: { supplier_id: "crovi_bio", channel: "call", evidence_id: "stage-2-event-8" },
  },
  { field_id: "data.deid", section: 5, label: "De-identified or Coded", class: "frozen", value: "De-identified", status: "frozen" },
  {
    field_id: "data.sops",
    section: 5,
    label: "Additional Docs (SOPs)",
    class: "confirmable",
    value: "Available on request",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "email", evidence_id: "stage-3-event-2" },
  },

  // §6
  {
    field_id: "shipping.schedule",
    section: 6,
    label: "Preferred Shipping Schedule",
    class: "updatable",
    value: "Weekly batches",
    status: "updated",
    provenance: { supplier_id: "crovi_bio", channel: "email", evidence_id: "stage-3-event-2" },
  },
  {
    field_id: "shipping.temperature",
    section: 6,
    label: "Temperature Requirements",
    class: "confirmable",
    value: "−80°C plasma, ambient FFPE",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "email", evidence_id: "stage-3-event-2" },
  },
  { field_id: "shipping.domestic_or_intl", section: 6, label: "Domestic or International", class: "frozen", value: "Domestic only", status: "frozen" },
  {
    field_id: "shipping.packaging",
    section: 6,
    label: "Packaging (IATA)",
    class: "confirmable",
    value: "IATA-compliant courier",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "email", evidence_id: "stage-3-event-2" },
  },
  {
    field_id: "supplier.preferred_amc",
    section: 6,
    label: "Preferred Supplier (AMC)",
    class: "confirmable",
    value: "Mixed AMC + commercial",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "email", evidence_id: "stage-3-event-2" },
  },
  {
    field_id: "shipping.special_handling",
    section: 6,
    label: "Special Handling",
    class: "confirmable",
    value: "Avoid freeze-thaw cycles",
    status: "confirmed",
    provenance: { supplier_id: "crovi_bio", channel: "email", evidence_id: "stage-3-event-2" },
  },
];

export const fixtureIntake: IntakeForm = {
  run_id: "demo-run-001",
  source: { type: "pdf", filename: "Sample_Completed_Biospecimen_Request.pdf", hash: "sha256-novacure-nsclc-fixture" },
  buyer: { company: "NovaCure Therapeutics", contact: "Dr. Lena Park", email: "lpark@novacure.bio", phone: "+1 415 555 0142" },
  fields: baseFields,
};

export const fixtureEvidence: SupplierEvidence[] = [
  {
    supplier_id: "crovi_bio",
    field_id: "supplier.name",
    value: "Crovi.bio",
    channel: "browse",
    evidence_id: "directory-1",
    confidence: "high",
    timestamp: fxTs(0),
  },
  {
    supplier_id: "crovi_bio",
    field_id: "supplier.eta",
    value: "5 weeks",
    channel: "call",
    evidence_id: "stage-2-event-9",
    confidence: "high",
    timestamp: fxTs(300_000),
  },
  {
    supplier_id: "crovi_bio",
    field_id: "supplier.notes",
    value: "Open to weekly batch shipments; CAP/CLIA documentation included",
    channel: "email",
    evidence_id: "stage-3-event-2",
    confidence: "high",
    timestamp: fxTs(480_000),
  },
];

export const fixtureChain: ChainState = {
  run_id: "demo-run-001",
  supplier_id: "crovi_bio",
  stages: {
    form: { status: "complete", events: [{ event_id: "stage-1-event-1", timestamp: fxTs(25_000), direction: "inbound", actor: "supplier", channel: "form", text: "Added to waitlist — capacity verification required." }] },
    call: { status: "complete", events: [
      { event_id: "stage-2-event-5", timestamp: fxTs(150_000), direction: "inbound", actor: "supplier", channel: "call", text: "Central IRB with broad-research consent." },
      { event_id: "stage-2-event-6", timestamp: fxTs(180_000), direction: "inbound", actor: "supplier", channel: "call", text: "150 plasma + 75 FFPE confirmed." },
      { event_id: "stage-2-event-7", timestamp: fxTs(210_000), direction: "inbound", actor: "supplier", channel: "call", text: "EGFR ~12%, KRAS ~28%, ALK ~5%." },
      { event_id: "stage-2-event-8", timestamp: fxTs(240_000), direction: "inbound", actor: "supplier", channel: "call", text: "De-id path reports + clinical history available." },
      { event_id: "stage-2-event-9", timestamp: fxTs(270_000), direction: "inbound", actor: "supplier", channel: "call", text: "5 weeks to first shipment." },
    ] },
    email: { status: "complete", events: [
      { event_id: "stage-3-event-2", timestamp: fxTs(480_000), direction: "inbound", actor: "supplier", channel: "email", text: "I agree. CAP/CLIA certs attached." },
    ] },
    sms_pay: { status: "complete", events: [
      { event_id: "stage-4-event-3", timestamp: fxTs(600_000), direction: "inbound", actor: "buyer", channel: "sms", text: "CONFIRMED — legally binding" },
      { event_id: "stage-4-event-4", timestamp: fxTs(605_000), direction: "system", actor: "sponge", channel: "pay", text: "Transfer settled — $10.00" },
    ] },
    meeting: { status: "complete", events: [
      { event_id: "stage-5-event-1", timestamp: fxTs(720_000), direction: "system", actor: "cal", channel: "calendar", text: "Tue 10:00 AM — Crovi.bio × NovaCure logistics review" },
    ] },
  },
  evidence_added: ["stage-2-event-5", "stage-2-event-6", "stage-2-event-7", "stage-2-event-8", "stage-2-event-9", "stage-3-event-2", "stage-4-event-4", "stage-5-event-1"],
};
