// RefMed search engine — spec § 3.6.
//
// Pure JS deterministic filter over the loaded RefMed catalog. No LLM.
// Roughly ~50ms for the demo query over 14k specimen rows.
//
// Search atoms covered:
//   - LIKE / contains   (disease string against primary_tumor_site + tumor_type)
//   - exact match       (treatment_status)
//   - set membership    (stages[], specimen_type aliases)
//   - range             (min_volume_mL)
//   - matched-set       (case has both tumor + adjacent normal specimens)
//   - price ceiling     (sum fee_usd ≤ cap)
//
// The "audit layer" (biomarkers, IRB, turnaround, quality grade) is OUT of
// scope here by design — that's why the UI labels those fields
// "unknown — requires audit" until a channel agent fills them in.

import type { ParsedQuery, SpecimenRequest } from "@/types/parsed-query";
import { loadRefMed, type RefMedCase, type RefMedSpecimen } from "./refmed-loader";

// Map a user-facing specimen type onto the RefMed specimen_type strings
// that should satisfy it. Plasma asks include the bundled liquid biopsy
// products because they ship plasma volume.
const SPECIMEN_TYPE_ALIASES: Record<string, string[]> = {
  plasma: ["Plasma", "Matched plasma & buffy set", "Liquid biopsy set"],
  serum: ["Serum"],
  pbmc: ["Buffy coat", "Matched plasma & buffy set"],
  buffy: ["Buffy coat", "Matched plasma & buffy set"],
  buffy_coat: ["Buffy coat", "Matched plasma & buffy set"],
  blood: ["Blood", "Liquid biopsy set"],
  ffpe: ["Paraffin block"],
  "ffpe block": ["Paraffin block"],
  paraffin: ["Paraffin block"],
  "frozen tissue": ["Frozen -80C (snap frozen)"],
  "fresh tissue": ["Frozen -80C (snap frozen)"], // RefMed only stocks frozen
};

function normaliseType(t: string): string {
  return t.toLowerCase().trim();
}

function aliasesFor(reqType: string): string[] {
  const key = normaliseType(reqType);
  return SPECIMEN_TYPE_ALIASES[key] ?? [reqType]; // pass through unknown types
}

function caseMatchesDisease(c: RefMedCase, diseases: string[]): boolean {
  if (diseases.length === 0) return true;
  // Only match against PRIMARY site + tumor type — never specimen_sites or
  // pathologic_diagnosis, both of which mention secondary/metastatic sites
  // (e.g. a colorectal case sampled at the lung).
  const primarySite = c.primary_tumor_site.toLowerCase();
  const tumor = c.tumor_type.toLowerCase();
  const hay = `${primarySite} ${tumor}`;
  return diseases.some((d) => {
    const needle = d.toLowerCase();
    if (needle === "nsclc" || needle === "non-small cell lung cancer") {
      const isLungPrimary = primarySite.startsWith("lung");
      if (!isLungPrimary) return false;
      const isSmallCell = tumor.includes("small cell") && !tumor.includes("non-small cell");
      if (isSmallCell) return false;
      return (
        tumor.includes("non-small cell") ||
        tumor.includes("adenocarcinoma") ||
        tumor.includes("squamous cell") ||
        tumor.includes("large cell") ||
        tumor.includes("carcinoid")
      );
    }
    return hay.includes(needle);
  });
}

// Roman-numeral stage matcher. Naïve startsWith fails because "I" prefixes
// "II", "III", and "IV" — and the catalog uses substages like "IA3",
// "IIIC1", "IIIC2". A negative lookahead on [IV] makes the boundary right
// for I/II/III; IV is unambiguous either way.
function stageMatchesPrefix(stage: string, prefix: string): boolean {
  return new RegExp(`^${prefix}(?![IV])`).test(stage);
}

function caseMatchesStage(c: RefMedCase, stages?: ("I" | "II" | "III" | "IV")[]): boolean {
  if (!stages || stages.length === 0) return true;
  if (!c.stage) return false;
  const stage = c.stage.toUpperCase();
  return stages.some((s) => stageMatchesPrefix(stage, s));
}

