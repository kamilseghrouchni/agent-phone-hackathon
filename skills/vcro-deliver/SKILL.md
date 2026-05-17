---
name: vcro-deliver
description: "Recommendation assembly and delivery. Takes all run artifacts and produces the final evidence-backed output: Notion page and chat summary. Use when ranking is complete and the output needs to be composed."
---

# vcro-deliver

Turn extracted data into an evidence-backed recommendation that is
100x better than a search result.

## Input

- ranking.json (top 5 ranked cohorts with why)
- extracted_cohorts.json (intelligence dimensions with quotes)
- signal_summary.json (evidence synthesis)
- contacts.json (PIs, access routes, portal URLs, IRB numbers)
- provider_intelligence.json (platform landscape)
- access_summary.json (access routes, timelines, costs, alternatives)
- request.json (scope_notes, original question, sourcing_priority)

## Workflow

### Step 1 — Read everything

Load all run artifacts. Read scope_notes to understand what the
user prioritizes.

### Step 2 — Compose per-cohort sections

For each ranked cohort (top 5), build a section:

**Header:** cohort name, rank, one-line why

**Numbers that matter:**
- Pull from intelligence dimension "real_numbers"
- Show headline N AND usable N for this request
- Include the exact source quote from the paper

**Key finding (from signal):**
- What was shown in this cohort
- Performance metric with exact number
- Source quote

**Dimensions that matter for this request:**
- Pull 3 to 5 intelligence dimensions selected by extraction
- Each with fact, quote, and implication
- Only dimensions relevant to the scope_notes

**Access and sourcing** (from access_summary.json):
- Access route: portal / PI-dependent / consortium / commercial
- Portal URL if public
- PI name and institution if contact needed
- DUA requirements and commercial use status
- Estimated timeline and cost (with source)
- Alternative routes (failed trial samples, commercial biobanks)
- What to do next (specific action, not generic "apply")

**Watchout:**
- One or two things the user should know before committing
- Framed as implication, not caveat

### Step 3 — Compose evidence summary

From signal_summary.json:
- What the science says about this modality + indication (2 to 3 sentences)
- Realistic expectation (what AUC/effect size to expect)
- Key biomarkers that are consistent across studies
- Negative results (what NOT to pursue)
- Gaps the user's project could fill

### Step 4 — Compose provider landscape

From provider_intelligence.json:
- Top 3 to 4 providers with adoption, credibility, fit
- ISOSpec positioning (honest)
- Which provider was used in the top cohorts (direct evidence)

### Step 5 — Compose exclusion summary

- Total screened, total excluded
- Grouped by reason (plain language)
- 3 to 5 specific examples
- This proves thoroughness without cluttering the recommendation

### Step 6 — Compose sourcing plan

If access_summary.json exists, add a dedicated sourcing section:

**Sourcing Plan:**
- Recommended sequence: which cohort to pursue first and why
  (fastest, cheapest, best data, depending on sourcing_priority)
- Per-cohort: access route, timeline, cost, contact, action item
- Alternative routes for each cohort
- Total estimated cost for the full project (samples + assay)
  using pricing data from vcro-pricing references

Use toggles (collapsible) for detailed per-cohort access information
so the page stays scannable.

### Step 7 — Build Notion page

Write the full page as a markdown file, then convert and post:

```bash
python3 {scripts}/md_to_notion.py {run_dir}/recommendation.md \
  --page-id {notion_page_id} --post
```

