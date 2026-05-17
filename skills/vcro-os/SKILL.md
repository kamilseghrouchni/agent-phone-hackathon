---
name: vcro-os
description: "Pipeline orchestrator. Drives the full vCRO pipeline from a natural language request to a decision-ready cohort recommendation. Use when a user sends a cohort or data sourcing request and you need to run the full pipeline end to end."
---

# vcro-os

Orchestrate the full Virtual CRO pipeline. The output is a decision,
not a data dump.

## Philosophy

The system exists to close the gap between "I need cohort data" and
"here are your 3 best options with evidence and access routes."

Three rules govern everything:

1. **Understand the application, not just the words.** A request for
   "metabolomics data on AD cohorts" means different things depending
   on whether it is for model training, biomarker validation, or
   exploratory analysis. The system must detect this and adjust.

2. **Speak in user terms, not internal terms.** Papers and
   clinical trials are how we find cohorts. The user never needs
   to know that. They care about cohorts, samples, institutions,
   access routes, and providers. Every progress message, question,
   and recommendation must be framed in terms of what the user gets.

3. **Communicate just the right amount.** Not every cohort. Not every
   field. Not every caveat. Only what the customer needs to make a
   decision without doing additional research.

## Input

A natural language request from a user or customer.

## Run state: a ledger, not a scheduler

`run_state.py` records what happened. It does not drive orchestration.
This skill file owns the sequence.

Use `run_state.py` for:
- **Crash recovery.** New session opens run folder, calls `status`,
  sees which phases completed, resumes from the first incomplete one.
- **Progress tracking.** `status` gives a human-readable view.
- **Artifact tracking.** Each completed phase logs which files it wrote.

```bash
# At run start
python3 scripts/run_state.py {run_dir} init {request_json}

# After each phase
python3 scripts/run_state.py {run_dir} complete {phase} --artifact {file}

# Skip optional phases
python3 scripts/run_state.py {run_dir} skip notion_create "webapp mode"

# Crash recovery: see where we are
python3 scripts/run_state.py {run_dir} status
```

Optional phases (can be skipped without affecting the pipeline):
`notion_create`, `tangential`, `context_package`

Mark every phase — even trivial ones. Silent execution without
state updates defeats crash recovery.

## Workflow

The orchestrator (Opus main session or webapp backend) owns the
sequence. It walks through the phases below in order, spawning
subagents for each, and collecting their digests. It does NOT
process data itself.

### Phase 0 — Understand

1. Parse the request into `request.json` (following vcro-understand)
2. Create run directory and init run state
3. If genuine gaps (max 2), ask user. Otherwise proceed.

Model: Opus inline. This is the only phase where Opus does real work.

### Phase 1 — Notion (optional)

If a Notion token is available and delivery to Notion is desired:
1. Create Notion page with placeholder text
2. Share link with user
3. `complete notion_create`

Otherwise: `skip notion_create "webapp mode"`. Never let this block
the pipeline.

### Phase 2 — Search

Spawn a **Haiku subagent**:
- Read `skills/vcro-cohort-map/SKILL.md` Phase A
- Run initial parallel searches (PubMed + Europe PMC + ClinicalTrials)
- Run adaptive expansion (mandatory — authors, cohort names, recency)
- Save results to the run folder
- Write full results to `{run_dir}/search_results.json`
- Return digest: named cohorts spotted, source counts, any notable gaps

Main session receives digest only. `complete search`

Progress message to user (from digest):
"Spotting some strong leads — [name 1], [name 2], and [name 3].
Narrowing down now. Give me a couple more minutes."

### Phase 2.5 — Validate

Spawn **one Sonnet subagent** immediately after receiving the search
digest. Do not re-read skills or deliberate — the gap between search
and validate must be seconds, not minutes.

The subagent:
- Classifies each result as RELEVANT / NOT_RELEVANT / TANGENTIAL
- Writes `{run_dir}/validation_results.json`
- Appends findings to `{run_dir}/progress.jsonl` as it works
- Returns digest: counts + tangential themes formatted as a ready-to-send
  user question (so Opus can send it verbatim)

