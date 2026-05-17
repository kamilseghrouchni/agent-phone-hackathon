// Per-supplier detail payload for the right-pane SupplierDetail view.
//
// Three shapes the UI can consume:
//   - RefMed   → XLSX-driven inventory breakdown (top conditions, top sample
//                types, sample row preview). NEVER ship the full 14,637-row
//                table over the wire — top-N + total + breakdowns only.
//   - geneticist / audubon → evidence-pool projection (if runId supplied),
//                falling back to the static directory entry.
//   - crovi_bio → static directory entry (the meta layer).
//
// The route is read-only and runs on Node so it can hit the local XLSX
// + evidence.jsonl files.
//
// Query params:
//   ?runId=<uuid>  optional — pulls evidence pool for non-RefMed suppliers
//   ?q=<text>      optional — substring filter on RefMed rows
//   ?limit=<n>     optional — max RefMed rows returned (default 50, max 200)

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getV1Supplier } from "@/lib/demo-suppliers";
import { loadRefMed, type RefMedSpecimen } from "@/lib/search/refmed-loader";
import { readEvidence } from "@/lib/store/evidence-pool";
import { readIntake } from "@/lib/store/runs";
import type { SupplierEvidence } from "@/types/evidence";
import type { IntakeForm } from "@/types/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ supplierId: string }>;
}

interface CountEntry {
  label: string;
  count: number;
}

interface InventoryRow {
  rm_id: string;
  condition: string;
  sample_type: string;
  stage?: string;
  fee_usd?: number;
}

interface IntakeMatchCriteria {
  indication?: string[];      // tokens applied (e.g. ["NSCLC", "lung"])
  specimen_types?: string[];  // tokens applied (e.g. ["plasma", "FFPE"])
  stages?: string[];          // tokens applied (e.g. ["III", "IV"])
}

interface IntakeMatchSummary {
  count: number;              // rows passing all intake filters
  total: number;              // total catalog size pre-filter
  criteria: IntakeMatchCriteria;
}

interface RefMedInventoryPayload {
  total_specimens: number;
  total_cases: number;
  unique_conditions: number;
  unique_sample_types: number;
  top_conditions: CountEntry[];
  top_sample_types: CountEntry[];
  rows_total: number;       // total matching rows (post-filter, pre-truncate)
  rows_truncated_at: number; // limit applied
  rows: InventoryRow[];
  /** Buyer-query filter summary — drives the "N of 14,637 match" headline. */
  intake_match?: IntakeMatchSummary;
}

interface SupplierDetailResponse {
  supplier_id: string;
  name: string;
  country: string;
  flag: string;
  conviction_tier?: "high_match" | "worth_pursuing" | "long_shot";
  blurb: string;
  claimed: {
    conditions: string[];
    sample_types: string[];
    contact?: { email?: string; phone?: string; form_url?: string };
  };
  extracted: Record<string, unknown>;   // evidence-pool projection (others)
  inventory?: RefMedInventoryPayload;   // RefMed only
}

function refmedXlsxPath(): string {
  return (
    process.env.REFMED_XLSX_PATH ??
    path.join(
      process.cwd(),
      "docs",
      "yc-hackathon ", // trailing space — matches filesystem
      "Reference Medicine_May Inverntory File.xlsx",
    )
  );
}

