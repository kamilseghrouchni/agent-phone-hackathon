// POST /api/run/start
// Creates a new run directory at store/runs/{runId}/ with request.json
// (parsed_query + info_needs + raw_query). Returns the runId so the
// HandoffModal can then stage actions per supplier.

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getRepoRoot } from "@/lib/ai/pipeline-utils";
import { buildParsedQuery, defaultInfoNeeds } from "@/lib/query-bridge";
import type { SpecimenFilters } from "@/lib/filters";

interface Body {
  raw_query: string;
  parsed_filters: SpecimenFilters;
  use_case?: string;
  info_needs?: string[];
}

function runIdFromQuery(rawQuery: string): string {
  const slug =
    rawQuery
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "untitled";
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}_${slug}_${rand}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (!body.raw_query || !body.parsed_filters) {
    return NextResponse.json({ error: "raw_query + parsed_filters required" }, { status: 400 });
  }

  const parsed_query = buildParsedQuery(body.raw_query, body.parsed_filters, body.use_case);
  const info_needs = body.info_needs ?? defaultInfoNeeds(parsed_query);

  const runId = runIdFromQuery(body.raw_query);
  const runDir = path.join(getRepoRoot(), "store", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "request.json"),
    JSON.stringify({ parsed_query, info_needs, raw_query: body.raw_query, created_at: new Date().toISOString() }, null, 2),
  );

  return NextResponse.json({ runId, parsed_query, info_needs });
}