Main session receives digest. `complete validate`

If tangential items exist, Opus sends the pre-formatted question to the
user. Waits for response. Records decision. `complete tangential` or
`skip tangential "user chose strict"`.

Model: **single Sonnet subagent**. Split into parallel batches ONLY
if >150 results. The 12-minute gap in the first run was orchestration
delay, not classification time.

### Phase 3 — PMID mapping + section fetch

Spawn a **Haiku subagent**:
- Run `pmid_to_pmc.py` on all relevant PMIDs
- Run `pmc_fetch.py` in batches of 10
- Return digest: "Mapped N/M to PMC. Fetched N paper section sets."

`complete pmid_map`. `complete section_fetch`.

### Phase 4 — Extract (scope-driven, BATCHED)

Spawn a **Haiku coordinator subagent** that handles the entire
extraction phase. The coordinator:

1. Reads `{run_dir}/validation_results.json` to get the relevant paper list
2. Splits papers into batches of 8–10
3. Spawns 2–3 **Sonnet extraction subagents** in parallel
4. Each Sonnet subagent:
   - Reads vcro-cohort-map Phase B
   - Receives scope_notes and path to intelligence-dimensions.md
   - Writes output to `{run_dir}/extracted_cohorts_{batch_n}.json`
5. The coordinator merges batch files into `{run_dir}/extracted_cohorts.json`
6. Returns digest to Opus: "N cohorts extracted, top names: X, Y, Z"

This keeps all batch-splitting, ID listing, and merging OUT of the
Opus main session. Opus sends one message ("run extraction") and
gets back one digest.

`complete extract --artifact extracted_cohorts.json`

Progress message: "Diving into [X] and [Y] details now..."

### Phase 5 — Signal

Spawn a **Sonnet subagent** following vcro-signal:
- Reads results_primary.txt and limitations_and_conclusion.txt
- Writes `{run_dir}/signal_summary.json`
- Returns digest: consistent biomarkers, realistic AUC expectations,
  key negative results

`complete signal --artifact signal_summary.json`

### Phase 6 — Contacts + Provider + Access (parallel)

Spawn THREE subagents simultaneously:

| Subagent | Model | Skill | Output |
|---|---|---|---|
| Contacts | Haiku | vcro-contacts | `contacts.json` |
| Provider | Sonnet | vcro-source | `provider_intelligence.json` |
| Access | Sonnet | vcro-access | `access_summary.json` |

Each writes to the run folder and returns a digest.
`complete contacts`, `complete provider`, `complete access`.

### Phase 7 — Rank

Spawn a **Sonnet subagent** following vcro-rank:
- Reads extracted_cohorts.json + scope_notes + access_summary.json
- Writes `{run_dir}/ranking.json`
- Returns digest: top 5 names and one-line "why" for each

`complete rank --artifact ranking.json`

### Phase 8 — Deliver

Spawn a **Sonnet subagent** following vcro-deliver:
- Reads ALL run artifacts: ranking, extraction, signal, contacts, provider, access
- Writes `{run_dir}/recommendation.md`
- If Notion page exists: posts via `md_to_notion.py` in one clean write
- Returns digest: one-line answer + top 3 cohort names

Main session sends the user a condensed message + link (if Notion).
`complete deliver --artifact recommendation.md`

## Output quality rules

**The output is a recommendation, not a report.**

**What it means for you (every detail must have an implication):**
Never state a fact without its consequence. Every detail must
answer "so what does this mean for my project?"

Good:
"Fasting plasma in EDTA tubes, stored at -80C. This means
metabolomics results will be comparable to most published
AD studies. Non-fasting cohorts shift ~30% of metabolites,
making cross-study comparison unreliable."

Bad:
"Fasting plasma collected in EDTA tubes." (fact, no implication)

The rule: if you cannot finish the sentence with "which means
for your project..." then do not include the detail.

**Top N, not all N:** 3 to 5 best cohorts, not the full inventory.

**Statement strength matches evidence.** Do not inflate.

**Uncertainty in one line.** Do not write paragraphs of caveats.

