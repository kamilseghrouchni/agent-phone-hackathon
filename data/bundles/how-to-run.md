# Sourcing Pipeline Eval Harness

How to evaluate the sourcing pipeline (docs/mvp-v2.md) against real-world biospecimen data.

## Architecture

```
                         query.json
                             │
                    ┌────────▼────────┐
                    │  /source pipeline │
                    │  (Layers 1-2-3)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     source_profiles   outreach_briefs  evaluations
              │              │              │
              ▼              ▼              ▼
    ┌─────────┴──────────────┴──────────────┴─────────┐
    │              EVAL SCORING                        │
    │  Compare against DUAL ground truth:              │
    │  1. academic_ground_truth.json (primary)         │
    │  2. ground_truth.json / AminoChain (bonus)       │
    └─────────────────────────────────────────────────┘
```

## Dual Ground Truth Strategy

Each bundle has two ground truth layers:

### Primary: `academic_ground_truth.json`
Papers the pipeline SHOULD find through PubMed/medRxiv/bioRxiv search.
These papers describe banked specimens at identifiable institutions.
The pipeline's paper-first path (search → depth extraction → institution aggregation) should discover these.

**This is what you score recall against.**

### Secondary: `ground_truth.json` (AminoChain)
Commercial biobank inventory. Most AminoChain orgs have zero academic footprint.
The pipeline might find some via web search (Pass 4 targeted data fill) but this is bonus, not required.

**Overlap with AminoChain orgs is a bonus signal, not a pass/fail criterion.**

### Why two layers?
The sourcing pipeline (mvp-v2) is paper-first: PubMed → author → institution → biobank.
AminoChain orgs are commercial CROs (BIOMEDICA CRO, CSD Bio, etc.) with no publications.
Testing paper-first recall against broker inventory produces false negatives.
Academic papers describe equivalent or superior specimens with documented provenance.

## Running an Eval

### Step 1: Select bundles

```bash
# Run one bundle
BUNDLE=store/eval/bundles/oncology-adc/crc-t3n1-ffpe-plasma-matched

# Run all bundles in an area
for BUNDLE in store/eval/bundles/neurodegeneration/*/; do ...

# Run by difficulty
cat store/eval/bundles/*/difficulty.json | python3 -c "..."
```

### Step 2: Execute the sourcing pipeline

Feed `query.json` text to `/source`:

```bash
# The query_text field contains the natural language input
QUERY=$(python3 -c "import json; print(json.load(open('$BUNDLE/query.json'))['query_text'])")

# Run the sourcing pipeline
# This produces: source_profiles.json, outreach_briefs.jsonl, evaluations/
```

### Step 3: Score against ground truth

Score each layer independently, then compute composite.

## Scoring Methodology

### Layer 1: Data Collection (hard facts)

#### 1a. Academic Source Recall (primary recall metric)
```
academic_recall = |found_institutions ∩ academic_gt_institutions| / |academic_gt_institutions|
```

Match by normalized institution name. Fuzzy matching OK (Levenshtein ≤ 3 or substring).
"Found" means the institution appears in `source_profiles.json` with at least one SI fact.

| Score | Threshold |
|-------|-----------|
| pass  | recall >= 0.3 AND found >= 2 institutions |
| good  | recall >= 0.5 |
| excellent | recall >= 0.7 |

#### 1b. Paper Recall (depth metric)
```
paper_recall = |found_PMIDs ∩ academic_gt_PMIDs| / |academic_gt_PMIDs|
```

"Found" means the PMID appears in search results or depth findings.
This measures whether the search strategy finds the right papers.

| Score | Threshold |
|-------|-----------|
| pass  | recall >= 0.2 |
| good  | recall >= 0.4 |

#### 1c. Evidence Integrity (HARD GATE — pass/fail)
```
violations = count of:
  - [documented] claims without verbatim quote + source ID
  - "likely"/"probably"/"typically" in Layer 1 facts
  - specimen counts without cited source
  - invented contacts (email not traceable to paper/website/registry)
```

**Pass: zero violations. Any violation = bundle FAIL.**

This is the most important gate. A system that hallucinates specimen counts
from training data is worse than one that finds nothing.

#### 1d. Pillar Coverage
```
For each discovered source:
  SI_coverage = filled_SI_fields / total_SI_fields
  CR_coverage = filled_CR_fields / total_CR_fields
  CF_coverage = filled_CF_fields / total_CF_fields
  MD_coverage = filled_MD_fields / total_MD_fields
  
  mean_coverage = mean(SI, CR, CF, MD)
```

