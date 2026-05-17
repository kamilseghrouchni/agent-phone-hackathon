---
name: vcro-access
description: "Access and sourcing intelligence. Determines how to obtain cohort data or samples: access route, contacts, timeline, cost, and constraints. Use when top cohorts are identified and the user needs actionable access routes. Covers open portals, PI-dependent access, consortium data, commercial biobanks, and hospital inventory estimation."
---

# vcro-access

Answer: "How do I actually get this data or these samples?"

## Inputs

- `extracted_cohorts.json` from the run (top cohorts)
- `contacts.json` from the run (PI names, portal URLs, IRB numbers)
- `trial_sites.json` from the run (if available — hospital sites)
- Section files: `access_and_ownership.txt` from the store
- `request.json` (is the customer commercial? what is their sourcing priority?)

## Workflow

### Step 1 — Classify access route per cohort

For each top cohort, determine which access model applies:

**open_portal** — formal application through a data repository
- Indicators: portal URL in contacts.json, "LONI", "UK Biobank RAP",
  "dbGaP", "AD Knowledge Portal", "NACC"
- What to find: application URL, fee structure, typical timeline,
  eligibility requirements, whether commercial use is allowed

**pi_dependent** — data available on request from the investigators
- Indicators: "upon request from qualified investigators",
  "contact corresponding author", no portal URL
- What to find: PI name and institution (from contacts.json),
  IRB number, data sharing statement language, whether "qualified
  investigator" includes industry researchers

**consortium_controlled** — access governed by a consortium or sponsor
- Indicators: consortium name (ADNI steering committee, CPAD,
  AMP-AD), sponsor name, data sharing plan on CT.gov
- What to find: consortium access policy, whether industry
  members can join, data sharing platform
  (e.g. clinicalstudydatarequest.com for Roche trials)

**commercial_biobank** — samples purchasable from a biobank
- Indicators: biobank name in access text, "BioIVT", "NCRAD",
  NIA Aging Research Biobank
- What to find: what sample types are available, pricing if
  known (reference vcro-pricing data), order process

**unknown** — no access information found
- Action: flag for web verification (Step 3)

### Step 2 — Assess access constraints

For each cohort, determine:

**commercial_use_allowed** (yes / no / unknown)
- "academic use only", "non-commercial" → no
- "available to qualified researchers" without restriction → likely yes
- Public-private partnership (ADNI, UK Biobank) → yes (confirmed today)
- PI-dependent with no explicit restriction → unknown, default to
  "requires negotiation"

**consent_scope** (broad / academic_only / disease_specific / unknown)
- From access_and_ownership.txt and DUA language
- Broad consent covers reuse for any research purpose
- Disease-specific limits to the original indication
- Academic-only blocks commercial entities

**estimated_timeline**
- open_portal: 2 to 8 weeks (ADNI/NACC fast, UK Biobank slower)
- pi_dependent: 1 to 6 months (depends on institution's tech transfer)
- consortium_controlled: 3 to 12 months (committee review cycles)
- commercial_biobank: 1 to 4 weeks (fastest path)

**estimated_cost**
- Reference `skills/vcro-pricing/references/pricing-data.md`
- open_portal: free (ADNI, NACC) to GBP 9,000 (UK Biobank)
- pi_dependent: typically free but hidden costs ($5K-50K legal overhead)
- commercial_biobank: $8-25 per sample (academic) to $150-500 (commercial)

### Step 3 — Web verification for high-value unknowns

For cohorts where access_route is unknown but the cohort ranks in
top 5:

- web_search: "[cohort name] data access application"
- web_search: "[institution] biobank fee schedule"
- web_fetch: portal URLs found in contacts.json

Extract: application process, fees, timeline, eligibility.

### Step 4 — Failed trial sample check

For cohorts linked to terminated clinical trials:

- Check CT.gov for the trial's IPD sharing statement
- Look for `ipdSharing: "YES"` and the sharing platform URL
- Check if the sponsor has a known data sharing program:
  - Roche → clinicalstudydatarequest.com
  - Biogen → internal review
  - Pfizer → vivli.org or direct negotiation
- Flag these as alternative sample sources with the sponsor
  contact and estimated pathway

### Step 5 — Hospital inventory estimation

For cohorts from smaller hospitals (published N < 100):

- Cross-reference with trial_sites.json: how many trials has
  this hospital participated in for this indication?
- web_search: "[hospital name] [indication] clinic" to estimate
  clinical volume
- Estimate: a hospital with 5+ trials and 10+ publications in
  an indication likely sees 50-200 patients per year. Published
  N is a subset of what is in the freezer.
- Flag as: "Published N=15, but estimated clinic volume suggests
  significantly larger sample inventory. Contact PI to confirm."

### Step 6 — Write output

`access_summary.json`:

```json
{
  "cohorts": [
    {
      "cohort_id": "PMC12269576",
      "cohort_name": "ADNI Plasma Lipidomics",
      "access_route": "open_portal",
      "portal_url": "https://ida.loni.usc.edu",
      "commercial_use": "yes",
      "consent_scope": "broad",
      "estimated_timeline": "2-4 weeks",
      "estimated_cost": "free (DUA only)",
      "cost_source": "ADNI data access policy",
      "contacts": ["Peter Meikle", "Rima Kaddurah-Daouk"],
      "notes": "Public-private partnership. Commercial use allowed. Physical biospecimen requests go through RARC/NIA.",
      "alternative_routes": []
    },
    {
      "cohort_id": "PMC12174748",
      "cohort_name": "Michigan ALS Longitudinal",
      "access_route": "pi_dependent",
      "portal_url": null,
      "commercial_use": "unknown - requires negotiation",
      "consent_scope": "unknown",
      "estimated_timeline": "1-3 months",
      "estimated_cost": "free (collaboration) + legal overhead",
      "cost_source": "estimated from institutional norms",
      "contacts": ["Eva L. Feldman"],
      "notes": "Paper says 'any qualified investigator'. IRB HUM00028826. 50 ALS trials at U Michigan = active program.",
      "alternative_routes": [
        {
          "type": "failed_trial_samples",
          "description": "Reldesemtiv trial (NCT04944784) terminated, 489 patients, U Michigan was a site. Sponsor: Cytokinetics.",
          "estimated_path": "Contact Cytokinetics translational science team"
        }
      ]
    }
  ],
  "sourcing_recommendations": [
    "Fastest path: ADNI portal (2-4 weeks, free)",
    "Best ALS data: Contact Feldman lab directly (1-3 months)",
    "Alternative ALS samples: Check Cytokinetics for reldesemtiv trial residuals"
  ]
}
```

## Critical rules

- Every access assessment must cite its source (which text, which URL,
  which data sharing statement).
- Do NOT assume commercial access is blocked for well-known cohorts.
  ADNI and UK Biobank both allow commercial use.
- Do NOT confuse "data access" with "sample access". ADNI data is
  free via LONI. ADNI physical samples go through a separate RARC
  process.
- Hospital inventory estimation is an estimate, not a fact. Always
  label it as such and recommend contacting the PI to confirm.
- Failed trial sample pools are speculative. The samples may have
  been destroyed. Flag the opportunity but do not promise availability.

## Tools available

- `store_query.py` — query contacts.json and extracted_cohorts.json
- `store_search.py` — semantic search over access_and_ownership sections
- web_search and web_fetch for portal verification

## Model allocation

Sonnet. Requires judgment about access routes, timeline estimation,
and web research synthesis. Haiku would miss nuance in DUA language.