**Exclusion log** (separate section): one line per excluded cohort.
Proves thoroughness without cluttering the recommendation.

**Provenance** (footer): sources searched, papers screened, run timestamp.

**Intelligence dimensions (query-driven, not checklist):**
Read `references/intelligence-dimensions.md` for the full vocabulary
of 18 dimensions. Do NOT use all 18 for every cohort.
scope_notes from request.json determines which 5–8 matter for THIS run.

**What NOT to include in the main output:**
- All 87 cohorts in a table
- Every field for every cohort
- Raw JSON or score breakdowns
- Repeated disclaimers about uncertainty

## Output format

- **Webapp:** recommendation.md rendered in the webapp UI
- **Notion (optional):** same content posted via md_to_notion.py
- **Chat summary:** condensed 3–5 sentences + link to full recommendation

## Model allocation

### Main session (Opus)

Opus orchestrates. It does NOT process data.

**Opus is allowed to:**
- Read skill files
- Make orchestration decisions (which phases, which models, which batches)
- Write `request.json` (vcro-understand)
- Spawn subagents
- Read subagent digests (2–5 sentences, not raw JSON)
- Send progress messages to the user
- Update run state

**Opus is NOT allowed to:**
- Read raw script JSON output (search results, extracted cohorts, signal JSON)
- Run search/fetch scripts directly
- Classify validation results inline
- Extract intelligence from paper sections inline
- Read `extracted_cohorts.json` or `signal_summary.json` in full

Every time you're about to read a JSON file with dozens of entries
or process a script's raw output — stop. Spawn a subagent.

### Subagent model selection

| Phase | Model | Notes |
|---|---|---|
| Search | Haiku | Runs scripts, decides expansion queries |
| Validate | Sonnet | Single subagent; split only if >150 items |
| PMID map + fetch | Haiku | Pure script execution |
| Extract | Sonnet | Batches of 8–10 papers, parallel |
| Signal | Sonnet | Cross-paper synthesis |
| Contacts | Haiku | Schema fill from meta.json |
| Provider intel | Sonnet | Cross-source synthesis |
| Access routes | Sonnet | Timeline and cost judgment |
| Rank | Sonnet | Reads 3+ artifacts |
| Deliver | Sonnet | Assembles markdown from artifacts |

### Subagent output contract

Every subagent must:
1. Write full output to `store/runs/{run_id}/{artifact_name}.json`
2. Append progress findings to `store/runs/{run_id}/progress.jsonl` as it works
3. Return a 3–5 sentence digest to the main session

The main session acts on the digest. It never reads the full output.

Never rely on internal tool result cache paths (`.claude/projects/...`).
They are ephemeral. Only the run folder is the contract.

### Progress reporting from subagents (progress.jsonl)

Every subagent prompt MUST include this instruction:

```
As you work, append findings to {run_dir}/progress.jsonl — one JSON
object per line. Write a line when you discover something the user
would care about. Do NOT wait until you're done.

Format:
{"ts":"<iso-timestamp>","phase":"{phase}","event":"finding","message":"..."}
{"ts":"<iso-timestamp>","phase":"{phase}","event":"progress","message":"..."}

Event types:
- "finding": a named result with implication (cohort name, AUC, key insight)
- "progress": batch completion or phase transition
- "question": something needs user input
- "error": something failed

To append a line in Python:
import json, datetime
with open("{run_dir}/progress.jsonl", "a") as f:
    f.write(json.dumps({"ts": datetime.datetime.now(datetime.timezone.utc).isoformat(), "phase": "{phase}", "event": "finding", "message": "..."}) + "\n")

FRAMING RULE: Messages must be outcome-focused, not output-focused.
The user does not care about papers, databases, or pipeline mechanics.
They care about insights and discoveries related to their question.

Bad: "Validated 60 of 197 papers as relevant"
Good: "The ether lipid signal in AD converters is replicated across ADNI and ASPREE — strongest proof point so far"

Bad: "Fetching full text for 59 PMC articles"
Good: "Michigan ALS cohort has AUC 0.94 replicated in two independent cohorts. Checking CSF options next."
```

