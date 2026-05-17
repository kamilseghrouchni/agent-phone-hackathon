import { generateObject } from "ai";
import { anthropic, hasLLMKey } from "@/lib/ai/anthropic";
import { z } from "zod";
import { db } from "@/lib/db";
import { canonicalize, type SpecimenFilters } from "@/lib/filters";
import { listAllAssays } from "@/lib/catalogs";
import type { ParsedField, Clarifier, ParseResult, DetectedAssay } from "./types";

export const runtime = "nodejs";
export const maxDuration = 30;

const llmFiltersSchema = z.object({
  indication: z.array(z.string()).optional(),
  specimen_types: z.array(z.string()).optional(),
  anatomy: z.array(z.string()).optional(),
  preservation: z.array(z.string()).optional(),
  treatment_status: z.enum(["naive", "any", "post"]).optional(),
  age_range: z.tuple([z.number().nullable(), z.number().nullable()]).optional(),
  countries: z.array(z.string()).optional(),
  matched_pairs_required: z.boolean().optional(),
  longitudinal: z.boolean().optional(),
  min_n: z.number().nullable().optional(),
  parsed_text: z.string().describe("One-sentence rephrase of the request in plain English (max 120 chars)."),
  inferred_keys: z.array(z.string()).describe(
    "Filter keys you set as a soft inference rather than from explicit user mention. E.g. if 'FFPE' was said, preservation is stated; if you guessed 'Tissue' from 'tumor', specimen_types is inferred."
  ),
});

const PARSE_SYSTEM = `You parse biospecimen sourcing requests into structured filters.

Catalog facts (use to ground your output, do not invent things outside it):
- 18 institutes, ~487k specimens, ~161k donors.
- Specimen types we have: Tissue, Plasma, Serum, Urine, DNA, RNA, PBMCs, Buffy coat.
- Preservation values: Frozen, Fixed (FFPE), Cryopreservation, Fresh, RNA-stabilizing Solution.
- Top countries: USA, Ukraine (UKR), Canada, Netherlands, Turkey, France.
- Synonym hints: "MM"→multiple myeloma, "BMMC"→bone marrow, "FFPE"→preservation Fixed + Tissue, "TNBC"→triple-negative breast cancer.

Rules:
- Pull only what the user actually said. Use "inferred_keys" to mark fields that you guessed (e.g., specimen_types: Tissue inferred from "tumor").
- Do NOT fabricate counts, dates, or hard-negatives.
- "longitudinal" / "multi-timepoint" / "across visits" → longitudinal: true (mark as stated).
- Keep parsed_text to one short sentence — what they want, in plain English.
`;

export async function POST(req: Request) {
  const { query } = (await req.json()) as { query: string };
  if (!query || !query.trim()) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  let filters: SpecimenFilters = {};
  let parsedText = query.trim().slice(0, 120);
  let inferredKeys: string[] = [];

  if (hasLLMKey()) {
    try {
      const { object } = await generateObject({
        model: anthropic("claude-haiku-4-5-20251001"),
        system: PARSE_SYSTEM,
        prompt: `User request:\n"""${query}"""\n\nReturn the structured parse.`,
        schema: llmFiltersSchema,
      });
      const { parsed_text, inferred_keys, ...rest } = object;
      parsedText = parsed_text || parsedText;
      inferredKeys = inferred_keys || [];
      filters = rest as SpecimenFilters;
    } catch (e) {
      // Fall through to deterministic parse
      filters = naiveParse(query);
    }
  } else {
    filters = naiveParse(query);
  }

  filters = canonicalize(filters);
  const fields = buildFields(filters, query, inferredKeys);
  let assays = detectAssays(query);
  if (assays.length === 0) {
    assays = inferAssaysFromContext(filters, query);
  }
  const facets = computeFacets(filters);
  const clarifiers = pickClarifiers(filters, facets, assays);

  return Response.json({
    parsed_text: parsedText,
    filters,
    fields,
    assays,
    clarifiers,
    facets,
  } satisfies ParseResult);
}

