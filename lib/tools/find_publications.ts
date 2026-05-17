import { matchPublications, type Publication } from "../publications";
import { canonicalize, type SpecimenFilters } from "../filters";
import type { Gap } from "./query_specimens";

export type FindPublicationsResult = {
  filters_applied: SpecimenFilters;
  papers: Publication[];
  gaps: Gap[];
};

export function findpublications(rawFilters: SpecimenFilters): FindPublicationsResult {
  const f = canonicalize(rawFilters);
  const papers = matchPublications(f, 6);
  const gaps: Gap[] = [];
  if (papers.length === 0) {
    gaps.push({
      kind: "no_curated_evidence",
      why: "No curated literature matches these filters. (MVP only indexes a curated corpus; live PubMed is out of scope.)",
      actions: [{ label: "Commission a literature scan", intent: "open_request_form:source_wider" }],
    });
  }
  return { filters_applied: f, papers, gaps };
}
