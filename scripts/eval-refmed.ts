// Evaluation set for the RefMed search engine.
//
// Each case is a (ParsedQuery, expectations) pair. Expectations are typed
// — they include both hard assertions (must pass) and soft probes (print
// for eyeball review). Run with:
//
//   npx tsx scripts/eval-refmed.ts
//
// Exit code is 0 if all hard assertions pass, 1 otherwise. JSON results
// land at store/eval/refmed-eval-<timestamp>.json so we can diff regressions.

import fs from "fs";
import path from "path";
import { loadRefMed } from "../src/lib/search/refmed-loader";
import { searchRefMed, type SearchResult } from "../src/lib/search/search-engine";
import type { ParsedQuery } from "../src/types/parsed-query";

type Assert = (r: SearchResult) => string | null; // null = pass, string = failure reason

interface EvalCase {
  name: string;
  query: ParsedQuery;
  asserts: Assert[];
  // soft probes — surfaces a value to eyeball but does not fail
  probes?: ((r: SearchResult) => string)[];
}

// --- assertion helpers ---------------------------------------------------

const matchedCasesBetween = (min: number, max: number): Assert => (r) =>
  r.matched_cases.length >= min && r.matched_cases.length <= max
    ? null
    : `matched_cases=${r.matched_cases.length}, expected ${min}..${max}`;

const matchedExactly = (n: number): Assert => (r) =>
  r.matched_cases.length === n ? null : `matched_cases=${r.matched_cases.length}, expected ${n}`;

const allCasesPrimarySite = (substr: string): Assert => (r) => {
  const offenders = r.matched_cases.filter(
    (c) => !c.primary_tumor_site.toLowerCase().includes(substr.toLowerCase()),
  );
  return offenders.length === 0
    ? null
    : `${offenders.length} cases had primary_tumor_site outside "${substr}" (e.g. ${offenders
        .slice(0, 3)
        .map((c) => c.rm_case_id + ":" + c.primary_tumor_site)
        .join(", ")})`;
};

const allCasesStageStartsWith = (stagePrefix: string): Assert => (r) => {
  const re = new RegExp(`^${stagePrefix}(?![IV])`);
  const offenders = r.matched_cases.filter((c) => !re.test((c.stage ?? "").toUpperCase()));
  return offenders.length === 0
    ? null
    : `${offenders.length} cases missed stage ${stagePrefix} (e.g. ${offenders
        .slice(0, 3)
        .map((c) => c.rm_case_id + ":" + (c.stage ?? "(none)"))
        .join(", ")})`;
};

const allCasesTreatmentNaive: Assert = (r) => {
  const offenders = r.matched_cases.filter(
    (c) => !(c.treatment_status ?? "").toLowerCase().includes("not treated"),
  );
  return offenders.length === 0
    ? null
    : `${offenders.length} cases were not "Not treated" (e.g. ${offenders
        .slice(0, 3)
        .map((c) => c.rm_case_id + ":" + (c.treatment_status ?? "(none)"))
        .join(", ")})`;
};

const coverageAtLeast = (typeIdx: number, n: number): Assert => (r) => {
  const cov = r.per_type_coverage[typeIdx];
  return cov && cov.matched_n >= n
    ? null
    : `type[${typeIdx}] coverage ${cov?.matched_n ?? "?"} < ${n}`;
};

const coverageExactly = (typeIdx: number, n: number): Assert => (r) => {
  const cov = r.per_type_coverage[typeIdx];
  return cov && cov.matched_n === n
    ? null
    : `type[${typeIdx}] coverage ${cov?.matched_n ?? "?"} !== ${n}`;
};

// Verify the claimed specimens are actually of the requested specimen alias
// + meet min-volume if requested.
const claimedSpecimensConform = (typeIdx: number, allowedTypes: string[], minVolFor?: "plasma" | "serum" | "buffy"): Assert => (r) => {
  const cov = r.per_type_coverage[typeIdx];
  if (!cov) return `no coverage entry at index ${typeIdx}`;
  const ids = new Set(cov.matched_specimen_ids);
  const offenders: string[] = [];
  for (const [, specs] of r.matched_specimens_per_case) {
    for (const s of specs) {
      if (!ids.has(s.rm_id)) continue;
      if (!allowedTypes.includes(s.specimen_type)) {
        offenders.push(`${s.rm_id}:${s.specimen_type}`);
      }
      if (minVolFor) {
        const v =
          minVolFor === "plasma" ? s.plasma_mL ?? 0 : minVolFor === "serum" ? s.serum_mL ?? 0 : s.buffy_coat_mL ?? 0;
        if (v < 2) offenders.push(`${s.rm_id}:vol=${v}`);
      }
    }
  }
  return offenders.length === 0
    ? null
    : `${offenders.length} specimens out of bucket (e.g. ${offenders.slice(0, 3).join(", ")})`;
};

