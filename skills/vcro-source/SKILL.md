---
name: vcro-source
description: "Provider and platform intelligence. Given a modality and indication, produces enriched provider assessments combining literature adoption, citation credibility, company intelligence, and platform-sample fit. Use when the request includes provider sourcing or platform comparison."
---

# vcro-source

Turn "who can run this?" into an intelligence briefing, not a list.

## Philosophy

The papers already tell us which platforms were used. The value is
the intelligence layer on top: adoption trends, credibility signals,
company health, key people, and fit assessment. A customer choosing
between Metabolon and Biocrates should see evidence, not marketing.

## Input

- `request.json` (modality, indication, sample type)
- `extracted_cohorts.json` or methods sections from the run
  (which platforms appeared in the papers we already analyzed)
- Optionally: `recommendation.json` (top cohorts, to check which
  providers have worked with those cohorts before)

## Workflow

### Step 1 — Extract platforms from papers we already have

Read the extracted cohorts and methods sections. Find every mention
of a platform, assay kit, or service provider. Common patterns:

- "samples were analyzed by Metabolon, Inc."
- "using the Biocrates AbsoluteIDQ p180 kit"
- "Olink Explore 3072 panel"
- "sequenced on Illumina NovaSeq"
- "cfDNA extracted using QIAamp Circulating Nucleic Acid Kit"

Build a list: which providers appeared, in how many papers, with
what sample sizes.

### Step 2 — Publication adoption (PubMed)

For each provider identified in Step 1, plus known providers for
the requested modality, run a PubMed count:

```bash
# Total publications: provider + indication
python3 pubmed_api.py --queries '"Metabolon" Alzheimer' --retmax 1

# Year trend: provider + indication + year
# Use [dp] date tag: '"Metabolon" Alzheimer 2024[dp]'
```

Extract:
- Total publication count for provider + indication
- Year by year trend (last 5 years)
- Whether the trend is growing, stable, or declining

### Step 3 — Citation credibility (Europe PMC)

For each provider, search Europe PMC sorted by citations:

```
query: "Metabolon Alzheimer metabolomics"
sort: CITED desc
pageSize: 3
```

Extract:
- Top cited paper and its citation count
- Whether the provider is associated with landmark studies

### Step 4 — Company intelligence (web search)

For each top provider (max 5), run web searches:

**Funding and scale:**
- Search: "[company] funding revenue employees"
- Extract: total raised, employee count, growth signals

**Recent news and partnerships:**
- Search: "[company] [indication] partnership news 2025 2026"
- Extract: recent collaborations, product launches, acquisitions

**Service quality signals:**
- Search: "[company] reviews Glassdoor"
- Extract: rating, employee count, notable pros/cons

**Key contacts:**
- Search: "site:linkedin.com [company] director [therapeutic area]"
- Extract: name, title, relevance to the customer's indication

**Company website:**
- Fetch company website service page if available
- Extract: current offerings, sample requirements, turnaround

### Step 5 — Platform-sample fit assessment

For each provider, assess fit not just by popularity but by
compatibility with the specific samples and question:

- Does the platform match the sample type? (Metabolon needs
  plasma or serum, Nightingale NMR works with both but misses
  complex lipids)
- Does the platform cover the metabolite classes that matter for
  this indication? (AD needs sphingomyelins, ether lipids,
  ceramides. NMR misses most of these.)
- Has this platform been used on samples from the recommended
  cohorts? (Biocrates ran on ADNI serum. Metabolon ran on
  Michigan ALS plasma. Different platforms on different cohorts
  means cross-platform normalization is needed.)
- What does it cost? Reference `skills/vcro-pricing/references/pricing-data.md`
  for known price points.

Do NOT include ISOSpec in the provider comparison. ISOSpec is
an internal capability, not an external option for customers.

### Step 6 — Write provider_intelligence.json

For each provider:

```json
{
  "name": "Metabolon",
  "type": "CRO",
  "modality": "global metabolomics",

  "adoption": {
    "total_publications": 76,
    "indication_publications": 76,
    "trend": [2, 3, 8, 16, 20, 17],
    "trend_years": [2020, 2021, 2022, 2023, 2024, 2025],
    "trend_direction": "growing",
    "papers_in_our_cohorts": 4,
    "cohorts_used": ["ADNI", "WRAP", "Knight ADRC", "UK Biobank"]
  },

  "credibility": {
    "top_cited_paper": "Genetic analysis of over 1M people...",
    "top_citations": 1128,
    "landmark_studies": true
  },

  "company": {
    "funding_total": "$284M",
    "employees": "100-250",
    "glassdoor_rating": 2.6,
    "recent_news": "Partnered with China Kadoorie Biobank (Sep 2025)",
    "acquisitions": 2
  },

  "key_contacts": [
    {
      "name": "Kari Wong",
      "title": "Scientific Strategy Director",
      "relevance": "Leads neuroscience collaborations including ALS"
    }
  ],

  "fit_assessment": {
    "fit": "HIGH",
    "reason": "Market leader in AD metabolomics. Used in 4 of 5 top cohorts. Growing adoption.",
    "caveats": "Premium pricing. 6-8 week turnaround typical."
  }
}
```

### Step 7 — Biobank sourcing (if samples needed)

If the request includes sample procurement:

- Check which biobanks are associated with the top cohorts
  (from access_and_ownership.txt and ClinicalTrials meta.json)
- Search for commercial biobanks with the requested sample type:
  "plasma samples Alzheimer commercial biobank"
- Known networks: BioIVT, Discovery Life Sciences, Precision for
  Medicine, NIA biorepositories, UK Biobank, ADNI biorepository

For each biobank:
```json
{
  "name": "BioIVT",
  "type": "commercial_biobank",
  "sample_types": ["plasma", "serum", "PBMC"],
  "indication_coverage": "AD, neurodegeneration",
  "access": "commercial, standard MTA",
  "estimated_timeline": "2-4 weeks"
}
```

## Output

Write to the run folder:
- `provider_intelligence.json` — full enriched provider profiles
- `sourcing_summary.json` — if biobank sourcing was needed

## What makes this smart, not just a list

- Publication count tells you market adoption
- Citation count tells you credibility
- Year trend tells you if the platform is gaining or losing traction
- Papers in our own cohorts tells you direct evidence it works
- Glassdoor tells you service quality risk
- LinkedIn tells you who has domain expertise
- Company funding tells you stability and growth
- All of this combined into a fit assessment, not just a directory

## Anti-patterns

- Listing 15 providers with no differentiation
- Saying "Metabolon is a leading metabolomics provider" with no evidence
- Recommending a provider without checking if they have indication expertise
- Including ISOSpec in customer-facing provider comparisons

## Model allocation

Sonnet. This requires web search synthesis across multiple sources
per provider. Haiku is too terse. Opus is overkill unless the
customer needs a strategic comparison across 5+ providers.
