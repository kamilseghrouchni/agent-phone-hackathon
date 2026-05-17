/**
 * Server-only loaders for assay/provider catalogs.
 * Reads TSV/JSONL files from data/ directory.
 */
import fs from "node:fs";
import path from "node:path";
import type { Provider, ProviderEnrichment } from "@/lib/bundle";

export type AssayRow = {
  assay_family: string;
  specific_assay: string;
  key_vendors: string;
  sample_types: string;
  typical_conditions: string;
  patient_capable: string;
  evidence: string;
};

export type CroRow = {
  cro_name: string;
  parent: string;
  cro_type: string;
  hq_country: string;
  assay_families: string;
  specific_assays: string;
  sample_types: string;
  accreditation: string;
  patient_capable: string;
  url: string;
  services_url: string;
};

export type PlatformRecord = {
  name: string;
  role: string;
  category: string;
  assay: string;
  countries: string[];
  n_trials: number;
  total_enrollment: number;
  evidence: { nct_id: string; title: string; n_enrolled: number }[];
};

const DATA_DIR = path.join(process.cwd(), "data");

function parseTSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function loadAssayCatalog(): AssayRow[] {
  const text = fs.readFileSync(path.join(DATA_DIR, "assay_catalog.tsv"), "utf-8");
  return parseTSV(text) as AssayRow[];
}

export function loadCroCatalog(): CroRow[] {
  const text = fs.readFileSync(path.join(DATA_DIR, "cro_catalog.tsv"), "utf-8");
  return parseTSV(text) as CroRow[];
}

