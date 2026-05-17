---
name: vcro-validate
description: "Relevance validation gate. Classifies every search result as RELEVANT, NOT_RELEVANT, or TANGENTIAL with strict rules. Use when search results need filtering before extraction. Sits between search and extraction phases."
---

# vcro-validate

Decide what is worth extracting. Catch garbage before it enters
the pipeline.

## Philosophy

Search is noisy. "Alzheimer cfDNA methylation plasma" matches
papers about plasma cell cancers because "plasma" and "methylation"
are common across fields. Without validation, noise flows through
the entire pipeline and contaminates the recommendation.

This skill is the quality gate. Every search result passes through
it before extraction. The cost is small (Haiku reads title + abstract).
The cost of skipping it is recommending colorectal cancer papers
to an AD customer.

## Input

- `request.json` (indication, modality, use case, scope notes)
- List of search results with title, abstract (if available),
  journal, year, PMC ID or NCT ID

## Workflow

### Step 1 — Read the request

Understand what the user actually needs. Not just the indication,
but the modality, the sample type, the use case. This is your
filter lens.

### Step 2 — For each search result, classify

Read the title and abstract (from meta.json or the search result
itself). Classify into one of three categories:

**RELEVANT**
The paper is clearly about the requested indication AND modality
or sample type. It describes a cohort, study, or dataset that
could answer the user's question.

Examples for "cfDNA in Alzheimer's":
- "Circulating cell free DNA in Alzheimer's disease" → RELEVANT
- "Plasma metabolomics in dementia progression" → RELEVANT
  (AD, plasma, could have cfDNA compatible samples)

**NOT RELEVANT**
The paper is clearly about a different indication, a different
modality with no overlap, a review/editorial with no primary
cohort data, or a methodology paper without a human cohort.

Specific NOT_RELEVANT rules:
- Different indication entirely (e.g. cancer for an AD query)
- Different modality with no overlap (e.g. miRNA for a cfDNA query)
- Mouse/cell/animal models (not human)
- **Reviews, editorials, opinion pieces, and systematic reviews
  that do not describe a primary cohort with original patient data.**
  A review titled "cfDNA biomarkers in AD: a systematic review"
  is NOT_RELEVANT because it has no original cohort you can access.
  The individual studies it references may be relevant, but the
  review itself is not a data source.
- Methodology papers without a human cohort
- Papers where the sample type does not match (CSF only when
  plasma is needed, tissue only when blood is needed)

Examples:
- "Plasma cell dyscrasias management" → NOT RELEVANT
  (plasma cell is a cancer type, not a sample type)
- "Colorectal cancer metastasis via methylation" → NOT RELEVANT
  (different indication entirely)
- "cfDNA in prenatal screening" → NOT RELEVANT
  (cfDNA but wrong application)
- "Cell-free DNA-based liquid biopsies in neurology" → NOT RELEVANT
  (review, no primary cohort)
- "Advances in Alzheimer's Disease Genetic Research" → NOT RELEVANT
  (review, no primary cohort)

**TANGENTIAL**
The paper is related but not a clear match. Could be relevant
depending on how the user defines their scope.

Examples:
- "cfDNA methylation in general neurodegeneration" → TANGENTIAL
  (neurodegeneration includes AD but is broader)
- "Plasma biomarkers in frontotemporal dementia" → TANGENTIAL
  (dementia but not AD specifically)
- "Cell free mitochondrial DNA in aging" → TANGENTIAL
  (cfDNA subtype, aging related, could overlap with AD)

For each result, output:
```json
{
  "id": "PMC12345678",
  "title": "...",
  "verdict": "RELEVANT" | "NOT_RELEVANT" | "TANGENTIAL",
  "reason": "one sentence"
}
```

### Step 3 — Handle the three buckets

**RELEVANT results:** pass directly to extraction pipeline.
No action needed from the user.

