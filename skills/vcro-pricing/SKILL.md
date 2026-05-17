---
name: vcro-pricing
description: "Pricing intelligence for biospecimens and assays. Finds evidence-backed cost estimates for sample acquisition, analytical platforms, data access, and full project costing. Use when the user asks about costs, pricing, budget estimates, or what things cost in the biospecimen and assay space."
---

# vcro-pricing

Answer any cost question in the biospecimen and assay space with
evidence, not guesses.

## Principles

1. Every price point must have a source (URL, publication, filing)
   and a date. Pricing data decays. A 2022 fee schedule may not
   reflect 2026 reality.

2. Distinguish between published prices (high confidence), derived
   estimates (medium: calculated from revenue or grant budgets),
   and industry consensus (low: "people say Metabolon charges X").
   Label each clearly.

3. Volume matters. Almost everything in this space has volume
   discounts. Always ask: how many samples? Then find the right
   price tier.

4. Decompose costs. A "metabolomics study" is not one price. It is
   sample acquisition + shipping + processing + assay + data
   analysis + data access + legal/DUA overhead. Surface each
   component separately so the user can see where the money goes.

5. Include what is NOT included. A hospital biobank fee of $15 per
   sample usually covers retrieval only. It does not cover clinical
   annotation, consent verification, or shipping. Say so.

6. Regional variation is real. US academic cores charge 2-3x more
   than European ones for equivalent services. Government biobanks
   are cheapest everywhere. Flag geography.

7. When you do not know, say you do not know. Then suggest how to
   find out (request a quote, check a specific website, call).

## Where pricing data lives

### Sample acquisition
- Government biobanks: NIA Aging Research Biobank (published cost page)
- Hospital/academic biobanks: many publish fee schedules on their
  core facility pages. Search "[institution] biobank fee schedule"
  or "[institution] biorepository pricing"
- Population biobanks: Lifelines, UK Biobank, Estonian Biobank, etc.
  Each has a costs page
- Open cohorts: ADNI (free, DUA only), UK Biobank (GBP 9K/3yr data
  access), NACC (free)
- Commercial biobanks: BioIVT, Discovery Life Sciences, Precision
  for Medicine, iSpecimen — all quote-based, no public pricing
- biobanking.org has a Biospecimen User Fee Calculator for estimating
  costs when no published schedule exists

### Assay/platform costs
- Academic core facility rate cards: Duke, BCM, EMBL, Cornell, UC
  Riverside, UT Southwestern, and others publish per-sample prices
  for metabolomics, lipidomics, proteomics
- Kit manufacturers: Biocrates kits priced via NIEHS NIA Targeted
  Metabolomics Platform page
- Commercial CRO platforms: Metabolon (no public pricing, quote
  only), Nightingale (derivable from public financials)
- Public company filings: Nightingale Health annual reports give
  revenue and sample counts. Bruker (acquired Biocrates) filings
  may have segment data

### Data access fees
- UK Biobank: GBP 9,000/3yr (standard), GBP 500 (students/LMIC)
  plus DNAnexus RAP compute costs
- ADNI: free via LONI portal
- NACC: free
- dbGaP: free (NIH-funded)

### Overhead and logistics
- Shipping: dry ice shipments typically $50-300 per box depending
  on domestic/international
- Legal/DUA: $5K-50K in institutional overhead per data access
  agreement (highly variable, hard to estimate, flag as uncertain)
- IRB amendments: $500-5K depending on institution
- Storage: $1-20/month/box at academic biobanks

## How to use this skill

Read `references/pricing-data.md` for known data points with sources.

When the reference file does not cover what is needed, search for it:
- web_search for "[institution] biobank fee" or "[platform] pricing"
- web_fetch on core facility rate pages
- Check public company investor relations pages for financial data

Always output:
- A cost breakdown by component (not a single number)
- Source and date for each price point
- Confidence level (published / derived / estimated)
- What is included and excluded
- Volume effects if applicable
- Gaps: what you could not find and how the user could find it

## Examples of questions this skill handles

- "How much would 500 AD plasma samples cost from a hospital biobank?"
- "What is the per-sample cost for Biocrates MxP 500 including labor?"
- "Compare the total project cost: Metabolon untargeted vs Biocrates
  targeted for 200 samples"
- "What does ADNI data access actually cost once you factor in compute?"
- "I have EUR 50K budget. What can I realistically get?"
- "Are there cheaper alternatives to Metabolon for untargeted metabolomics?"

These are examples, not an exhaustive list. Any cost question in this
domain is in scope.