Page structure:
1. Request summary (what the user asked)
2. One-line answer
3. !toc (table of contents)
4. Top 5 cohorts (per-cohort sections from Step 2, use ### for sub-sections)
5. Sourcing plan (from Step 6, use toggles for detail)
6. Evidence summary (from Step 3, use > callouts for key warnings)
7. Provider landscape (from Step 4, use bullet lists)
8. Exclusion log (from Step 5, use toggle to collapse)
9. Provenance (sources searched, papers screened, validation rate)

Use markdown formatting that md_to_notion.py supports:
- `#`, `##`, `###` for headings
- `- ` for bullets, `1. ` for numbered lists
- `> ` for callouts (critical warnings)
- `:::toggle Title` ... `:::` for collapsible sections
- `**bold**`, `*italic*`, `[links](url)`, `` `code` ``
- `---` for dividers
- `[bookmark](url)` for portal links

### Step 8 — Build context package

The context package is a JSON summary for downstream agents:

Write the context package as a JSON file in the run directory.
Include: top cohorts with access routes, signal summary, provider
landscape, sourcing recommendations, and provenance.

Follow `references/context-package-schema.md` for the full schema.

### Step 8.5 — Generate endpoint schema

Read `request.json` (what the user asked) and the run artifacts
(what we found). Generate `endpoint_schema.json` — a run-specific
parameter schema that tells any agent how to query this run's
intelligence.

**Logic:**

1. Read `request.json` — what diseases, sample types, use case?
2. Read `extracted_cohorts.json` — what cohort names, dimensions?
3. Read `signal_summary.json` — what biomarker classes, gaps?
4. Derive 2-4 decision axes from the intersection of question + data

**Decision axes are NOT generic database filters.** They represent
the decisions the user needs to make based on their original question.

For example, an AD/ALS metabolomics run produces:
- `disease` axis: ["AD", "ALS"] — because evidence differs between them
- `question` axis: ["proof_points", "sourcing", "expectations"] — because the user asked both "is it worth it" and "where to get samples"
- `sample_type` axis: ["plasma", "CSF", "serum"] — because the user is considering both

An FFPE feasibility run would produce completely different axes:
- `metabolite_class`: ["fatty_acids", "phospholipids", "amino_acids"]
- `question`: ["feasibility", "providers", "protocol"]
- `tissue_age`: ["fresh_frozen", "archival_1-5yr", "archival_5-20yr"]

**Resolution types (use ONLY these three):**

Each resolution rule in `endpoint_schema.json` MUST have a `type` field.
The API server dispatches on this type. Do not invent new types.

1. **`field_match`** — filter cohorts where a top-level structural field matches:
   ```json
   { "type": "field_match", "field": "diseases" }
   ```
   Server does: `cohorts.filter(c => c[field].includes(value))`
   Requires the extraction schema to have the field (diseases, sample_types, etc.)

2. **`artifact_redirect`** — change which artifact sections are included:
   ```json
   { "type": "artifact_redirect", "values": {
       "proof_points": { "include": ["signal", "recommendations"] },
       "sourcing": { "include": ["access", "contacts", "recommendations"] }
   }}
   ```
   Server reads `values[user_value].include` and adjusts response sections.

3. **`text_search`** — fuzzy text search across intelligence facts (fallback):
   ```json
   { "type": "text_search", "field": "intelligence" }
   ```
   Use only when no structural field exists for this axis.

Resolution rules go ONLY at the top level of endpoint_schema.json
under `"resolution"`. NOT inside each decision axis. Each key in
`resolution` matches an axis `param` name.

**Output: `{run_dir}/endpoint_schema.json`:**

```json
{
  "run_id": "20260330_als_ad_metabolomics",
  "one_liner": "Metabolomics proof points and sample sourcing for AD and ALS foundation models",
  "decision_axes": [
    {
      "param": "disease",
      "type": "string",
      "values": ["AD", "ALS"],
      "why": "Evidence and sourcing differ. AD has prospective validation; ALS has diagnostic power but failed pre-symptomatic prediction."
    },
    {
      "param": "question",
      "type": "string",
      "values": ["proof_points", "sourcing", "expectations"],
      "why": "User asked two things: is metabolomics worth adding, and where to get samples."
    },
    {
      "param": "sample_type",
      "type": "string",
      "values": ["plasma", "CSF", "serum"],
      "why": "User is considering both. Plasma-CSF lipid correlation is r=0.11."
    }
  ],
  "fixed_params": {
    "run_id": { "type": "string", "default": "20260330_als_ad_metabolomics" },
    "top_k": { "type": "integer", "default": 5 },
    "cohort_id": { "type": "string", "description": "Deep dive by PMC/NCT ID" },
    "include": { "type": "array", "default": ["recommendations", "signal"] },
    "format": { "type": "string", "default": "full", "enum": ["full", "summary", "actionable"] }
  },
  "resolution": {
    "disease": {
      "type": "field_match",
      "field": "diseases",
      "note": "Filter extracted_cohorts where diseases array contains the value"
    },
    "question": {
      "type": "artifact_redirect",
      "values": {
        "proof_points": { "include": ["signal", "recommendations"] },
        "sourcing": { "include": ["access", "contacts", "recommendations"] },
        "expectations": { "include": ["signal"] }
      }
    },
    "sample_type": {
      "match_type": "text_search_in_intelligence",
      "note": "Search intelligence facts for sample type mentions"
    }
  },
  "examples": [
    { "description": "AD proof points", "body": {"disease": "AD", "question": "proof_points", "top_k": 3} },
    { "description": "ALS sourcing", "body": {"disease": "ALS", "question": "sourcing", "format": "actionable"} },
    { "description": "ADNI deep dive", "body": {"cohort_id": "PMC12269576"} }
  ]
}
```

### Step 9 — Compose user message

The chat message is a condensed version:
- One-line answer
- Top 3 cohorts: name, usable N, one-sentence why, access route
- Link to full recommendation (Notion page or webapp URL)
- One sentence on provider landscape

This message must be short enough to read in 30 seconds. The full
detail lives in the recommendation page.

**Include a "Query This Intelligence" block** at the end of both
the `recommendation.md` and the chat message:

```
## Query This Intelligence

Endpoint: POST /api/query

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| run_id | string | {this_run_id} | This run |
| disease | string | None | {from decision_axes, with why} |
| question | string | None | {from decision_axes, with why} |
| sample_type | string | None | {from decision_axes, with why} |
| top_k | int | 5 | Number of cohorts to return |
| cohort_id | string | None | Deep dive by PMC/NCT ID |
| format | string | "full" | "full", "summary", or "actionable" |

Example queries:
{from endpoint_schema.json examples}
```

This makes the output self-describing — any agent or human who
reads the recommendation can immediately query it programmatically.

## What makes this 100x

- Every claim backed by exact paper quotes with PMC ID
- Number breakdowns (headline vs usable for this request)
- Implications for every fact (not just facts)
- DOIs and portal links (clickable, verifiable)
- Named contacts with institutions
- Negative results included (dead ends to avoid)
- Provider intelligence with adoption data and key people
- Exclusion log proving thoroughness

## Anti-patterns

- Listing cohorts without quotes or evidence
- "This cohort has plasma samples" without saying what that means
- Ranking by N instead of relevance
- Omitting watchouts and limitations
- Putting everything in the chat message instead of the Notion page
- Notion page with only an activity log and no recommendation

## Model allocation

Sonnet. This requires synthesis across all artifacts and precise
writing, but the judgment calls (ranking, signal assessment) are
already made by upstream skills. Deliver assembles and formats.

## Tools available

- `md_to_notion.py` — convert markdown to Notion blocks and post
- `store_query.py` — query run artifacts efficiently
