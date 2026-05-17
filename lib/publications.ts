import fs from "node:fs";
import path from "node:path";
import type { SpecimenFilters } from "./filters";

export type Publication = {
  pmid: string | null;
  pmc_id: string | null;
  doi: string | null;
  title: string;
  year: number | null;
  journal: string | null;
  institution: string | null;
  institution_type: string | null;
  specimens_described: any;
  access_route: string | null;
  contact_extractable: boolean | null;
  depth_confidence: string | null;
  notes: string | null;
  _bundle_id: string;
  _tags: { indication: string[]; specimen_types: string[]; preservation: string; matched_pairs: boolean };
};

let cached: Publication[] | null = null;

function load(): Publication[] {
  if (cached) return cached;
  const p = path.join(process.cwd(), "data", "enriched", "publications.json");
  cached = JSON.parse(fs.readFileSync(p, "utf-8"));
  return cached!;
}

/** Score a publication against parsed filters: indication overlap (heaviest)
 *  + specimen_type overlap. Returns null if score < 1 (no overlap).
 *  This is intentionally Tier-1-only: we are not pretending broader coverage. */
export function matchPublications(f: SpecimenFilters, limit = 6): Publication[] {
  const pubs = load();
  const wantInd = new Set((f.indication ?? []).map((s) => s.toLowerCase()));
  const wantType = new Set((f.specimen_types ?? []).map((s) => s.toLowerCase()));
  const scored: { pub: Publication; score: number }[] = [];

  for (const pub of pubs) {
    let score = 0;
    for (const t of pub._tags.indication) {
      for (const w of wantInd) {
        if (t === w || t.includes(w) || w.includes(t)) score += 3;
      }
    }
    for (const t of pub._tags.specimen_types) {
      for (const w of wantType) {
        if (t === w || t.includes(w) || w.includes(t)) score += 1;
      }
    }
    if (score > 0) scored.push({ pub, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.pub);
}
