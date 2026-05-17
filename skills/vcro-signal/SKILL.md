---
name: vcro-signal
description: "Evidence signal extraction. Reads results and limitations sections to extract what was shown, how strong, and what it means for the user project. Use when top cohorts are identified and the user needs evidence assessment."
---

# vcro-signal

Answer: "what does the science actually say, and what does it mean
for my project?"

## Input

- Top 5 cohort paper IDs from the run
- scope_notes from request.json
- Section files: results_primary.txt, limitations_and_conclusion.txt,
  endpoints_and_modalities.txt

## Workflow

### Step 1 — Read scope_notes

The user's brief determines what signal matters. For a model
training request, effect sizes and replication matter most. For
sample procurement, signal matters less than access.

### Step 2 — Per-paper signal extraction

For each paper, read results_primary.txt and
limitations_and_conclusion.txt. Extract:

**Key finding** (one sentence, with exact quote):
```
"AD dementia converters show a 3 to 4.8% reduction in ether
lipid species" (PMC12269576, results_primary.txt)
```

**Performance metric** (exact number, comparison group, context):
```
AUC 0.83 for AD vs CN at baseline
AUC 0.70 for MCI converter prediction
→ Decent but not diagnostic. Improves to 0.91 at 24 months.
```

**What worked** (specific biomarkers/pathways with evidence):
```
Ether lipids (alkylPC, alkenylPC): consistent 3-5% reduction
in converters across timepoints. Replicated in ASPREE.
```

**What did NOT work** (negative results, failed biomarkers):
```
"No significant associations for acylcarnitines after FDR
correction" → do not pursue acylcarnitines in this cohort.
```

**Limitations** (from the paper, not your assessment):
```
"Single-platform (lipidomics only); broader metabolomics
may capture additional pathways"
"No ethnic diversity in validation cohort"
```

### Step 3 — Cross-paper synthesis

After per-paper extraction, synthesize:

- What is consistent across studies? (e.g. "ether lipids appear
  in 3 of 5 papers as the top AD metabolomics signal")
- Where do studies disagree?
- What is the realistic expectation for the user's project?
  (e.g. "expect AUC 0.70 to 0.85 for plasma metabolomics in
  AD classification, depending on panel and cohort")
- What gaps remain that the user's project could fill?
- Replication status: for each key finding, was it validated in
  an independent cohort? Tag each finding as:
  - `replicated`: validated in a separate cohort (name it)
  - `single_cohort`: only shown in one dataset
  - `failed_replication`: attempted replication failed (cite it)
  This is critical: a finding replicated across ADNI and ASPREE
  is fundamentally more trustworthy than one shown only in a
  25-patient hospital cohort.

### Step 4 — Write output

`signal_summary.json`:

```json
{
  "synthesis": "Two to three sentences summarizing the evidence.",
  "realistic_expectation": "What the user should expect.",
  "key_findings": [
    {
      "finding": "...",
      "source_quote": "...",
      "paper_id": "PMC...",
      "implication": "..."
    }
  ],
  "negative_results": [
    {
      "finding": "...",
      "source_quote": "...",
      "paper_id": "PMC...",
      "implication": "..."
    }
  ],
  "gaps": ["..."],
  "consistent_biomarkers": ["ether lipids", "sphingomyelins"],
  "inconsistent_biomarkers": ["acylcarnitines"],
  "replication_status": [
    {
      "finding": "Ether lipid decline in AD converters",
      "status": "replicated",
      "cohorts": ["ADNI", "ASPREE"],
      "paper_ids": ["PMC12269576"]
    }
  ]
}
```

## Critical rules

- Only extract from stored section files. If results_primary.txt
  does not exist for a paper, skip it. Do not synthesize from
  memory or the abstract.
- source_quote is mandatory for every finding.
- Negative results are as valuable as positive. Always include them.
- The synthesis must set realistic expectations. Do not inflate.
- implications connect to the user's brief, not to science in general.

## Model allocation

Sonnet. Requires reading comprehension and synthesis across papers.
