import fs from "node:fs";
import path from "node:path";

export type Person = { name: string; role: string; email: string };
export type GateStatus = "pass" | "partial" | "open" | "fail";
export type Gate = { label: string; status: GateStatus; evidence: string };
export type QuoteLine = {
  label: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
};
export type ProviderQuote = {
  currency: string;
  negotiated_on: string;
  valid_until: string;
  lines: QuoteLine[];
  subtotal: number;
  responsibilities: string[];
};
export type ProviderTimelineStep = { milestone: string; date: string; owner: string };
export type Provider = {
  id: string;
  kind: string;
  name: string;
  org: string;
  country: string;
  people: Person[];
  quote: ProviderQuote;
  timeline: ProviderTimelineStep[];
};

export type Opportunity = {
  id: string;
  status: string;
  title: string;
  indication: string;
  program: string;
  path_chosen: { code: string; label: string; rationale: string };
  sponsor: { org: string; people: Person[] };
  coordinator: { org: string; people: Person[] };
  specimens_summary: {
    headline: string;
    report_path: string;
    totals: {
      donors_total: number;
      donors_multivisit: number;
      specimens_total: number;
      specimens_recent_2020plus: number;
    };
    type_mix_recent: { type: string; n: number }[];
    gates: Gate[];
  };
  assays_summary: {
    headline: string;
    report_path: string;
    platform: string;
    scope: string;
    deliverables: string[];
    gates: Gate[];
  };
  providers: Provider[];
  totals: {
    biobank_subtotal: number;
    assay_subtotal: number;
    coordinator_fee: number;
    grand_total: number;
    currency: string;
    estimated_kickoff: string;
    estimated_data_delivery: string;
  };
  contract: {
    title: string;
    version: string;
    parties: { role: string; entity: string; signatory: string }[];
    term: string;
    scope_of_work: string[];
    responsibilities: { party: string; items: string[] }[];
    ip_and_data: string[];
    payment_terms: string;
    data_retention: string;
    confidentiality: string;
    governing_law: string;
    open_items: string[];
  };
  email: {
    thread_id: string;
    from: { name: string; email: string };
    to: { name: string; email: string };
    cc?: { name: string; email: string }[];
    date: string;
    subject: string;
    body_paragraphs: string[];
    signoff: string[];
    attachments: { name: string; size: string; kind: string; path: string }[];
  };
};

export function loadOpportunity(id: string): Opportunity | null {
  const p = path.join(process.cwd(), "data", "opportunities", `${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Opportunity;
}

export const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