export function loadPlatforms(): PlatformRecord[] {
  const file = path.join(DATA_DIR, "platforms", "_all.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PlatformRecord);
}

function splitList(s: string): string[] {
  return s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Match providers for a given assay name. Combines three sources:
 *  - cro_catalog (service CROs that offer the assay family)
 *  - platforms file (CT.gov-derived analytical platforms tagged as analytical_platform)
 *  - assay_catalog vendors (IP/hardware vendors)
 */
export function providersForAssay(assayName: string): Provider[] {
  const out: Provider[] = [];
  const target = assayName.toLowerCase();
  const targetTokens = target.split(/\s+/).filter((t) => t.length > 2);

  const matchAny = (haystack: string): boolean => {
    const h = haystack.toLowerCase();
    if (h.includes(target)) return true;
    return targetTokens.some((t) => h.includes(t));
  };

  // 1. CROs
  const cros = loadCroCatalog();
  for (const r of cros) {
    if (matchAny(r.assay_families) || matchAny(r.specific_assays)) {
      const type: Provider["type"] =
        r.cro_type === "multi_assay_clinical" ? "service_cro" : "specialty_cro";
      out.push({
        id: slugify(r.cro_name),
        name: r.cro_name,
        parent: r.parent && r.parent !== "—" ? r.parent : null,
        type,
        country: r.hq_country,
        assay_families: splitList(r.assay_families),
        specific_assays: splitList(r.specific_assays),
        sample_types: splitList(r.sample_types),
        accreditation: r.accreditation,
        url: r.url,
        services_url: r.services_url,
        evidence: r.services_url,
      });
    }
  }

  // 2. CT.gov platforms (analytical only)
  const platforms = loadPlatforms();
  const seenNames = new Set(out.map((p) => p.name.toLowerCase()));
  for (const p of platforms) {
    if (p.category !== "analytical_platform") continue;
    if (!matchAny(p.assay)) continue;
    if (seenNames.has(p.name.toLowerCase())) continue;
    seenNames.add(p.name.toLowerCase());
    const topNct = p.evidence?.[0]?.nct_id;
    out.push({
      id: slugify(p.name),
      name: p.name,
      type: "ip_platform",
      country: p.countries.join(", ") || "—",
      assay_families: [],
      specific_assays: [p.assay],
      sample_types: [],
      accreditation: "—",
      evidence: topNct ? `https://clinicaltrials.gov/study/${topNct}` : undefined,
      n_trials: p.n_trials,
      total_enrollment: p.total_enrollment,
    });
  }

  // 3. Hardware vendors named in assay_catalog
  const assays = loadAssayCatalog();
  const matchingAssay = assays.find(
    (a) =>
      a.specific_assay.toLowerCase() === target ||
      a.specific_assay.toLowerCase().includes(target),
  );
  if (matchingAssay) {
    const vendors = splitList(matchingAssay.key_vendors);
    for (const v of vendors) {
      // strip trailing parens like "Illumina NovaSeq"
      const name = v.replace(/\s*\(.*?\)\s*/g, "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      out.push({
        id: slugify(name),
        name,
        type: "vendor",
        country: "—",
        assay_families: [matchingAssay.assay_family],
        specific_assays: [matchingAssay.specific_assay],
        sample_types: splitList(matchingAssay.sample_types),
        accreditation: "—",
      });
    }
  }

  // Rank: service_cro first, then specialty_cro, then ip_platform (by trial count), then vendor
  const typeOrder: Record<Provider["type"], number> = {
    service_cro: 0,
    specialty_cro: 1,
    ip_platform: 2,
    vendor: 3,
  };
  out.sort((a, b) => {
    const t = typeOrder[a.type] - typeOrder[b.type];
    if (t !== 0) return t;
    return (b.n_trials ?? 0) - (a.n_trials ?? 0);
  });

  return out;
}

/**
 * Find the assay catalog entry by exact or fuzzy match on specific_assay.
 */
export function findAssayInCatalog(query: string): AssayRow | null {
  const assays = loadAssayCatalog();
  const q = query.toLowerCase();
  return (
    assays.find((a) => a.specific_assay.toLowerCase() === q) ||
    assays.find((a) => a.specific_assay.toLowerCase().includes(q)) ||
    assays.find((a) => q.includes(a.specific_assay.toLowerCase())) ||
    null
  );
}

export function listAllAssays(): AssayRow[] {
  return loadAssayCatalog();
}

// --- Provider enrichment (PubMed-derived facts) -----------------------------

const ENRICH_DIR = path.join(DATA_DIR, "providers_enriched");
let _enrichmentCache: Map<string, ProviderEnrichment> | null = null;

type EnrichmentFileShape = {
  id: string;
  name: string;
  publication_total: number;
  publications_indexed: number;
  address_hints: string[];
  contact_emails: string[];
  sample_types: ProviderEnrichment["sample_types"];
  indication_areas: ProviderEnrichment["indication_areas"];
  academic_partners: ProviderEnrichment["academic_partners"];
  top_publications: ProviderEnrichment["top_publications"];
};

function loadEnrichmentIndex(): Map<string, ProviderEnrichment> {
  if (_enrichmentCache) return _enrichmentCache;
  const out = new Map<string, ProviderEnrichment>();
  if (!fs.existsSync(ENRICH_DIR)) {
    _enrichmentCache = out;
    return out;
  }
  for (const f of fs.readdirSync(ENRICH_DIR)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ENRICH_DIR, f), "utf-8")) as EnrichmentFileShape;
      out.set(raw.id, {
        publication_total: raw.publication_total,
        publications_indexed: raw.publications_indexed,
        address_hint: raw.address_hints?.[0] ?? null,
        contact_emails: raw.contact_emails ?? [],
        sample_types: raw.sample_types ?? [],
        indication_areas: raw.indication_areas ?? [],
        academic_partners: raw.academic_partners ?? [],
        top_publications: raw.top_publications ?? [],
      });
    } catch {
      // ignore malformed file
    }
  }
  _enrichmentCache = out;
  return out;
}

export function enrichmentFor(providerId: string): ProviderEnrichment | undefined {
  return loadEnrichmentIndex().get(providerId);
}

export function attachEnrichment<T extends Provider>(p: T): T {
  const e = enrichmentFor(p.id);
  return e ? { ...p, enrichment: e } : p;
}
