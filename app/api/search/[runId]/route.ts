// app/api/search/[runId]/route.ts
//
// POST /api/search/:runId — returns the 4 shortlisted supplier seeds + a
// pre-paced list of fake search-trace hits the UI can play back.
//
// The actual SearchPhase component runs the pacing client-side (simpler,
// no SSE backpressure to manage in a demo). This route exists so the demo
// can talk about "the search agent" as a real network call, and to keep
// the supplier ids canonical (matching V1_DEMO_SUPPLIERS) on the server.

import { NextRequest, NextResponse } from "next/server";
import { V1_DEMO_SUPPLIERS } from "@/lib/demo-suppliers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchHit {
  id: string;
  source: string;
  url: string;
  title: string;
  snippet: string;
  supplier_id?: string;
  delay_ms: number;
}

const HITS: SearchHit[] = [
  {
    id: "pubmed",
    source: "PubMed",
    url: "pubmed.ncbi.nlm.nih.gov",
    title: "NSCLC liquid biopsy biospecimens — 142 results",
    snippet: "Plasma + FFPE cohort literature for Stage III-IV NSCLC, EGFR/KRAS/ALK populations.",
    delay_ms: 520,
  },
  {
    id: "linkedin",
    source: "LinkedIn",
    url: "linkedin.com",
    title: "Biobank procurement · Boston · 8 sourcing houses",
    snippet: "Connections in oncology biobank BD; cross-referencing against vendor footprints.",
    delay_ms: 680,
  },
  {
    id: "refmed",
    source: "referencemedicine.com",
    url: "referencemedicine.com",
    title: "Reference Medicine — public catalog",
    snippet: "U.S. commercial supplier. Monthly XLSX catalog + Airtable embed.",
    supplier_id: "refmed",
    delay_ms: 780,
  },
  {
    id: "geneticist",
    source: "geneticistinc.com",
    url: "geneticistinc.com",
    title: "Geneticist Inc — boutique sourcing house",
    snippet: "Long-tail oncology · NSCLC + CRC core competencies.",
    supplier_id: "geneticist",
    delay_ms: 560,
  },
  {
    id: "audubon",
    source: "audubonbio.com",
    url: "audubonbio.com",
    title: "Audubon Bioscience — multi-form intake (Houston)",
    snippet: "Global biospecimen procurement · NSCLC + broader oncology reach.",
    supplier_id: "audubon",
    delay_ms: 720,
  },
  {
    id: "crovi",
    source: "crovi.bio",
    url: "crovi.bio",
    title: "Crovi.bio — discovery layer (this platform)",
    snippet: "Direct contact + waitlist form. Surfaced because it IS the layer.",
    supplier_id: "crovi_bio",
    delay_ms: 480,
  },
];

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await ctx.params;
  return NextResponse.json({
    runId,
    suppliers: V1_DEMO_SUPPLIERS.map((s) => s.supplier_id),
    hits: HITS,
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await ctx.params;
  return NextResponse.json({
    runId,
    suppliers: V1_DEMO_SUPPLIERS.map((s) => s.supplier_id),
    hits: HITS,
  });
}
