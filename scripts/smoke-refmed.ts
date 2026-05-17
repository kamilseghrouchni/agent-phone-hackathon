// Smoke test for the RefMed loader + search engine. Runs the spec's demo
// seed query (150 plasma + 75 FFPE NSCLC) against the real XLSX. Prints
// coverage, fees, and a sample matched specimen — no asserts, just eyeball.
//
//   npx tsx scripts/smoke-refmed.ts

import { loadRefMed } from "../src/lib/search/refmed-loader";
import { searchRefMed } from "../src/lib/search/search-engine";
import type { ParsedQuery } from "../src/types/parsed-query";

function ms<T>(label: string, fn: () => T): T {
  const t = Date.now();
  const out = fn();
  console.log(`${label}: ${Date.now() - t}ms`);
  return out;
}

const data = ms("load", () => loadRefMed());
console.log(`  cases:     ${data.cases.length}`);
console.log(`  specimens: ${data.specimens.length}`);
console.log(`  byCase:    ${data.specimensByCase.size}`);

const demoQuery: ParsedQuery = {
  diseases: ["NSCLC"],
  specimens: [
    { type: "plasma", n_cases: 150, min_volume_mL: 2 },
    { type: "FFPE block", n_cases: 75 },
  ],
  use_case: "biomarker validation cohort",
  raw_query: "150 plasma + 75 FFPE NSCLC samples for biomarker validation",
};

const result = ms("\nsearch (NSCLC demo)", () => searchRefMed(demoQuery));
console.log(`  matched cases: ${result.matched_cases.length}`);
for (const cov of result.per_type_coverage) {
  console.log(
    `  ${cov.requested_type}: ${cov.matched_n}/${cov.requested_n} cases — $${cov.total_fee_usd.toLocaleString()}`,
  );
}
console.log(`  total est:     $${result.total_est_usd.toLocaleString()}`);
console.log(`  ranking:       volume_fit=${result.ranking_factors.volume_fit.toFixed(2)} price_fit=${result.ranking_factors.price_fit.toFixed(2)} stage_match=${result.ranking_factors.stage_match.toFixed(2)} site_match=${result.ranking_factors.site_match.toFixed(2)}`);

if (result.matched_cases.length > 0) {
  const sampleCase = result.matched_cases[0];
  console.log(`\nsample matched case ${sampleCase.rm_case_id}`);
  console.log(`  tumor_type: ${sampleCase.tumor_type}`);
  console.log(`  primary_tumor_site: ${sampleCase.primary_tumor_site}`);
  console.log(`  stage: ${sampleCase.stage ?? "(none)"}`);
  console.log(`  treatment_status: ${sampleCase.treatment_status ?? "(none)"}`);
  console.log(`  plasma_mL (case-level total): ${sampleCase.plasma_mL ?? 0}`);
  const claimed = result.matched_specimens_per_case.get(sampleCase.rm_case_id) ?? [];
  console.log(`  claimed specimens on this case: ${claimed.length}`);
  for (const s of claimed.slice(0, 3)) {
    console.log(`    - ${s.rm_id}  ${s.specimen_type}  $${s.fee_usd ?? 0}  ${s.tissue_type ?? ""}`);
  }
}

// Second probe — broader: lung cancer, any specimen, no min volume.
const probe: ParsedQuery = {
  diseases: ["lung"],
  specimens: [{ type: "plasma", n_cases: 50 }],
  use_case: "probe",
  raw_query: "probe",
};
const probeResult = ms("\nsearch (broad lung probe)", () => searchRefMed(probe));
console.log(`  matched cases: ${probeResult.matched_cases.length}`);
for (const cov of probeResult.per_type_coverage) {
  console.log(`  ${cov.requested_type}: ${cov.matched_n}/${cov.requested_n}`);
}
