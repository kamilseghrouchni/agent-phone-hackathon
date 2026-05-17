---
name: vcro-rank
description: "Relevance ranking for cohorts. Takes extracted cohorts and ranks them by how well they match the user specific request, not by raw N. Use when extraction is complete and the top 5 need to be selected."
---

# vcro-rank

Rank cohorts by relevance to THIS request, not by headline numbers.

## Input

- extracted_cohorts.json (with intelligence dimensions)
- request.json (with scope_notes, required_fields, n_target, sourcing_priority)
- signal_summary.json (if available)
- contacts.json (if available)
- access_summary.json (if available — access routes, timelines, costs)

## Philosophy

A cohort with n=274,259 but only NMR metabolomics and ~2,300 AD
cases ranks BELOW a cohort with n=1,517 that has LC/MS lipidomics,
longitudinal design, and 329 AD converters — if the user needs
progression data for model training.

Ranking is a judgment call based on the brief. Raw N is one factor.
The other factors are:

- How well the sample type matches (plasma vs serum vs CSF)
- Whether the design matches (longitudinal if they need longitudinal)
- Whether the modality matches (LC/MS vs NMR vs targeted panel)
- Whether the indication is exact (AD vs broad dementia)
- Access feasibility (public portal > PI contact > unknown)
- Evidence quality (replicated > single study > preprint)
- Usable N (AD+MCI subset, not total cohort)
- Sourcing timeline (if sourcing_priority is "speed", a cohort
  available in 2 weeks outranks one that takes 6 months)
- Cost (if sourcing_priority is "budget" or budget_range is set,
  a free ADNI dataset outranks a $100K commercial option)

## Workflow

### Step 1 — Read the brief

scope_notes tell you what the user prioritizes. "Large N for model
training" means N matters more. "Plasma samples for cfDNA" means
sample usability and access matter more than N.

### Step 2 — Score each cohort

For each extracted cohort, assess fit across the factors above.
Do NOT use a numerical formula. Use judgment. Read the intelligence
dimensions for each cohort and ask: "would I recommend this to the
user?"

### Step 3 — Select top 5

Pick the 5 cohorts that best answer the user's question. Order them
by fit, not by N.

For each, write a one-sentence "why this ranks here":
```
Rank 1: ADNI lipidomics — best match. Longitudinal LC/MS plasma,
n=985 usable (AD+MCI), proven ether lipid signal, public access.

Rank 2: WRAP — strong second. Same Metabolon platform, n=1,111,
longitudinal, but access requires PI contact.

Rank 3: UK Biobank NMR — massive scale but NMR only. Good for
population signals, not targeted pathway discovery.
```

### Step 4 — Write output

`ranking.json` — **MUST be a JSON array at the top level.** Not a dict.
Not wrapped in `{"ranked_cohorts": [...]}`. A plain array.

```json
[
  {
    "rank": 1,
    "id": "PMC12269576",
    "cohort_name": "ADNI",
    "diseases": ["AD"],
    "sample_types": ["plasma"],
    "why": "Best match. Longitudinal LC/MS plasma, n=985 usable, proven signal, public access.",
    "fit_factors": {
      "sample_match": "exact (plasma, LC/MS)",
      "design_match": "exact (longitudinal, conversion tracking)",
      "usable_n": 985,
      "access": "public portal",
      "evidence": "replicated in ASPREE",
      "commercial_use": "confirmed"
    }
  }
]
```

Every ranked cohort MUST include: `rank`, `id`, `cohort_name`,
`diseases`, `sample_types`, `why`, `fit_factors`. The `fit_factors`
MUST include `commercial_use` if the user requires commercial access.

## Critical rules

- Never rank by raw N alone.
- The "why" for each rank must reference the user's specific request.
- If two cohorts are close, the one with better access wins.
- If a cohort has great data but no feasible access route, it still
  ranks but with a caveat.
- Preprints rank below peer-reviewed papers.
- Cohorts with external replication rank above unreplicated.
- When access_summary.json is available, incorporate access route,
  timeline, and cost into the fit_factors for each ranked cohort.
- Use `store_query.py` to query extracted_cohorts.json efficiently
  instead of reading the entire file.

## Model allocation

Sonnet. This requires reading multiple cohort profiles and making
comparative judgments. Opus is overkill. Haiku would miss nuance.