const noNSCLCFalsePositive: Assert = (r) => {
  // Lung primary, NOT small cell carcinoma (without "non-small cell")
  const offenders = r.matched_cases.filter((c) => {
    const t = c.tumor_type.toLowerCase();
    const isLungPrimary = c.primary_tumor_site.toLowerCase().startsWith("lung");
    if (!isLungPrimary) return true; // any non-lung case in NSCLC bucket is wrong
    if (t.includes("small cell") && !t.includes("non-small cell")) return true; // SCLC
    return false;
  });
  return offenders.length === 0
    ? null
    : `${offenders.length} NSCLC false-positives (e.g. ${offenders.slice(0, 3).map((c) => c.rm_case_id + ":" + c.primary_tumor_site + "/" + c.tumor_type).join(" | ")})`;
};

const matchedSetHasBoth = (kind: "tumor+adjacent_normal"): Assert => (r) => {
  const { specimensByCase } = loadRefMed();
  const offenders: string[] = [];
  for (const c of r.matched_cases) {
    const specs = specimensByCase.get(c.rm_case_id) ?? [];
    const hasTumor = specs.some((s) => (s.tissue_type ?? "").toLowerCase().includes("tumor, malignant"));
    const hasNormal = specs.some((s) => (s.tissue_type ?? "").toLowerCase().includes("normal"));
    if (kind === "tumor+adjacent_normal" && !(hasTumor && hasNormal)) {
      offenders.push(c.rm_case_id);
    }
  }
  return offenders.length === 0 ? null : `${offenders.length} matched cases missing matched-set (e.g. ${offenders.slice(0, 3).join(", ")})`;
};

// --- the eval set --------------------------------------------------------