/**
 * Match the query against our 30-row assay catalog.
 * Stated = a direct keyword match. Inferred = implied by context (e.g.
 * "biomarker discovery on plasma" -> proteomics + metabolomics).
 */
function detectAssays(query: string): DetectedAssay[] {
  const t = query.toLowerCase();
  const catalog = listAllAssays();
  const out: DetectedAssay[] = [];
  const seen = new Set<string>();

  // Synonyms → canonical specific_assay name from the catalog.
  const synonyms: { pattern: RegExp; assay: string; reason: string }[] = [
    { pattern: /\bwgs\b|whole.?genome.?sequenc/i, assay: "Whole genome sequencing (WGS)", reason: "WGS / whole-genome sequencing" },
    { pattern: /\bwes\b|whole.?exome/i, assay: "Whole exome sequencing (WES)", reason: "WES / whole-exome" },
    { pattern: /panel.?seq|targeted.?(gene|panel)|foundation.?one|tempus|caris|msk.?impact/i, assay: "Targeted gene panel sequencing", reason: "targeted panel sequencing" },
    { pattern: /cfdna|liquid.?biopsy|circulating.?tumor.?dna|ctdna(?!.*methylation)/i, assay: "Cell-free DNA / liquid biopsy DNA", reason: "cfDNA / liquid biopsy" },
    { pattern: /long.?read|nanopore|pacbio|hifi/i, assay: "Long-read sequencing", reason: "long-read sequencing" },
    { pattern: /snp.?array|genotyping.?array|gwas.?array/i, assay: "SNP genotyping array", reason: "SNP genotyping" },
    { pattern: /epic.?array|methylationepic|methylation.?array|infinium.?methylation/i, assay: "Methylation array (EPIC)", reason: "EPIC methylation array" },
    { pattern: /\bwgbs\b|whole.?genome.?bisulfite|bisulfite.?sequenc/i, assay: "Whole genome bisulfite sequencing (WGBS)", reason: "bisulfite sequencing" },
    { pattern: /ctdna.?methylation|cell.?free.?methylation|liquid.?biopsy.?methylation/i, assay: "ctDNA methylation profiling", reason: "ctDNA methylation" },
    { pattern: /\bdna.?methylation\b|epigenomic|epigenetic|methylation.?profil/i, assay: "Methylation array (EPIC)", reason: "DNA methylation profiling" },
    { pattern: /atac.?seq|chromatin.?accessibility/i, assay: "ATAC-seq", reason: "ATAC-seq / chromatin accessibility" },
    { pattern: /\bbulk.?rna.?seq|rna.?sequencing|rnaseq|transcriptom/i, assay: "Bulk RNA sequencing", reason: "bulk RNA-seq" },
    { pattern: /single.?cell.?rna|scrna.?seq|10x.?chromium/i, assay: "Single-cell RNA sequencing", reason: "single-cell RNA-seq" },
    { pattern: /spatial.?transcriptom|visium|xenium|merfish|cosmx/i, assay: "Spatial transcriptomics", reason: "spatial transcriptomics" },
    { pattern: /nanostring|ncounter|pam50/i, assay: "Targeted RNA panel (nCounter)", reason: "NanoString nCounter" },
    { pattern: /\bmir.?seq|microrna|small.?rna.?seq/i, assay: "miRNA / small RNA sequencing", reason: "miRNA / small RNA" },
    { pattern: /\b(lc.?ms|mass.?spec).?proteomic|dia.?ms|tmt|orbitrap/i, assay: "LC-MS/MS proteomics (DIA/TMT)", reason: "LC-MS proteomics" },
    { pattern: /olink|proximity.?extension/i, assay: "Olink (PEA panels)", reason: "Olink PEA" },
    { pattern: /somascan|aptamer/i, assay: "SomaScan (aptamer)", reason: "SomaScan" },
    { pattern: /luminex|xmap|meso.?scale|msd|multiplex.?immunoassay|cytokine.?panel/i, assay: "Multiplex immunoassay", reason: "multiplex immunoassay" },
    { pattern: /cytof|mass.?cytometry(?!.*imag)/i, assay: "Mass cytometry (CyTOF)", reason: "mass cytometry / CyTOF" },
    { pattern: /metabolomic(?!.*targeted)|metabolon/i, assay: "Untargeted LC-MS metabolomics", reason: "untargeted metabolomics" },
    { pattern: /targeted.?metabolomic|biocrates|absoluteidq/i, assay: "Targeted metabolomics", reason: "targeted metabolomics" },
    { pattern: /\bnmr\b|nightingale/i, assay: "NMR metabolomics", reason: "NMR metabolomics" },
    { pattern: /lipidom|lipotype/i, assay: "Lipidomics", reason: "lipidomics" },
    { pattern: /16s.?rrna|microbiome|gut.?flora/i, assay: "16S rRNA gene sequencing", reason: "16S microbiome" },
    { pattern: /shotgun.?metagenom|metagenomic.?sequenc/i, assay: "Shotgun metagenomics", reason: "shotgun metagenomics" },
    { pattern: /tcr.?seq|t.?cell.?receptor.?seq|immunoseq|clonoseq/i, assay: "T-cell receptor sequencing", reason: "TCR sequencing" },
    { pattern: /flow.?cytometry|facs/i, assay: "Flow cytometry", reason: "flow cytometry" },
    { pattern: /multiplex.?(if|immunofluoresc)|codex|phenocycler|akoya/i, assay: "Multiplex immunofluorescence", reason: "multiplex IF" },
    { pattern: /imaging.?mass.?cytometry|hyperion|imc(?!.+\w)/i, assay: "Imaging mass cytometry", reason: "imaging mass cytometry" },
  ];

  for (const { pattern, assay, reason } of synonyms) {
    if (!pattern.test(t)) continue;
    if (seen.has(assay)) continue;
    const catalogHit = catalog.find((a) => a.specific_assay === assay);
    if (!catalogHit) continue;
    seen.add(assay);
    out.push({
      assay: catalogHit.specific_assay,
      family: catalogHit.assay_family,
      source: "stated",
      reason,
    });
  }

  return out;
}

