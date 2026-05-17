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
import { loadRefMed } from "@/lib/search/refmed-loader";
import { readEvidence } from "@/lib/store/evidence-pool";
import type { SupplierEvidence } from "@/types/evidence";

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

function buildRefMedInventory(
  q: string | null,
  limit: number,
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

  // Build row preview (post-filter).
  const needle = q?.toLowerCase() ?? "";
  const rowsAll: InventoryRow[] = specimens
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

  return {
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
  if (runId) {
    try {
      const evidence = readEvidence(runId);
      extracted = projectExtractedFromEvidence(evidence, supplierId);
    } catch {
      extracted = {};
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
      response.inventory = buildRefMedInventory(q, limit);
      response.conviction_tier = "high_match";
    } catch (err) {
      // Demo-safe: surface the error but don't 500 — UI degrades to claimed only.
      // eslint-disable-next-line no-console
      console.warn("[/api/suppliers/refmed] XLSX load failed:", err);
    }
  }

  return NextResponse.json(response);
}
