// Demo seed: turn the 6 hardcoded commercial CROs (lib/data/suppliers.ts)
// into the workspace's `InstituteEntry[]` shape so they appear on the
// /workspace rail as if they came from the specimens.db query.
//
// Active when:
//   - process.env.DEMO_MODE === "true" (env-level), OR
//   - explicit ?demo=1 on the request (per-request override)
//
// M7 will replace RefMed's stubbed counts with real XLSX-driven listings.

import { SUPPLIERS } from "@/lib/data/suppliers";
import type { BiobankOpportunity } from "@/types/biobank";
import type {
  QuerySpecimensResult,
  InstituteEntry,
  SpecimenRow,
} from "@/lib/tools/query_specimens";
import type { SpecimenFilters } from "@/lib/filters";
import type { ExtractedFields } from "@/lib/integrations/browser-use";

const COUNTRY_BY_ID: Record<string, string> = {
  refmed: "USA",
  geneticist: "USA",
  ukraine_biobank: "Ukraine",
  audubon: "USA",
  biomedica: "Ukraine",
  crovi_bio: "USA",
};

const FLAG_BY_COUNTRY: Record<string, string> = {
  USA: "🇺🇸",
  Ukraine: "🇺🇦",
};

// Plausible inventory ceilings. RefMed is real (14,637 specimens in the May
// XLSX); the rest are educated guesses for the demo narrative.
const SPECIMEN_CEILING_BY_ID: Record<string, number> = {
  refmed: 14637,
  geneticist: 412,
  ukraine_biobank: 1180,
  audubon: 689,
  biomedica: 530,
  crovi_bio: 0, // meta — no inventory
};

const DESCRIPTION_BY_ID: Record<string, string> = {
  refmed:
    "U.S. commercial biospecimen supplier. Cancer-focused inventory across NSCLC, breast, CRC, prostate, pancreatic. Public XLSX catalog refreshed monthly + Airtable embed.",
  geneticist:
    "Boutique sourcing house out of Los Angeles. Long-tail oncology cases — NSCLC and CRC core competencies. Prose-driven catalog, deep BD relationship model.",
  ukraine_biobank:
    "Ukraine Biobank Association — multi-site tissue archive aggregating 12+ Ukrainian hospitals. Strong on FFPE blocks and recent oncology cohorts.",
  audubon:
    "Global biospecimen procurement, headquartered in Houston. NSCLC and broader oncology, with reach into international sites. Multi-form intake portal.",
  biomedica:
    "Biomedica CRO (Ukraine). Gated taxonomy — full inventory unlocks on request. Strong on FFPE oncology blocks; reCAPTCHA-gated portal.",
  crovi_bio:
    "Crovi.bio — the discovery layer itself. Surfaced as a candidate because it IS the layer that surfaced the others. Recursive sentinel for the demo.",
};

function inferIndication(filters: SpecimenFilters): string[] {
  const ind = (filters.indication ?? []).map((s) => s.toLowerCase());
  if (ind.length === 0 && filters.free_text) {
    const lc = filters.free_text.toLowerCase();
    const out: string[] = [];
    for (const tag of ["nsclc", "lung", "breast", "crc", "colorectal", "prostate", "pancreatic", "melanoma", "lymphoma", "myeloma"]) {
      if (lc.includes(tag)) out.push(tag);
    }
    return out;
  }
  return ind;
}

function overlapScore(supplierConditions: string[], userIndications: string[]): number {
  if (userIndications.length === 0) return 0.5; // neutral
  const condsLc = supplierConditions.map((s) => s.toLowerCase());
  let hits = 0;
  for (const u of userIndications) {
    if (condsLc.some((c) => c === u || c.includes(u) || u.includes(c))) hits++;
  }
  return hits / userIndications.length;
}

function specimenTypeCount(
  ceiling: number,
  supplierTypes: string[],
  userTypes: string[],
): Record<string, number> {
  // If user asked for specific specimen types we have, weight those.
  // Otherwise spread evenly across what supplier reports.
  const out: Record<string, number> = {};
  const sup = supplierTypes.map((s) => s.toLowerCase());
  const usr = (userTypes ?? []).map((s) => s.toLowerCase());
  const intersection = sup.filter((s) => usr.length === 0 || usr.includes(s));
  const pool = intersection.length > 0 ? intersection : sup;
  // Distribute the ceiling across pool with a long-tail bias.
  const weights = pool.map((_, i) => Math.pow(0.6, i));
  const sumW = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    out[supplierTypes[i] ?? pool[i]] = Math.round((weights[i] / sumW) * ceiling);
  }
  return out;
}