/**
 * When no assay is stated, infer 1-3 likely candidates from the indication
 * and specimen type. The user can edit before continuing to the bundle.
 */
function inferAssaysFromContext(f: SpecimenFilters, query: string): DetectedAssay[] {
  const catalog = listAllAssays();
  const t = query.toLowerCase();
  const ind = (f.indication ?? []).join(" ").toLowerCase();
  const spec = (f.specimen_types ?? []).join(" ").toLowerCase();
  const isOnc = /melanoma|carcinoma|cancer|myeloma|lymphoma|leukemia|sarcoma|tumor|onco|neoplasm/.test(ind);
  const isNeuro = /alzheimer|parkinson|als|huntingt|neuro|dementia|cognitive/.test(ind);
  const isCardio = /cardio|heart|coronary|stroke|atheroscler/.test(ind);
  const isBiomarker = /biomarker|discovery|profil/.test(t);

  const presList = Array.isArray(f.preservation) ? f.preservation : f.preservation ? [f.preservation] : [];
  const isFFPE = presList.some((p) => /fixed|ffpe/i.test(String(p)));
  const isFrozen = presList.some((p) => /frozen|cryo/i.test(String(p)));
  const isTissue = /tissue/.test(spec) || isFFPE || isFrozen;
  const isPlasma = /plasma/.test(spec);
  const isSerum = /serum/.test(spec);
  const isCSF = /csf|spinal/.test(spec) || /cerebrospinal/.test(t);

  const picks: { assay: string; reason: string }[] = [];
  if (isOnc && isTissue) {
    picks.push({ assay: "Targeted gene panel sequencing", reason: "oncology tissue → panel seq" });
    picks.push({ assay: "Bulk RNA sequencing", reason: "oncology tissue → RNA-seq" });
    picks.push({ assay: "Methylation array (EPIC)", reason: "oncology tissue → methylation profiling" });
  } else if (isOnc && isPlasma) {
    picks.push({ assay: "Cell-free DNA / liquid biopsy DNA", reason: "oncology plasma → cfDNA" });
    picks.push({ assay: "ctDNA methylation profiling", reason: "oncology plasma → ctDNA methylation" });
  } else if (isNeuro && isCSF) {
    picks.push({ assay: "LC-MS/MS proteomics (DIA/TMT)", reason: "neuro CSF → proteomics" });
    picks.push({ assay: "Targeted metabolomics", reason: "neuro CSF → targeted metabolomics" });
  } else if (isNeuro && (isPlasma || isSerum)) {
    picks.push({ assay: "Olink (PEA panels)", reason: "neuro plasma → Olink" });
    picks.push({ assay: "NMR metabolomics", reason: "neuro plasma → NMR" });
  } else if (isCardio && (isPlasma || isSerum)) {
    picks.push({ assay: "NMR metabolomics", reason: "cardio plasma → NMR" });
    picks.push({ assay: "Olink (PEA panels)", reason: "cardio plasma → Olink" });
  } else if (isBiomarker && (isPlasma || isSerum)) {
    picks.push({ assay: "LC-MS/MS proteomics (DIA/TMT)", reason: "biomarker plasma → proteomics" });
    picks.push({ assay: "Untargeted LC-MS metabolomics", reason: "biomarker plasma → metabolomics" });
  }

  const out: DetectedAssay[] = [];
  for (const { assay, reason } of picks) {
    const hit = catalog.find((a) => a.specific_assay === assay);
    if (!hit) continue;
    out.push({
      assay: hit.specific_assay,
      family: hit.assay_family,
      source: "inferred",
      reason,
    });
  }
  return out;
}

