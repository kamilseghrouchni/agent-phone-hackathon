---
name: vcro-understand
description: "Request understanding. Takes a natural language cohort or data request and produces a structured request.json that drives all downstream skills. Use when a user or customer sends a cohort question, data sourcing request, or sample availability question."
---

# vcro-understand

Understand what the user actually needs. Not what they literally typed.

## Philosophy

The value of this skill is in the gap between what someone says and what
they need. A user who writes "I want metabolomics data on AD cohorts with
longitudinal timepoints" is telling you the modality, the disease, and a
design requirement. They are NOT telling you:

- Whether this is for model training, biomarker validation, or exploration
- Whether they need controls
- Whether blood is required or CSF is acceptable
- What "longitudinal" means to them (2 visits or 10 years)

Sometimes the prompt answers these implicitly. Sometimes it does not.

Your job is to detect which questions are already answered and which are
genuinely missing. Then ask ONLY what is missing. If everything is clear
enough to act on, act.

## Anti-patterns (never do these)

- Asking 6 questions when the prompt answered 4 of them
- Sending a questionnaire or checklist
- Asking about fields the user clearly does not care about
- Padding required_fields with everything possible "just in case"
- Rephrasing the user's request back to them as confirmation theater

## Input

A natural language request. Can be:

- A direct question ("What cohorts exist with blood in AD or ALS...")
- A forwarded email from a customer
- Meeting notes or transcript excerpts
- A Slack or Telegram message

## Workflow

### Step 1 — Read the request and extract what IS stated

Go through the text word by word. For each of these dimensions, mark
whether the request explicitly states it, implies it, or says nothing:

| Dimension | Example explicit | Example implied | 
|---|---|---|
| indication | "Alzheimer's disease" | "AD" or "dementia" |
| sample_type | "blood based" or "plasma" | "to run metabolomics on" implies blood |
| n_requirement | "patients in the hundreds" | "large cohort" |
| longitudinal | "longitudinal timepoints" | "progression data" implies longitudinal |
| use_case | "for model training" | rarely stated explicitly |
| controls | "AD vs healthy controls" | model training implies controls needed |
| specific_endpoints | "ptau, MMSE" | usually not stated |
| modality | "metabolomics" | "lipidomics" or "omics" |
| geography | "Swiss hospitals" | usually not stated |
| commercial_use | "we are a startup" | company name implies commercial |
| sourcing_priority | "I need samples fast" | "pilot" implies speed over depth |
| budget_range | "under 50K" | rarely stated explicitly |

### Step 2 — Infer what you can

Some dimensions can be reliably inferred:

- "to run metabolomics on" → sample_type is blood (plasma/serum)
- "with longitudinal timepoints" → longitudinal = true
- "patients in the hundreds" → n_target >= 100
- Customer is a known company (Valinor, any startup) → commercial_use = true
- "for training our model" → use_case = model_training, controls needed
- "pilot study" or "quick experiment" → sourcing_priority = speed
- "comprehensive" or "best available" → sourcing_priority = best_science
- "we have 50K budget" → budget_range = "50000", sourcing_priority = budget

Mark inferences explicitly. Do not treat them as stated facts.

### Step 3 — Identify genuine gaps

A gap is genuine ONLY if:

1. The dimension matters for downstream search and grading, AND
2. The request does not state or imply it, AND
3. Different answers would change what you search for

The most common genuine gap: **use_case**. Users almost never say
"this is for model training" but the answer changes everything
(controls needed, n requirements, endpoint requirements).

Dimensions that are almost never genuine gaps:
- specific_endpoints (downstream extraction handles this)
- geography (search is global unless constrained)
- exact n (a rough sense is enough)

### Step 4 — Ask or run

**If there are 0 genuine gaps:** proceed directly. Write request.json
and hand off to vcro-cohort-map.

**If there are 1 to 2 genuine gaps:** ask in ONE message. Frame each
question as a smart collaborator would:

- "Just to confirm: is this for training a predictive model, or for
  validating specific biomarkers? This changes how I prioritise
  cohort size versus annotation depth."

- "You mentioned blood. Is plasma specifically needed, or would
  serum also work for your assay?"

Never ask more than 2 questions. Never ask what you can infer.

**If there are 3+ gaps:** the request is probably too vague. Summarise
what you understood and ask the user to elaborate on the use case.
One message, not a form.

### Step 5 — Write request.json

Output:

```json
{
  "request_id": "descriptive_slug",
  "original_text": "exact user text, unmodified",
  "indication": "Alzheimer_disease,ALS",
  "use_case_type": "model_training",
  "use_case_inferred": true,
  "n_target": 100,
  "required_fields": [],
  "nice_to_have_fields": [],
  "hard_negatives": [],
  "sourcing_priority": "best_science|speed|budget",
  "sourcing_priority_inferred": true,
  "budget_range": null,
  "scope_notes": ""
}
```

**required_fields rules:**

Only include fields the user asked about or that the use case demands.

- model_training → n_total, n_by_group, sample_types, longitudinal
  are required. endpoints and co_modalities are nice to have.
- biomarker_validation → endpoints is required. n_total and
  sample_types are required. longitudinal is nice to have.
- pilot_exploratory → sample_types is required. Everything else
  is nice to have.

Do NOT include all 8 fields as required for every request.

**hard_negatives rules:**

Always include:
- n_total_less_than_30

Include if commercial:
- commercial_use_allowed_false

Include only if use case demands:
- no_controls (only for model_training)
- no_longitudinal (only if user explicitly needs progression)

**scope_notes:**

One or two sentences that tell downstream skills what matters most
for this specific request. This is the "brief" that shapes how
vcro-cohort-map prioritises results.

Example: "User needs large blood cohorts for AD and ALS model training.
Prioritise n and longitudinal coverage over endpoint specificity.
Controls are essential. Commercial use required."

### Step 6 — Hand off

Pass request.json to vcro-os or directly to vcro-cohort-map.

## Output side rules (for vcro-os to enforce)

These rules govern how the final output is shaped. They live here
because understanding the request is what determines the right output
density.

**Top N, not all N:**
- Show the 3 to 5 best cohorts for this use case
- Show only the fields that matter for the decision
- If there are 87 grade A/B cohorts, the user does not need 87 rows.
  They need: "Here are the 4 best options and why."

**Statement strength matches evidence:**
- "This cohort has 1,393 participants with plasma and longitudinal
  follow up" — good, backed by methods extraction
- "This is an excellent cohort for your needs" — bad, inflated
- "Metabolomics may be feasible" — bad, vague

**Uncertainty in one line:**
- "Commercial access: unknown. DUA not publicly available." — good
- "While the commercial access situation remains unclear and would
  require further investigation to determine whether..." — bad

**Exclusion log is proof, not clutter:**
- Keep it in a separate section
- It exists so the customer knows you were thorough
- Do not mix exclusions into the main recommendations

## Model allocation

Opus. This is a one-time call per request and the quality of the
structured output drives everything downstream. Do not use haiku
for this skill.