function caseMatchesTreatment(c: RefMedCase, status?: ParsedQuery["treatment_status"]): boolean {
  if (!status || status === "any") return true;
  const treat = (c.treatment_status ?? "").toLowerCase();
  if (status === "naive") return treat.includes("not treated") || treat.includes("naive");
  if (status === "treated") return treat.includes("treated") && !treat.includes("not treated");
  return true;
}

function caseMatchesSite(c: RefMedCase, sites?: string[]): boolean {
  if (!sites || sites.length === 0) return true;
  const hay = `${c.primary_tumor_site} ${c.specimen_sites}`.toLowerCase();
  return sites.some((s) => hay.includes(s.toLowerCase()));
}

function specimenVolumeFor(s: RefMedSpecimen, reqType: string): number {
  const key = normaliseType(reqType);
  if (key === "plasma") return s.plasma_mL ?? 0;
  if (key === "serum") return s.serum_mL ?? 0;
  if (key === "blood") return s.blood_mL ?? 0;
  if (key === "pbmc" || key === "buffy" || key === "buffy_coat") return s.buffy_coat_mL ?? 0;
  return 0; // solid types have no volume; min_volume filter is irrelevant
}

function caseHasMatchedSet(
  caseId: string,
  byCase: Map<string, RefMedSpecimen[]>,
  kind: "tumor+adjacent_normal" | "tumor+plasma" | "longitudinal",
): boolean {
  const specs = byCase.get(caseId) ?? [];
  if (kind === "tumor+adjacent_normal") {
    return (
      specs.some((s) => (s.tissue_type ?? "").toLowerCase().includes("tumor, malignant")) &&
      specs.some((s) => (s.tissue_type ?? "").toLowerCase().includes("normal"))
    );
  }
  if (kind === "tumor+plasma") {
    return (
      specs.some((s) => (s.tissue_type ?? "").toLowerCase().includes("tumor")) &&
      specs.some((s) => (s.plasma_mL ?? 0) > 0)
    );
  }
  // longitudinal not represented in RefMed catalog
  return false;
}

export interface SpecimenCoverage {
  requested_type: string;
  requested_n: number;
  matched_n: number;
  matched_specimen_ids: string[];
  total_fee_usd: number;
}

export interface SearchResult {
  matched_cases: RefMedCase[];
  matched_specimens_per_case: Map<string, RefMedSpecimen[]>;
  per_type_coverage: SpecimenCoverage[];
  total_est_usd: number;
  coverage_summary: {
    cases_matched: number;
    types_fully_covered: number;
    types_partially_covered: number;
    audit_layer: "unknown — requires audit";
  };
  ranking_factors: {
    volume_fit: number;   // 0..1 — overall n_cases satisfaction
    price_fit: number;    // 0..1 — 1 if total ≤ cap, scaled down if over
    stage_match: number;  // 0..1 — proportion of matched cases hitting stage filter
    site_match: number;   // 0..1 — proportion hitting anatomical_sites filter
  };
}

