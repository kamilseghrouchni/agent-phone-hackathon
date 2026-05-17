---
name: vcro-cohort-map
description: "Cohort intelligence search and extraction. Searches PubMed, Europe PMC, and ClinicalTrials.gov, then extracts deep scope-driven intelligence from paper sections. Use when a request.json exists and cohorts need to be discovered and characterized."
---

# vcro-cohort-map

Two phases: search and extract. Search finds candidates. Extract
produces deep intelligence driven by the user's specific needs.

## Phase A: Search

### Step 1 — Initial parallel search

Run three sources simultaneously. Use --cache_dir for the run's store.

PubMed:
```bash
python3 {scripts}/pubmed_api.py \
  --queries "[indication] [modality] plasma cohort" \
            "[indication] [modality] blood longitudinal" \
            "[indication] [modality] biomarker" \
  --retmax 15 --cache_dir {store}
```

Europe PMC:
```bash
python3 {scripts}/europepmc_api.py \
  --queries "[indication] [modality] plasma" \
            "[indication] [modality] cohort" \
  --cache_dir {store}
```

ClinicalTrials:
```bash
python3 {scripts}/clinicaltrials_api.py \
  --condition "[indication]" \
  --terms "[modality] plasma" "blood biomarker longitudinal" \
  --top_n 15 --cache_dir {store}
```

### Step 2 — Adaptive expansion (mandatory, not optional)

Read initial results. From titles and authors, identify:
- Author last names who appear in multiple papers
- Named cohort references (ADNI, UK Biobank, AIBL, etc)
- Modality-specific terms

Run targeted expansion queries:
- Author + indication: "Kaddurah-Daouk Alzheimer metabolomics"
- Cohort + modality: "ADNI lipidomics plasma"
- Recency: "[indication] [modality] 2025" and "2026"

### Step 3 — Extract trial site locations

For ClinicalTrials results, extract hospital/site information:

```json
{
  "nct_id": "NCT00676143",
  "facility": "Massachusetts General Hospital",
  "city": "Boston",
  "country": "United States",
  "enrollment": 1100,
  "status": "TERMINATED"
}
```

Write to `trial_sites.json` in the run folder. This feeds the
sourcing layer downstream (which hospitals have infrastructure
for this indication).

### Step 4 — Save results

Write all results to the run folder as separate JSON files per
source. Deduplicate by PMID where possible.

## Phase B: Extract (scope-driven)

This is the phase that produces the 100x intelligence.

### Input

- List of validated relevant PMC IDs and NCT IDs
- scope_notes from request.json (the brief)
- Intelligence dimensions vocabulary at
  skills/vcro-os/references/intelligence-dimensions.md

### Step 1 — Read the brief

Read scope_notes. Understand what the user actually needs.
Based on this, decide which 5 to 8 intelligence dimensions
to focus on for this run. Different requests need different
dimensions.

### Step 2 — For each cohort source

**For PMC papers:** read cohort.txt, biospecimens.txt,
endpoints_and_modalities.txt, results_primary.txt,
access_and_ownership.txt, and meta.json.

**For ClinicalTrials:** read meta.json which contains
enrollment, biospecimen description, eligibility criteria,
outcomes, facilities, sponsor, PI.

### Step 3 — Extract with implications

For each relevant dimension, extract:

```json
{
  "dimension": "real_numbers",
  "fact": "1,517 participants: 243 stable AD, 413 stable MCI, 337 CN, 329 AD converters",
  "source_quote": "We employed longitudinal lipidomic profiling on 4,730 plasma samples from 1,517 participants",
  "source_file": "cohort.txt",
  "implication": "Usable for model training: 985 AD+MCI. The headline 1,517 includes controls. Your training set for AD progression is the 329 converters."
}
```

Every extraction must have:
- **fact**: the specific data point
- **source_quote**: exact text from the paper (verbatim)
- **source_file**: which section file it came from
- **implication**: what this means for the user's project

Do NOT extract a dimension without an implication.
Do NOT extract all 18 dimensions. Only the ones that matter
for this brief.

### Step 4 — Write output

Write to the run folder:

`extracted_cohorts.json` — array of cohort objects:

```json
{
  "id": "PMC12269576",
  "doi": "10.1016/j.ebiom.2025.105826",
  "pmid": "40592256",
  "title": "Trajectory of plasma lipidome...",
  "first_author": "Wang T",
  "cohorts_named": ["ADNI"],
  "diseases": ["AD"],
  "sample_types": ["plasma"],
  "has_longitudinal": true,
  "usable_n": 985,
  "intelligence": [
    {
      "dimension": "real_numbers",
      "fact": "...",
      "source_quote": "...",
      "source_file": "cohort.txt",
      "implication": "..."
    },
    {
      "dimension": "longitudinal_structure",
      "fact": "...",
      "source_quote": "...",
      "source_file": "cohort.txt",
      "implication": "..."
    }
  ]
}
```

**Structural fields are mandatory on every cohort object.** These
enable downstream filtering without text search. Derive them from
the intelligence dimensions you extracted:

- `diseases`: array of disease names (e.g. ["AD"], ["ALS"], ["AD", "ALS"])
- `sample_types`: array (e.g. ["plasma"], ["CSF", "serum"])
- `has_longitudinal`: boolean
- `usable_n`: integer — the N usable for THIS request, not headline N

## Critical rules

- scope_notes drives everything. If the brief says "model training",
  focus on real numbers, longitudinal structure, effect sizes. If
  the brief says "sample procurement", focus on sample usability,
  access, depletion.
- Every fact needs a source_quote. No claims without textual evidence.
- Every fact needs an implication. No facts without "which means..."
- Reviews, editorials, and papers with no primary cohort should have
  been filtered by vcro-validate. If one slips through, flag it
  and skip extraction.
- Adaptive expansion in search is mandatory. Not running expansion
  queries is a pipeline failure.

## Model allocation

- Search phase: Haiku (runs scripts, reads results, decides expansion)
- Extract phase: Sonnet (reads full text, makes judgment calls on
  dimensions and implications)
- Extract must be BATCHED: split papers into groups of 10, run in
  parallel. A single 30-paper extraction job is not acceptable
  (13 minutes of silence, no crash recovery).

## Tools available

- `store_query.py` — query extracted_cohorts.json or other run
  artifacts without loading entire files
- `store_search.py` — semantic search over paper sections in the store