function naiveParse(q: string): SpecimenFilters {
  const t = q.toLowerCase();
  const f: SpecimenFilters = {};
  const indMap: Record<string, string> = {
    melanoma: "melanoma",
    "multiple myeloma": "multiple myeloma",
    " mm ": "multiple myeloma",
    lymphoma: "lymphoma",
    "follicular lymphoma": "follicular lymphoma",
    "triple-negative breast cancer": "triple-negative breast cancer",
    tnbc: "triple-negative breast cancer",
    "breast cancer": "breast cancer",
    "lung cancer": "lung cancer",
    parkinson: "parkinson",
    alzheimer: "alzheimer",
    "lung scc": "lung squamous cell carcinoma",
    "ductal carcinoma": "invasive ductal carcinoma",
    idc: "invasive ductal carcinoma",
  };
  for (const [k, v] of Object.entries(indMap)) {
    if (t.includes(k)) {
      f.indication = Array.from(new Set([...(f.indication ?? []), v]));
    }
  }
  if (/ffpe|fixed/.test(t)) f.preservation = "Fixed";
  if (/frozen|cryo/.test(t)) f.preservation = (f.preservation ? [f.preservation as string, "Frozen"] : "Frozen") as any;
  if (/plasma/.test(t)) f.specimen_types = [...(f.specimen_types ?? []), "Plasma"];
  if (/serum/.test(t)) f.specimen_types = [...(f.specimen_types ?? []), "Serum"];
  if (/tissue|tumor|biopsy/.test(t)) f.specimen_types = [...(f.specimen_types ?? []), "Tissue"];
  if (/pbmc/.test(t)) f.specimen_types = [...(f.specimen_types ?? []), "Peripheral blood mononuclear cells (PBMCs)"];
  if (/longitudinal|multi.?timepoint|over time|across visits/.test(t)) f.longitudinal = true;
  if (/treatment.?naive|untreated/.test(t)) f.treatment_status = "naive";
  if (/matched (plasma|serum|tumor|tissue)|paired (plasma|serum|tumor|tissue)/.test(t)) f.matched_pairs_required = true;
  const nMatch = t.match(/(?:n[≥>=\s]*|need[a-z\s]*)(\d{2,5})/);
  if (nMatch) f.min_n = parseInt(nMatch[1], 10);
  return f;
}