export function searchRefMed(q: ParsedQuery): SearchResult {
  const { cases, specimensByCase } = loadRefMed();

  const diseases = q.diseases ?? [];
  const sites = q.anatomical_sites ?? [];
  const stages = q.stages;

  // 1. Filter cases by search-critical fields.
  const matchedCases = cases.filter(
    (c) =>
      caseMatchesDisease(c, diseases) &&
      caseMatchesStage(c, stages) &&
      caseMatchesTreatment(c, q.treatment_status) &&
      caseMatchesSite(c, sites) &&
      (q.matched_set_required ?? []).every((kind) =>
        caseHasMatchedSet(c.rm_case_id, specimensByCase, kind),
      ),
  );
  const matchedCaseIds = new Set(matchedCases.map((c) => c.rm_case_id));

  // 2. Per requested specimen type, pull specimens belonging to matched
  //    cases that satisfy the alias + min_volume filter. Cap to n_cases.
  const perType: SpecimenCoverage[] = [];
  const usedSpecimenIds = new Set<string>();
  const claimedByCase = new Map<string, RefMedSpecimen[]>();

  for (const req of q.specimens) {
    const aliases = new Set(aliasesFor(req.type));
    const minVol = req.min_volume_mL ?? 0;

    // Group eligible specimens by case so we can pick one case at a time.
    // n_cases means n distinct donors, not n specimens — a single case may
    // own multiple paraffin blocks, we count it once.
    const candidatesByCase = new Map<string, RefMedSpecimen[]>();
    for (const caseId of matchedCaseIds) {
      const cspecs = specimensByCase.get(caseId) ?? [];
      const eligible: RefMedSpecimen[] = [];
      for (const s of cspecs) {
        if (!aliases.has(s.specimen_type)) continue;
        if (usedSpecimenIds.has(s.rm_id)) continue;
        if (minVol > 0 && specimenVolumeFor(s, req.type) < minVol) continue;
        eligible.push(s);
      }
      if (eligible.length > 0) {
        eligible.sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || (a.fee_usd ?? 0) - (b.fee_usd ?? 0));
        candidatesByCase.set(caseId, eligible);
      }
    }

    // Best case first — cheapest tier-1 representative wins ranking.
    const caseIds = [...candidatesByCase.keys()].sort((a, b) => {
      const sa = candidatesByCase.get(a)![0];
      const sb = candidatesByCase.get(b)![0];
      return (sa.tier ?? 9) - (sb.tier ?? 9) || (sa.fee_usd ?? 0) - (sb.fee_usd ?? 0);
    });

    let fee = 0;
    const claimedIds: string[] = [];
    let claimedCases = 0;
    for (const caseId of caseIds) {
      if (claimedCases >= req.n_cases) break;
      const pick = candidatesByCase.get(caseId)![0]; // one representative specimen per case
      usedSpecimenIds.add(pick.rm_id);
      fee += pick.fee_usd ?? 0;
      claimedIds.push(pick.rm_id);
      const arr = claimedByCase.get(caseId) ?? [];
      arr.push(pick);
      claimedByCase.set(caseId, arr);
      claimedCases++;
    }

    perType.push({
      requested_type: req.type,
      requested_n: req.n_cases,
      matched_n: claimedCases,
      matched_specimen_ids: claimedIds,
      total_fee_usd: fee,
    });
  }

  const totalUsd = perType.reduce((acc, p) => acc + p.total_fee_usd, 0);

  // 3. Coverage + ranking factors.
  const totalRequested = perType.reduce((a, p) => a + p.requested_n, 0);
  const totalMatched = perType.reduce((a, p) => a + p.matched_n, 0);
  const volumeFit = totalRequested > 0 ? totalMatched / totalRequested : 0;

  const priceFit =
    q.price_cap_usd && q.price_cap_usd > 0
      ? Math.max(0, Math.min(1, q.price_cap_usd / Math.max(totalUsd, 1)))
      : 1;

  const stageMatch =
    stages && stages.length > 0
      ? matchedCases.length > 0
        ? matchedCases.filter((c) => caseMatchesStage(c, stages)).length / matchedCases.length
        : 0
      : 1;

  const siteMatch =
    sites.length > 0
      ? matchedCases.length > 0
        ? matchedCases.filter((c) => caseMatchesSite(c, sites)).length / matchedCases.length
        : 0
      : 1;

  return {
    matched_cases: matchedCases,
    matched_specimens_per_case: claimedByCase,
    per_type_coverage: perType,
    total_est_usd: totalUsd,
    coverage_summary: {
      cases_matched: matchedCases.length,
      types_fully_covered: perType.filter((p) => p.matched_n >= p.requested_n).length,
      types_partially_covered: perType.filter((p) => p.matched_n > 0 && p.matched_n < p.requested_n).length,
      audit_layer: "unknown — requires audit",
    },
    ranking_factors: { volume_fit: volumeFit, price_fit: priceFit, stage_match: stageMatch, site_match: siteMatch },
  };
}