SI fields: specimen_type, n_value, storage_conditions, biorepository_name
CR fields: contact_name, contact_email, website, access_route, consent_scope
CF fields: preservation_method, collection_protocol, storage_temp, time_to_freeze
MD fields: publication_count, publication_recency, trial_count, industry_partnerships

| Score | Threshold |
|-------|-----------|
| pass  | mean >= 0.3 across sources |
| good  | mean >= 0.5 |

#### 1e. AminoChain Overlap (BONUS — not required for pass)
```
aminochain_overlap = |found_orgs ∩ aminochain_orgs| / |aminochain_orgs|
```

Track but do not gate on this. Report as "commercial source discovery rate."

### Layer 2: Inference (label discipline)

#### 2a. Label Separation (HARD GATE)
Every claim in pipeline output must carry one of: `[documented]`, `[verified]`, `[unverified]`, `[not_stated]`.

```
label_rate = claims_with_labels / total_claims
```

| Score | Threshold |
|-------|-----------|
| pass  | label_rate >= 0.8 |
| fail  | label_rate < 0.6 |

#### 2b. Score Calibration
Compare pipeline's SI/CR/CF/MD scores against `eval_criteria.json` expected ranges.

```
For each institution with expected scores:
  per_criterion_error = |pipeline_score - midpoint(expected_range)|
  mean_absolute_error = mean(per_criterion_errors)
```

| Score | Threshold |
|-------|-----------|
| pass  | MAE <= 1.0 per criterion |
| good  | MAE <= 0.5 |

Only score against institutions where expected ranges are defined (not "unknown").

#### 2c. Gap Honesty
Compare pipeline's flagged gaps against `eval_criteria.json` known_unknowns.

```
gap_recall = |flagged_gaps ∩ known_unknowns| / |known_unknowns|
```

| Score | Threshold |
|-------|-----------|
| pass  | gap_recall >= 0.5 |
| fail  | gap_recall < 0.3 (system presents incomplete picture as complete) |

### Layer 3: Output Quality

#### 3a. Outreach Brief Completeness
Check `outreach_briefs.jsonl` entries against required fields:

```
required_documented: specimens.types, specimens.n, specimens.source_id
required_contacts: name OR email
required_scores: SI, CR, CF, MD, readiness
required_gaps: field, status, what_to_ask
required_outreach: what_to_ask, opening_hook
```

```
completeness = entries_with_all_required / total_entries
```

| Score | Threshold |
|-------|-----------|
| pass  | completeness >= 0.7 |

#### 3b. Hallucination Check (HARD GATE)
```
hallucinations = count of:
  - invented specimen counts (N not traceable to any source)
  - invented contacts (email fabricated, not from paper/website)
  - training-data fills for cost or protocol data
  - institution names not found in any search result
```

**Pass: zero hallucinations. Any hallucination = bundle FAIL.**

### Composite Score

```python
def bundle_score(layer1, layer2, layer3):
    # Hard gates first — any failure = 0
    if not layer1.evidence_integrity:
        return 0.0, "FAIL: evidence integrity violation"
    if not layer3.hallucination_check:
        return 0.0, "FAIL: hallucination detected"
    if layer2.label_rate < 0.6:
        return 0.0, "FAIL: label separation below 0.6"
    
    # Weighted composite
    score = (
        layer1.academic_recall * 0.20 +
        layer1.paper_recall * 0.10 +
        layer1.pillar_coverage * 0.15 +
        layer2.label_rate * 0.10 +
        layer2.gap_recall * 0.15 +
        layer3.completeness * 0.15 +
        (1.0 if layer2.score_mae <= 1.0 else 0.0) * 0.15
    )
    
    return score, "PASS" if score >= 0.5 else "MARGINAL"
```

## Difficulty Calibration

Each bundle has a `difficulty.json` with expected failure modes.
Use difficulty to set expectations, not to lower the bar.

| Difficulty | Expected composite | Notes |
|------------|-------------------|-------|
| easy | >= 0.7 | Well-known cohorts, many papers, clear specimen descriptions |
| medium | >= 0.5 | Some specimens findable, some gaps expected |
| hard | >= 0.3 | Rare disease, few papers, commercial-only sources |
| impossible | 0.0 | No specimens exist; test graceful failure and gap honesty |

For "impossible" bundles, the pass criterion is:
- Pipeline returns 0 sources
- Pipeline explicitly states no matching specimens found
- No hallucinated sources or invented counts
- Gap honesty score >= 0.8

## What the Eval Tests (mapped to mvp-v2)