function buildFields(f: SpecimenFilters, raw: string, inferredKeys: string[]): ParsedField[] {
  const t = raw.toLowerCase();
  const inf = new Set(inferredKeys);
  const fields: ParsedField[] = [];
  const stated = (key: string, txt: string): "stated" | "inferred" => {
    if (inf.has(key)) return "inferred";
    if (txt && t.includes(txt.toLowerCase())) return "stated";
    return "inferred";
  };

  if (f.indication?.length) {
    const v = f.indication.join(", ");
    fields.push({ key: "indication", label: "Indication", value: v, source: stated("indication", f.indication[0]) });
  }
  if (f.specimen_types?.length) {
    fields.push({
      key: "specimen_types",
      label: "Specimen type",
      value: f.specimen_types.join(" + "),
      source: stated("specimen_types", f.specimen_types[0]),
    });
  }
  const presList = Array.isArray(f.preservation) ? f.preservation : f.preservation ? [f.preservation] : [];
  if (presList.length) {
    fields.push({
      key: "preservation",
      label: "Preservation",
      value: presList.join(" / "),
      source: stated("preservation", presList[0]),
    });
  }
  if (f.matched_pairs_required) {
    fields.push({
      key: "matched_pairs_required",
      label: "Matched pairs",
      value: "yes — paired specimens per donor",
      source: stated("matched_pairs_required", "matched"),
    });
  }
  if (f.longitudinal) {
    fields.push({
      key: "longitudinal",
      label: "Longitudinal",
      value: "yes — multi-visit donors",
      source: stated("longitudinal", "longitudinal"),
    });
  }
  if (f.treatment_status && f.treatment_status !== "any") {
    fields.push({
      key: "treatment_status",
      label: "Treatment status",
      value: f.treatment_status,
      source: stated("treatment_status", f.treatment_status),
    });
  }
  if (f.age_range && (f.age_range[0] != null || f.age_range[1] != null)) {
    const lo = f.age_range[0],
      hi = f.age_range[1];
    fields.push({
      key: "age_range",
      label: "Age",
      value: lo != null && hi != null ? `${lo}–${hi}` : lo != null ? `≥ ${lo}` : `≤ ${hi}`,
      source: stated("age_range", "age"),
    });
  }
  if (f.countries?.length) {
    fields.push({
      key: "countries",
      label: "Region",
      value: f.countries.join(", "),
      source: stated("countries", f.countries[0]),
    });
  }
  if (f.min_n != null) {
    fields.push({
      key: "min_n",
      label: "Sample size",
      value: `≥ ${f.min_n}`,
      source: stated("min_n", String(f.min_n)),
    });
  }
  return fields;
}