The user can watch progress live in a separate terminal:
```bash
python3 scripts/progress_watch.py store/runs/{run_id}
```

### Opus token budget

If you have:
- Read more than 2 full JSON files inline → over-budget, spawn a subagent
- Run more than 3 bash script commands inline → over-budget
- Processed any raw search output inline → mistake

The main session should never see more than 5 lines of data output
from any single operation.

## Progress updates (mandatory)

Progress comes from two channels:

1. **progress.jsonl** — subagents write findings as they discover them.
   The user can watch live via `progress_watch.py` (CLI) or the SSE
   endpoint (webapp). This runs automatically — no Opus involvement.

2. **Main session messages** — Opus sends a message to the user at
   each phase transition, using the subagent digest. This is the
   conversational layer.

### Framing rule: outcome-focused, never output-focused

The user does not care about papers, databases, validation counts,
or pipeline mechanics. They care about insights related to their
question.

Bad (output-focused):
"Validated 59 of 197 papers. Fetching full text..."
"Phase 2 complete. Moving to Phase 3."
"28 relevant, 52 discarded, 17 tangential."

Good (outcome-focused):
"Found longitudinal plasma lipidomics in ADNI (n=1,517) and a
replicated ALS diagnostic panel at Michigan (AUC 0.94). Checking
if the evidence holds up across independent cohorts..."

"Important negative: pre-diagnostic ALS prediction from blood
metabolomics has been tried and failed. Your model will need
NfL or imaging for early ALS detection."

Every message must:
- Name a cohort, biomarker, or finding
- Connect it to the user's question
- If negative, say what it means for their project
- Never mention papers, PMIDs, databases, or validation counts

### Main session messaging cadence

- After spawning search: "Looking into [indication] cohorts with
  [sample type]. Give me a few minutes..."
- After search digest: name 2-3 real cohorts from the digest
- After validate digest: top finding + any tangential question
- After extract digest: key proof point or surprising discovery
- After signal digest: realistic expectation (AUC range, key negative)
- After rank digest: "Your top options are X, Y, Z. Assembling
  the full recommendation now."

### Early signals (mandatory)

Before spawning any subagent for a long phase, extract 2–3 named
results from the previous digest and mention them. This takes 5
seconds and prevents minutes of silence.

## Critical rules

- **Adaptive expansion in search is mandatory, not optional.**
- **Never skip the validation gate.**
- **Use subagents for ALL heavy work.** Main session only orchestrates.
- **Never block the main session.** User can always chat.
- **Every phase must be logged in run state.** No silent execution.
- **Fail loud.** If a step fails, surface it. Do not silently skip.
- **Mark every phase complete, including trivial ones.** Run state
  is the crash recovery contract.

## Known pitfalls (from live runs)

These are observed failure modes. They are here so future sessions
don't repeat them.

1. **Opus reads raw script output.** The single biggest token burn.
   All search/fetch/classification output must go through subagents
   that return digests. Opus never sees the raw JSON.

2. **Subagent outputs land in wrong paths.** Subagents sometimes write
   to internal tool result cache instead of the run folder. Every
   subagent prompt must specify the exact output path:
   `Write output to store/runs/{run_id}/{filename}.json`

3. **Validation digest missing tangential question template.** If the
   subagent just returns counts, Opus has to re-process the classification
   to format the user question — defeating the point. The subagent must
   include the ready-to-send question in its digest.

4. **Optional phases block run state.** `notion_create`, `tangential`,
   and `context_package` must be skipped explicitly if not applicable.
   They are marked OPTIONAL_PHASES in run_state.py.

5. **Sourcing phases skipped accidentally.** Contacts, provider, access,
   and rank are easy to forget after the "science" phases (search →
   extract → signal) feel complete. The recommendation is incomplete
   without sourcing. Always run all phases.

6. **Extraction batches not merged.** Parallel subagents write
   `extracted_cohorts_1.json`, `extracted_cohorts_2.json`. These must be
   merged into a single `extracted_cohorts.json` before downstream
   phases (signal, rank) can use them.