const cases: EvalCase[] = [
  {
    name: "NSCLC primary — no metastasis false-positives",
    query: {
      diseases: ["NSCLC"],
      specimens: [
        { type: "plasma", n_cases: 150, min_volume_mL: 2 },
        { type: "FFPE block", n_cases: 75 },
      ],
      use_case: "biomarker validation",
      raw_query: "150 plasma + 75 FFPE NSCLC",
    },
    asserts: [
      matchedCasesBetween(150, 400),
      noNSCLCFalsePositive,
      coverageAtLeast(1, 75),
      claimedSpecimensConform(0, ["Plasma", "Matched plasma & buffy set", "Liquid biopsy set"], "plasma"),
      claimedSpecimensConform(1, ["Paraffin block"]),
    ],
    probes: [(r) => `coverage: ${r.per_type_coverage.map((c) => `${c.requested_type}=${c.matched_n}/${c.requested_n}`).join(", ")} — $${r.total_est_usd.toLocaleString()}`],
  },

  {
    name: "Breast cancer FFPE — common disease, common specimen",
    query: {
      diseases: ["breast"],
      specimens: [{ type: "FFPE block", n_cases: 50 }],
      use_case: "IHC validation",
      raw_query: "50 breast FFPE",
    },
    asserts: [
      matchedCasesBetween(50, 1000),
      allCasesPrimarySite("breast"),
      coverageExactly(0, 50),
    ],
  },

  {
    name: "Pancreatic plasma — rarer disease, niche specimen",
    query: {
      diseases: ["pancreas"],
      specimens: [{ type: "plasma", n_cases: 30 }],
      use_case: "early detection",
      raw_query: "30 pancreatic plasma",
    },
    asserts: [
      matchedCasesBetween(1, 500),
      allCasesPrimarySite("pancreas"),
    ],
    probes: [(r) => `plasma coverage ${r.per_type_coverage[0].matched_n}/${r.per_type_coverage[0].requested_n}`],
  },

  {
    name: "Colorectal cancer — should NOT bleed into lung metastases",
    query: {
      diseases: ["colon"],
      specimens: [{ type: "FFPE block", n_cases: 20 }],
      use_case: "any",
      raw_query: "20 colon FFPE",
    },
    asserts: [
      matchedCasesBetween(10, 2000),
      allCasesPrimarySite("colon"),
    ],
  },

  {
    name: "Prostate stage IV — stage filter",
    query: {
      diseases: ["prostate"],
      stages: ["IV"],
      specimens: [{ type: "plasma", n_cases: 10 }],
      use_case: "late-stage biomarker",
      raw_query: "stage IV prostate plasma",
    },
    asserts: [
      allCasesPrimarySite("prostate"),
      allCasesStageStartsWith("IV"),
    ],
  },

  {
    name: "Treatment-naive lung — treatment filter",
    query: {
      diseases: ["lung"],
      treatment_status: "naive",
      specimens: [{ type: "plasma", n_cases: 30 }],
      use_case: "baseline cohort",
      raw_query: "treatment-naive lung plasma",
    },
    asserts: [
      allCasesPrimarySite("lung"),
      allCasesTreatmentNaive,
    ],
  },

  {
    name: "PBMC request — buffy coat alias",
    query: {
      diseases: ["lung"],
      specimens: [{ type: "PBMC", n_cases: 20 }],
      use_case: "single-cell",
      raw_query: "20 lung PBMC",
    },
    asserts: [
      claimedSpecimensConform(0, ["Buffy coat", "Matched plasma & buffy set"]),
    ],
  },

  {
    name: "Frozen tissue request — alias correctness",
    query: {
      diseases: ["lung"],
      specimens: [{ type: "frozen tissue", n_cases: 10 }],
      use_case: "snap-frozen for transcriptomics",
      raw_query: "10 lung snap-frozen",
    },
    asserts: [
      claimedSpecimensConform(0, ["Frozen -80C (snap frozen)"]),
    ],
    probes: [(r) => `frozen coverage ${r.per_type_coverage[0].matched_n}/${r.per_type_coverage[0].requested_n}`],
  },

  {
    name: "Plasma min_volume_mL=10 — strict volume filter",
    query: {
      diseases: ["lung"],
      specimens: [{ type: "plasma", n_cases: 50, min_volume_mL: 10 }],
      use_case: "multi-assay split",
      raw_query: "50 lung plasma, 10mL min",
    },
    asserts: [
      (r) => {
        const { specimensByCase } = loadRefMed();
        const cov = r.per_type_coverage[0];
        const ids = new Set(cov.matched_specimen_ids);
        for (const [, specs] of specimensByCase) {
          for (const s of specs) {
            if (ids.has(s.rm_id) && (s.plasma_mL ?? 0) < 10) {
              return `specimen ${s.rm_id} has plasma_mL=${s.plasma_mL}, below 10`;
            }
          }
        }
        return null;
      },
    ],
    probes: [(r) => `met volume cap: ${r.per_type_coverage[0].matched_n}/${r.per_type_coverage[0].requested_n}`],
  },

  {
    name: "Matched tumor+adjacent normal — pair requirement",
    query: {
      diseases: ["breast"],
      matched_set_required: ["tumor+adjacent_normal"],
      specimens: [{ type: "FFPE block", n_cases: 10 }],
      use_case: "paired tumor/normal",
      raw_query: "10 breast tumor+normal pairs FFPE",
    },
    asserts: [matchedSetHasBoth("tumor+adjacent_normal")],
    probes: [(r) => `paired cases: ${r.matched_cases.length}`],
  },

  {
    name: "Nonexistent disease — should return 0",
    query: {
      diseases: ["zombie virus syndrome"],
      specimens: [{ type: "plasma", n_cases: 10 }],
      use_case: "edge case",
      raw_query: "10 zombie virus plasma",
    },
    asserts: [matchedExactly(0)],
  },

  {
    name: "Empty disease filter — broad sweep, any FFPE",
    query: {
      diseases: [],
      specimens: [{ type: "FFPE block", n_cases: 100 }],
      use_case: "broad sourcing",
      raw_query: "100 FFPE any cancer",
    },
    asserts: [
      matchedCasesBetween(500, 5000),
      coverageExactly(0, 100),
    ],
  },

  {
    name: "Multi-specimen ask — plasma + serum + FFPE",
    query: {
      diseases: ["lung"],
      specimens: [
        { type: "plasma", n_cases: 30 },
        { type: "serum", n_cases: 20 },
        { type: "FFPE block", n_cases: 30 },
      ],
      use_case: "multi-omics",
      raw_query: "lung multi-specimen",
    },
    asserts: [
      claimedSpecimensConform(0, ["Plasma", "Matched plasma & buffy set", "Liquid biopsy set"]),
      claimedSpecimensConform(1, ["Serum"]),
      claimedSpecimensConform(2, ["Paraffin block"]),
    ],
    probes: [(r) => `coverage: ${r.per_type_coverage.map((c) => `${c.requested_type}=${c.matched_n}/${c.requested_n}`).join(", ")}`],
  },

  {
    name: "Stage I disease — early-stage filter",
    query: {
      diseases: ["lung"],
      stages: ["I"],
      specimens: [{ type: "FFPE block", n_cases: 20 }],
      use_case: "early detection",
      raw_query: "stage I lung FFPE",
    },
    asserts: [
      allCasesPrimarySite("lung"),
      allCasesStageStartsWith("I"),
    ],
  },

  {
    name: "Benign tumor — non-cancer",
    query: {
      diseases: ["meningioma"],
      specimens: [{ type: "FFPE block", n_cases: 5 }],
      use_case: "benign control",
      raw_query: "5 meningioma FFPE",
    },
    asserts: [
      (r) =>
        r.matched_cases.every((c) => (c.tumor_type + " " + c.pathologic_diagnosis).toLowerCase().includes("meningioma"))
          ? null
          : `some matched cases lacked 'meningioma' in tumor_type/dx`,
    ],
    probes: [(r) => `meningioma cases: ${r.matched_cases.length}`],
  },
];