function computeFacets(f: SpecimenFilters): ParseResult["facets"] {
  const conn = db();
  const totals = conn
    .prepare(
      `SELECT COUNT(*) AS s, COUNT(DISTINCT donor_id) AS d, COUNT(DISTINCT organization_id) AS o FROM specimen_join_keys`
    )
    .get() as { s: number; d: number; o: number };

  // Build a coarse filter to estimate match count, using only fields already set.
  const conds: string[] = [];
  const params: any[] = [];
  if (f.specimen_types?.length) {
    conds.push(`s.specimen_type IN (${f.specimen_types.map(() => "?").join(",")})`);
    params.push(...f.specimen_types);
  }
  if (f.preservation) {
    const pres = Array.isArray(f.preservation) ? f.preservation : [f.preservation];
    conds.push(`s.preservation_category IN (${pres.map(() => "?").join(",")})`);
    params.push(...pres);
  }
  if (f.countries?.length) {
    conds.push(`s.country IN (${f.countries.map(() => "?").join(",")})`);
    params.push(...f.countries);
  }
  // Skip indication for the coarse estimate — it requires FTS join and we want speed.
  let estimated: number | null = null;
  if (conds.length) {
    const row = conn
      .prepare(`SELECT COUNT(*) AS n FROM specimen_join_keys s WHERE ${conds.join(" AND ")}`)
      .get(...params) as { n: number };
    estimated = row.n;
  }

  const top_specimen_types = (conn
    .prepare(
      `SELECT specimen_type AS name, COUNT(*) AS count FROM specimen_join_keys GROUP BY specimen_type ORDER BY count DESC LIMIT 5`
    )
    .all() as { name: string | null; count: number }[])
    .filter((r) => r.name)
    .map((r) => ({ name: r.name as string, count: r.count }));

  const top_countries = (conn
    .prepare(
      `SELECT country AS name, COUNT(*) AS count FROM specimen_join_keys GROUP BY country ORDER BY count DESC LIMIT 5`
    )
    .all() as { name: string | null; count: number }[])
    .filter((r) => r.name)
    .map((r) => ({ name: r.name as string, count: r.count }));

  return {
    total_specimens: totals.s,
    total_donors: totals.d,
    total_institutes: totals.o,
    estimated_match: estimated,
    top_specimen_types,
    top_countries,
  };
}

function pickClarifiers(f: SpecimenFilters, facets: ParseResult["facets"], assays: DetectedAssay[]): Clarifier[] {
  const out: Clarifier[] = [];

  // 1. Sample-size target — almost always missing; sets expectations.
  if (f.min_n == null) {
    out.push({
      id: "min_n",
      question: "How many samples do you need?",
      why: "Drives whether the catalog covers you or we have to commission. Default fits a typical pilot.",
      proposed_label: "≥ 50 samples",
      proposed_value: 50,
      target_field: "min_n",
      options: [
        { label: "≥ 25", value: 25 },
        { label: "≥ 50", value: 50 },
        { label: "≥ 100", value: 100 },
        { label: "≥ 250", value: 250 },
      ],
    });
  }

  // 2. Region preference — surface real top-3 from data.
  if (!f.countries?.length) {
    const topNames = facets.top_countries.slice(0, 3).map((c) => c.name).join(", ");
    out.push({
      id: "country_pref",
      question: "Region preference?",
      why: `Top regions in our catalog are ${topNames}. EU jurisdictions often need extra consent paperwork.`,
      proposed_label: "Any region",
      proposed_value: null,
      target_field: "countries",
      options: [
        { label: "Any", value: null },
        { label: "USA only", value: "USA" },
        { label: "Outside USA", value: "non-USA" },
      ],
    });
  }

  // 3. Treatment-naive — only if oncology indication & not already set.
  const isOnc = (f.indication ?? []).some((i) =>
    /melanoma|carcinoma|cancer|myeloma|lymphoma|leukemia|sarcoma|tumor|onco/.test(i.toLowerCase())
  );
  if (isOnc && !f.treatment_status) {
    out.push({
      id: "treatment_naive",
      question: "Treatment-naive donors only?",
      why: "Mixed-treatment cohorts can confound discovery work. We can filter to treatment-naive on intake.",
      proposed_label: "No — any treatment status",
      proposed_value: "any",
      target_field: "treatment_status",
      options: [
        { label: "Any", value: "any" },
        { label: "Naive only", value: "naive" },
      ],
    });
  }

  // 4. Direct contact — quietly default ON for this MVP.
  if (f.has_contact_email == null && out.length < 3) {
    out.push({
      id: "contact_email",
      question: "Only institutes with a direct contact email?",
      why: "Cuts the list to ones we can outreach immediately. Most of our 18 institutes have contacts on file.",
      proposed_label: "Yes — only institutes with contacts",
      proposed_value: true,
      target_field: "has_contact_email",
      options: [
        { label: "Yes — must have contact", value: true },
        { label: "No — include any", value: false },
      ],
    });
  }

  return out.slice(0, 3);
}