function topN(map: Map<string, number>, n: number): CountEntry[] {
  return Array.from(map.entries())
    .filter(([k]) => k && k.trim().length > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

// ---------------------------------------------------------------------------
// Intake-derived filter — turns the buyer's parsed intake into a small set of
// case-insensitive substring tokens we can apply to the XLSX rows. The point
// is to PROVE the agent is filtering: the audience sees "150 of 14,637 match"
// instead of the unfiltered catalog. Each filter dimension is optional and
// only applied when at least one token is present.
// ---------------------------------------------------------------------------

const INDICATION_SYNONYMS: Record<string, string[]> = {
  nsclc: ["nsclc", "lung", "non-small", "non small"],
  lung: ["lung", "nsclc", "non-small"],
  breast: ["breast"],
  crc: ["crc", "colorectal", "colon", "rectum"],
  colorectal: ["colorectal", "colon", "crc", "rectum"],
  prostate: ["prostate"],
  pancreatic: ["pancreas", "pancreatic"],
  ovarian: ["ovary", "ovarian"],
  melanoma: ["melanoma", "skin"],
};

const SPECIMEN_SYNONYMS: Record<string, string[]> = {
  plasma: ["plasma"],
  serum: ["serum"],
  blood: ["blood"],
  ffpe: ["ffpe", "paraffin"],
  paraffin: ["paraffin", "ffpe"],
  tissue: ["tissue", "paraffin", "frozen"],
  frozen: ["frozen"],
  "buffy coat": ["buffy"],
  "whole blood": ["blood"],
};

function deriveIntakeFilter(intake: IntakeForm | null): IntakeMatchCriteria {
  if (!intake) return {};
  const byId = new Map<string, string>();
  for (const f of intake.fields) {
    if (f.value == null) continue;
    byId.set(f.field_id, String(f.value).toLowerCase());
  }
  const indText = [
    byId.get("specimen.diagnosis") ?? "",
    byId.get("project.therapeutic_area") ?? "",
  ].join(" ");
  const specText = [
    byId.get("specimen.types") ?? "",
    byId.get("specimen.format") ?? "",
  ].join(" ");
  const stageText = [
    byId.get("specimen.diagnosis") ?? "",
    byId.get("demo.disease_stage") ?? "",
  ].join(" ");

  const indications: string[] = [];
  for (const [key, syns] of Object.entries(INDICATION_SYNONYMS)) {
    if (syns.some((s) => indText.includes(s))) indications.push(key);
  }
  const specimen_types: string[] = [];
  for (const [key, syns] of Object.entries(SPECIMEN_SYNONYMS)) {
    if (syns.some((s) => specText.includes(s))) specimen_types.push(key);
  }
  const stages: string[] = [];
  // Match "III-IV", "stage III", "III/IV", "stage IV", "advanced", "metastatic".
  if (/\bstage\s+iii\b|\biii[-/\s]?iv\b|\biii\b/.test(stageText)) stages.push("III");
  if (/\bstage\s+iv\b|\biii[-/\s]?iv\b|\biv\b/.test(stageText)) stages.push("IV");
  if (stages.length === 0 && /\badvanced\b|\bmetastatic\b/.test(stageText)) {
    stages.push("III", "IV");
  }

  return {
    indication: indications.length > 0 ? indications : undefined,
    specimen_types: specimen_types.length > 0 ? specimen_types : undefined,
    stages: stages.length > 0 ? stages : undefined,
  };
}

function rowMatchesCriteria(s: RefMedSpecimen, c: IntakeMatchCriteria): boolean {
  if (c.indication && c.indication.length > 0) {
    const hay = `${s.primary_tumor_site ?? ""} ${s.tumor_type ?? ""} ${s.pathologic_diagnosis ?? ""}`.toLowerCase();
    const tokens = c.indication.flatMap((k) => INDICATION_SYNONYMS[k] ?? [k]);
    if (!tokens.some((t) => hay.includes(t))) return false;
  }
  if (c.specimen_types && c.specimen_types.length > 0) {
    const hay = (s.specimen_type ?? "").toLowerCase();
    const tokens = c.specimen_types.flatMap((k) => SPECIMEN_SYNONYMS[k] ?? [k]);
    if (!tokens.some((t) => hay.includes(t))) return false;
  }
  if (c.stages && c.stages.length > 0) {
    const stage = (s.stage ?? "").toUpperCase();
    // Match by leading roman numeral so "III" matches "III"/"IIIA"/"IIIB"/"IIIC"
    // but NOT "II"/"IIA". "IV" matches "IV"/"IVA"/"IVB" but not "I".
    const leading = stage.match(/^[IVX]+/)?.[0] ?? "";
    const ok = c.stages.some((st) => {
      const up = st.toUpperCase();
      return leading === up;
    });
    if (!ok) return false;
  }
  return true;
}

function buildRefMedInventory(
  q: string | null,
  limit: number,
  intake: IntakeForm | null,
): RefMedInventoryPayload {
  const { cases, specimens } = loadRefMed(refmedXlsxPath());

  // Group by condition (primary tumor site preferred) + sample type.
  const conditionCounts = new Map<string, number>();
  const sampleTypeCounts = new Map<string, number>();
  for (const s of specimens) {
    const cond = s.primary_tumor_site || s.tumor_type || "unknown";
    conditionCounts.set(cond, (conditionCounts.get(cond) ?? 0) + 1);
    const st = s.specimen_type || "unknown";
    sampleTypeCounts.set(st, (sampleTypeCounts.get(st) ?? 0) + 1);
  }

  // 1) Apply intake-derived filter (the "proves the agent is filtering" pass).
  const criteria = deriveIntakeFilter(intake);
  const hasCriteria =
    Boolean(criteria.indication?.length) ||
    Boolean(criteria.specimen_types?.length) ||
    Boolean(criteria.stages?.length);
  const intakeFiltered = hasCriteria
    ? specimens.filter((s) => rowMatchesCriteria(s, criteria))
    : specimens;

  // 2) Apply free-text overlay filter (UI search input).
  const needle = q?.toLowerCase() ?? "";
  const rowsAll: InventoryRow[] = intakeFiltered
    .filter((s) => {
      if (!needle) return true;
      const hay = `${s.rm_id} ${s.specimen_type ?? ""} ${s.primary_tumor_site ?? ""} ${s.tumor_type ?? ""} ${s.stage ?? ""} ${s.pathologic_diagnosis ?? ""}`.toLowerCase();
      return hay.includes(needle);
    })
    .map((s) => ({
      rm_id: s.rm_id,
      condition: s.primary_tumor_site || s.tumor_type || "—",
      sample_type: s.specimen_type || "—",
      stage: s.stage,
      fee_usd: s.fee_usd,
    }));

  const payload: RefMedInventoryPayload = {
    total_specimens: specimens.length,
    total_cases: cases.length,
    unique_conditions: conditionCounts.size,
    unique_sample_types: sampleTypeCounts.size,
    top_conditions: topN(conditionCounts, 10),
    top_sample_types: topN(sampleTypeCounts, 8),
    rows_total: rowsAll.length,
    rows_truncated_at: limit,
    rows: rowsAll.slice(0, limit),
  };
  if (hasCriteria) {
    payload.intake_match = {
      count: intakeFiltered.length,
      total: specimens.length,
      criteria,
    };
  }
  return payload;
}

function projectExtractedFromEvidence(
  evidence: SupplierEvidence[],
  supplierId: string,
): Record<string, unknown> {
  // Latest non-null write per field_id wins.
  const out: Record<string, unknown> = {};
  for (const e of evidence) {
    if (e.supplier_id !== supplierId) continue;
    if (e.value == null) continue;
    if (Array.isArray(e.value) && e.value.length === 0) continue;
    out[e.field_id] = e.value;
  }
  return out;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { supplierId } = await ctx.params;
  const seed = getV1Supplier(supplierId);
  if (!seed) {
    return NextResponse.json(
      { error: `unknown supplier_id: ${supplierId}` },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  const q = url.searchParams.get("q");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(
    200,
    Math.max(1, limitRaw ? parseInt(limitRaw, 10) || 50 : 50),
  );

  let extracted: Record<string, unknown> = {};
  let intake: IntakeForm | null = null;
  if (runId) {
    try {
      const evidence = readEvidence(runId);
      extracted = projectExtractedFromEvidence(evidence, supplierId);
    } catch {
      extracted = {};
    }
    try {
      intake = readIntake(runId);
    } catch {
      intake = null;
    }
  }

  const response: SupplierDetailResponse = {
    supplier_id: seed.supplier_id,
    name: seed.name,
    country: seed.country,
    flag: seed.flag,
    blurb: seed.blurb,
    claimed: seed.claimed,
    extracted,
  };

  if (seed.supplier_id === "refmed") {
    try {
      response.inventory = buildRefMedInventory(q, limit, intake);
      response.conviction_tier = "high_match";
    } catch (err) {
      // Demo-safe: surface the error but don't 500 — UI degrades to claimed only.
      // eslint-disable-next-line no-console
      console.warn("[/api/suppliers/refmed] XLSX load failed:", err);
    }
  }

  return NextResponse.json(response);
}