function supplierToInstitute(
  s: BiobankOpportunity,
  filters: SpecimenFilters,
  indications: string[],
): InstituteEntry {
  const ceiling = SPECIMEN_CEILING_BY_ID[s.id] ?? 200;
  const overlap = overlapScore(s.reported.conditions, indications);
  const specimen_count = Math.round(ceiling * Math.max(0.3, overlap)); // never zero on a demo
  const country = COUNTRY_BY_ID[s.id] ?? "—";
  const by_specimen_type = specimenTypeCount(specimen_count, s.reported.sample_types, filters.specimen_types ?? []);
  const isMeta = s.meta_flag === "discovery_layer";
  return {
    organization_id: s.id,
    name: s.name,
    country: isMeta ? null : country,
    flag: isMeta ? "◆" : FLAG_BY_COUNTRY[country] ?? "",
    contact_email: s.contact.email ?? null,
    website: s.contact.site_url ?? null,
    description: DESCRIPTION_BY_ID[s.id] ?? s.source_evidence[0]?.snippet ?? null,
    in_profiles: true,
    match_score: isMeta ? 0.01 : Math.max(0.1, overlap), // meta always last
    specimen_count: isMeta ? 0 : specimen_count,
    donor_count: isMeta ? 0 : Math.round(specimen_count / 3.2),
    longitudinal_donor_count: 0, // commercial CROs aren't longitudinal banks
    matched_pair_donor_count: 0,
    by_specimen_type,
    sample_rows: [] as SpecimenRow[], // M7 fills RefMed; others stay empty
  };
}

export function isDemoModeActive(): boolean {
  return process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1";
}

// ───────────────────────────────────────────────────────────────────────────
// V1 Enrichment cards — spec § 4 Beat 3.
//
// Exactly four cards on the Enrich phase: 3 real Browser Use scrape targets
// (refmed, geneticist, audubon) + crovi.bio from internal directory.
//
// NOTE on stripping (post-`make agents feel LIVE`):
//   `claimed` (conditions, sample types, contact) remains here because the
//   right-pane Supplier Detail view + /api/suppliers/[supplierId] depend on
//   it. What was stripped is the EAGER RENDERING of those values on the
//   supplier cards themselves — see components/Enrich/SupplierCardsGrid.tsx
//   for the empty-state rendering pattern. Cards now wait for the live
//   scrape's `extracted` fields to populate, and the conviction tier is
//   derived from how many of the 8 fields the agent has pulled (see
//   computeConvictionFromEvidence in lib/agents/enrich.ts).
// ───────────────────────────────────────────────────────────────────────────

export type ConvictionTier = "high_match" | "worth_pursuing" | "long_shot";

export interface DemoSupplierCardSeed {
  supplier_id: "refmed" | "geneticist" | "audubon" | "crovi_bio";
  name: string;
  flag: string;
  country: string;
  enrichment_mode: "browse" | "browse+xlsx" | "directory";
  /** URL handed to the Browser Use task (for the 3 real scrapes). */
  scrape_target?: string;
  /**
   * Static claimed metadata. NOT rendered eagerly on the supplier card — that
   * would defeat the "agents doing the work" demo. Lives here purely to feed
   * the right-pane SupplierDetail view + the read-only /api/suppliers route.
   */
  claimed: {
    conditions: string[];
    sample_types: string[];
    contact?: { email?: string; phone?: string; form_url?: string };
  };
  /** 1-line description shown in the card body. */
  blurb: string;
}

export const V1_DEMO_SUPPLIERS: DemoSupplierCardSeed[] = [
  {
    supplier_id: "refmed",
    name: "Reference Medicine",
    flag: "🇺🇸",
    country: "USA",
    enrichment_mode: "browse+xlsx",
    scrape_target: "https://referencemedicine.com",
    claimed: {
      conditions: ["NSCLC", "Breast", "CRC", "Prostate", "Pancreatic", "Lung"],
      sample_types: ["FFPE block", "plasma", "serum", "frozen tissue", "buffy coat"],
      contact: { email: "hello@referencemedicine.com" },
    },
    blurb:
      "U.S. commercial supplier. Public XLSX catalog refreshed monthly + Airtable embed.",
  },
  {
    supplier_id: "geneticist",
    name: "Geneticist Inc",
    flag: "🇺🇸",
    country: "USA",
    enrichment_mode: "browse",
    scrape_target: "https://geneticistinc.com/",
    claimed: {
      conditions: ["NSCLC", "CRC", "lung", "colon"],
      sample_types: ["FFPE block", "plasma", "serum"],
      contact: { email: "Vera@geneticist.net", phone: "+18186626927" },
    },
    blurb:
      "Boutique sourcing house. Long-tail oncology — NSCLC and CRC core competencies.",
  },
  {
    supplier_id: "audubon",
    name: "Audubon Bioscience",
    flag: "🇺🇸",
    country: "USA",
    enrichment_mode: "browse",
    scrape_target: "https://audubonbio.com/",
    claimed: {
      conditions: ["NSCLC", "lung", "cancer", "tumor"],
      sample_types: ["FFPE block", "plasma", "frozen tissue"],
      contact: { email: "info@audubonbio.com", phone: "+17137240338" },
    },
    blurb:
      "Global biospecimen procurement out of Houston. Multi-form intake portal.",
  },
  {
    supplier_id: "crovi_bio",
    name: "Crovi.bio",
    flag: "🌐",
    country: "—",
    enrichment_mode: "browse",
    scrape_target: "https://crovi.bio/",
    claimed: {
      conditions: ["all"],
      sample_types: ["all"],
      contact: { email: "agents@crovi.bio", form_url: "https://crovi.bio/agent-launched" },
    },
    blurb: "Discovery layer. Direct contact + waitlist form.",
  },
];