| mvp-v2 Component | Eval Signal | Where Measured |
|---|---|---|
| Pass 1 (Breadth search) | Paper recall | 1b |
| Pass 2 (Depth extraction) | Pillar coverage | 1d |
| Pass 3 (Source aggregation) | Institution recall | 1a |
| Pass 4 (Targeted data fill) | AminoChain overlap (bonus) | 1e |
| Pass 5-6 (Hypothesize + verify) | Label separation | 2a |
| Pass 7 (Qualified output) | Outreach brief completeness | 3a |
| Data/inference separation | Label separation + evidence integrity | 2a + 1c |
| Gap honesty | Gap recall vs known unknowns | 2c |
| No hallucination | Evidence integrity + hallucination check | 1c + 3b |

## What the Eval Does NOT Test

These require separate eval approaches:

- **Author intelligence extraction** — whether first/last author positions and emails are correctly parsed from PMC XML. Test via `scripts/pmc_convert.py` unit tests on known papers.
- **Institution name normalization** — whether "University of Pennsylvania" and "Penn Medicine" merge correctly. Test via `scripts/search_resolve.py` unit tests.
- **Progressive enrichment delta** — whether Pass 4 enrichment actually improves scores. Test by running the pipeline twice (with and without enrichment) and comparing pillar coverage.
- **Verification loop quality** — whether hypothesis → verification queries are well-targeted. Requires human review of verification attempts.
- **Cost ceiling compliance** — whether the pipeline stays within token/time budget. Track via `scripts/run_log.py`.

## Running the Full Suite

```bash
# All 36 bundles, report to store/eval/bundles/results/
python3 evals/run_sourcing_eval.py --bundles-dir store/eval/bundles/ --out store/eval/bundles/results/

# Single area
python3 evals/run_sourcing_eval.py --area neurodegeneration --out store/eval/bundles/results/

# Single bundle
python3 evals/run_sourcing_eval.py --bundle store/eval/bundles/oncology-adc/crc-t3n1-ffpe-plasma-matched --out store/eval/bundles/results/

# Difficulty filter
python3 evals/run_sourcing_eval.py --difficulty easy medium --out store/eval/bundles/results/
```

Output: `results/eval_report.json` with per-bundle scores + aggregate stats.

## Interpreting Results

### Good signals
- Academic recall >= 0.5 across medium bundles: search strategy is working
- Zero evidence integrity violations: the data/inference wall holds
- Gap recall >= 0.6: system is honest about what it doesn't know
- AminoChain overlap > 0: web search (Pass 4) is finding commercial sources

### Bad signals
- Evidence integrity violations: LLM is filling from training data
- Low label separation: data/inference wall is broken
- High academic recall but low pillar coverage: finding papers but not extracting facts
- Low gap recall: system is presenting incomplete picture as complete
- Hallucinations: invented contacts, fabricated specimen counts

### Expected failure pattern for v1 pipeline
The current query pipeline (pre-mvp-v2) should score:
- Academic recall: ~0.1-0.2 (finds some papers but doesn't aggregate by institution)
- Pillar coverage: ~0.2 (extracts some facts but not structured per-pillar)
- Label separation: ~0.3 (no formal label system exists yet)
- Gap honesty: ~0.2 (gaps not explicitly flagged)

This baseline tells you how much mvp-v2 improves over v1.

## Bundle File Reference

Each bundle directory contains:

| File | Purpose | Used by |
|---|---|---|
| `query.json` | Buyer's sourcing request — input to pipeline | Pipeline input |
| `ground_truth.json` | AminoChain specimens + orgs (secondary GT) | Eval scorer (bonus) |
| `academic_ground_truth.json` | Papers + institutions pipeline should find (primary GT) | Eval scorer (primary) |
| `eval_criteria.json` | Per-layer scoring rubrics + expected score ranges | Eval scorer |
| `difficulty.json` | Difficulty rating + expected failure modes | Test planning |

## Adding New Bundles

1. Identify uncovered disease/specimen combos in `store/eval/aminochain/organized/all_specimens.jsonl`
2. Filter to combos with >= 100 specimens and >= 2 orgs
3. Craft a realistic buyer query with specific specimen + staging + assay requirements
4. Search PubMed/medRxiv/bioRxiv for 3-8 papers describing banked specimens matching the query
5. Build `academic_ground_truth.json` with PMIDs, institutions, specimen types, contact info
6. Extract AminoChain org data for `ground_truth.json`
7. Set expected scores in `eval_criteria.json` based on what each org/institution has
8. Rate difficulty and list expected failure modes

The AminoChain raw data is in `store/eval/aminochain/organized/all_specimens.jsonl` (27,514 unique specimens from 13,866 donors across 13 orgs).