// --- runner --------------------------------------------------------------

interface CaseResult {
  name: string;
  matched_cases: number;
  coverage: { type: string; n: number; req: number }[];
  total_usd: number;
  passes: { description: string; ok: boolean; reason: string | null }[];
  probes: string[];
  ms: number;
}

console.log("Warm-up: loading RefMed...");
const tLoad = Date.now();
loadRefMed();
console.log(`  loaded in ${Date.now() - tLoad}ms\n`);

const results: CaseResult[] = [];
let failures = 0;

for (const c of cases) {
  const t = Date.now();
  const r = searchRefMed(c.query);
  const elapsed = Date.now() - t;
  const passes = c.asserts.map((a, i) => {
    const reason = a(r);
    if (reason !== null) failures++;
    return { description: `assert#${i}`, ok: reason === null, reason };
  });
  const probes = (c.probes ?? []).map((p) => p(r));
  results.push({
    name: c.name,
    matched_cases: r.matched_cases.length,
    coverage: r.per_type_coverage.map((p) => ({ type: p.requested_type, n: p.matched_n, req: p.requested_n })),
    total_usd: r.total_est_usd,
    passes,
    probes,
    ms: elapsed,
  });
}

// --- print summary -------------------------------------------------------

const pad = (s: string, w: number) => (s + " ".repeat(w)).slice(0, w);

console.log("RESULTS\n");
console.log(pad("status", 8) + pad("ms", 5) + pad("matched", 9) + pad("case", 60) + "coverage");
console.log("-".repeat(110));

for (const r of results) {
  const allOk = r.passes.every((p) => p.ok);
  const cov = r.coverage.map((c) => `${c.type}:${c.n}/${c.req}`).join(" ");
  console.log(
    pad(allOk ? "PASS" : "FAIL", 8) +
      pad(`${r.ms}`, 5) +
      pad(`${r.matched_cases}`, 9) +
      pad(r.name, 60) +
      cov,
  );
  if (!allOk) {
    for (const p of r.passes) {
      if (!p.ok) console.log(`         ↳ ${p.description}: ${p.reason}`);
    }
  }
  for (const probe of r.probes) {
    console.log(`         · ${probe}`);
  }
}

console.log("\n" + "-".repeat(110));
console.log(`${results.length - failures}/${results.length} assertions clean — ${failures} failure(s)`);

// Persist for diffing
const outDir = path.join(process.cwd(), "store/eval");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outPath = path.join(outDir, `refmed-eval-${stamp}.json`);
fs.writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`saved → ${outPath}`);

process.exit(failures === 0 ? 0 : 1);