/** Lookup a V1 seed by id. */
export function getV1Supplier(
  id: string,
): DemoSupplierCardSeed | undefined {
  return V1_DEMO_SUPPLIERS.find((s) => s.supplier_id === id);
}

/**
 * Evidence-derived conviction tier — spec § 4 Beat 3.
 *
 * Counts the non-empty fields on `ExtractedFields`. The 8 demo fields
 * (contact_email, contact_phone, contact_bd_name, claimed_conditions,
 * sample_types, public_catalog_url, geography, intake_form_url) plus the
 * RefMed `inventory_loaded` beat are all eligible signals.
 *
 *   ≥ 6 filled  → high_match
 *   3 – 5       → worth_pursuing
 *   ≤ 2        → long_shot
 *
 * Returns `tier: null` if zero fields are filled — the card stays blank
 * in that window so the audience sees the chip LAND mid-scrape rather
 * than appear pre-populated on mount.
 *
 * Lives here (rather than in lib/agents/enrich.ts) because the supplier
 * cards are a client component, and enrich.ts pulls server-only deps
 * (playwright, fs). Sharing it from a type-only module keeps Webpack
 * happy on the client bundle.
 */
export function computeConvictionFromEvidence(
  evidence: ExtractedFields | null | undefined,
): { tier: ConvictionTier | null; reason: string; filled: number } {
  if (!evidence) return { tier: null, reason: "", filled: 0 };
  let filled = 0;
  const keys: Array<keyof ExtractedFields> = [
    "contact_email",
    "contact_phone",
    "contact_bd_name",
    "claimed_conditions",
    "sample_types",
    "public_catalog_url",
    "geography",
    "intake_form_url",
    "inventory_loaded",
  ];
  for (const k of keys) {
    const v = evidence[k];
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) filled += 1;
    } else if (typeof v === "object") {
      if (Object.keys(v as object).length > 0) filled += 1;
    } else if (String(v).length > 0) {
      filled += 1;
    }
  }
  if (filled === 0) return { tier: null, reason: "", filled };
  if (filled >= 6) {
    return { tier: "high_match", reason: `${filled}/8 fields extracted`, filled };
  }
  if (filled >= 3) {
    return { tier: "worth_pursuing", reason: `${filled}/8 fields extracted`, filled };
  }
  return { tier: "long_shot", reason: `${filled}/8 fields extracted`, filled };
}

export function synthesizeDemoResult(filters: SpecimenFilters): QuerySpecimensResult {
  const indications = inferIndication(filters);
  const institutes = SUPPLIERS
    .map((s) => supplierToInstitute(s, filters, indications))
    .sort((a, b) => b.match_score - a.match_score);

  const totals = {
    specimens: institutes.reduce((acc, i) => acc + i.specimen_count, 0),
    donors: institutes.reduce((acc, i) => acc + i.donor_count, 0),
    institutes: institutes.filter((i) => i.organization_id !== "crovi_bio").length, // meta excluded
    longitudinal_donors: 0,
  };

  const by_country: Record<string, { count: number; institutes: string[] }> = {};
  for (const i of institutes) {
    const c = i.country ?? "—";
    if (!by_country[c]) by_country[c] = { count: 0, institutes: [] };
    by_country[c].count += i.specimen_count;
    by_country[c].institutes.push(i.name);
  }
  const by_specimen_type: Record<string, number> = {};
  for (const i of institutes) {
    for (const [t, n] of Object.entries(i.by_specimen_type)) {
      by_specimen_type[t] = (by_specimen_type[t] ?? 0) + n;
    }
  }

  return {
    filters_applied: filters,
    totals,
    institutes,
    table_rows: [],
    groupings: {
      by_country,
      by_specimen_type,
      by_treatment_status: {},
    },
    gaps: [],
  };
}