**NOT RELEVANT results:** discard. Log in the run folder as
`validation_discarded.json` with one line reason per paper.
This becomes part of the provenance trail.

**TANGENTIAL results:** batch them and present to the user
in ONE message. Group by theme if possible.

Format (in user terms, never mention papers/trials):
"I found N cohorts that are close but not exact matches:

- [Theme 1]: X cohorts in [description]. Example: [cohort name/disease]
- [Theme 2]: Y cohorts in [description]. Example: [cohort name/disease]

Should I include these, or keep it strictly to [exact indication]?"

NEVER frame this as "I found papers" or "I found studies." The
user cares about cohorts and samples, not our internal sources.
Papers and trials are how we find cohorts. The user does not
need to know that.

Rules for the clarification:
- Maximum ONE question per validation pass
- Group tangential results by theme, do not list them individually
- Give enough context for the user to decide (theme + count + example)
- Accept a one word answer ("include" / "strict" / "include theme 1 only")

### Step 4 — Write validation output

Save to the run folder:

`validation_results.json`:
```json
{
  "total_screened": 85,
  "relevant": 42,
  "not_relevant": 35,
  "tangential": 8,
  "tangential_resolved": false,
  "user_decision": null,
  "relevant_items": [
    {"id": "PMID or PMC or NCT", "title": "...", "verdict": "RELEVANT", "reason": "..."}
  ],
  "tangential_items": [
    {"id": "...", "title": "...", "verdict": "TANGENTIAL", "reason": "...", "theme": "general neurodegeneration"}
  ],
  "tangential_themes": [
    {"theme": "general neurodegeneration", "count": 5, "example": "FTD cfDNA methylation study"},
    {"theme": "aging cohorts with plasma", "count": 3, "example": "BLSA longevity metabolomics"}
  ]
}
```

The `tangential_themes` field is critical. Without it, the main session
cannot format a question for the user. Each theme must have a name,
count, and one example. Maximum 3 themes.

NEVER set tangential_resolved to true. NEVER set user_decision.
That is the main session's job after asking the user.

`validation_discarded.json`:
```json
[
  {"id": "PMC12906381", "title": "...", "reason": "Plasma cell cancer, not AD"},
  ...
]
```

Only papers with verdict RELEVANT (or TANGENTIAL that the user
approved) proceed to extraction.

## Edge cases

**Abstract not available:** classify on title + journal alone.
If title is ambiguous and no abstract exists, classify as TANGENTIAL
rather than guessing.

**Review articles:** reviews can be relevant if they describe or
compare cohorts. A review titled "cfDNA biomarkers in Alzheimer's:
a systematic review" is RELEVANT because it likely references
real cohorts. A review titled "Epigenomics in the multiomics era"
is NOT RELEVANT (too broad, no cohort data).

**Large tangential set (>15):** if more than 15 results are
tangential, the search queries were probably too broad. Flag this
to the orchestrator: "Search returned too many ambiguous results.
Consider narrowing queries before re-running."

## Integration point

This skill runs AFTER search and BEFORE extraction. The orchestrator
(vcro-os) must call vcro-validate on all search results before
spawning any extraction subagents.

Sequence: search → validate → (optional user clarification) → extract

## Batch processing

A single Sonnet subagent handles all validation items (typically
50-200). This maintains consistent judgment across edge cases
and avoids merge/deduplication overhead.

Split into parallel batches ONLY if >150 items. The 12-minute
validation time observed in early runs was caused by orchestration
delay (Opus processing between phases), not classification speed.
With fast handoff from search to validate, a single subagent
classifies 200 items in ~5-8 minutes.

The subagent receives a JSON array of {"id", "title"} objects
and returns a JSON array of classifications, plus writes
`validation_results.json` to the run folder.

## Model allocation

Sonnet. Validation requires enough reasoning to classify edge
cases (e.g. "Plasma Cell Dyscrasias" is NOT_RELEVANT despite
containing "plasma"). Haiku is too terse and plans instead of
classifying.
