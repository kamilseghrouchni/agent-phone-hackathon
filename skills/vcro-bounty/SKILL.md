---
name: vcro-bounty
description: "Bounty mode: user posts a budget and desired outcome, system acts as a procurement orchestrator across the full sample pipeline — sourcing, screening/QA, and assay. Coordinates sources (cohorts, hospitals, broker bypass, surplus trials, commissioned collection), CRO screening partners, and assay providers into a single budgeted plan. Two strictly sequential stages: (1) figure out what package makes sense across all three legs, (2) orchestrate acquisition."
---

# vcro-bounty

Sample procurement orchestration. The user posts a bounty — a budget plus
a desired outcome. The system designs and coordinates the entire pipeline
from sample collection to data delivery.

## The three-leg pipeline

Every bounty has three cost legs. Most researchers only price one.

```
Leg 1 — Source       Leg 2 — Screen/QA       Leg 3 — Assay
─────────────────    ──────────────────────   ──────────────────
Where samples        CRO validates quality    Platform runs the
come from and        before committing        measurement and
what they cost       budget to assay          delivers data
```

**The agent's job**: find the optimal provider for each leg, allocate
the budget across all three, and coordinate the handoffs between them.
A bundle is not just a sample source — it is a complete three-leg plan.

The user sets the budget once. The agent decides how to split it.

## Philosophy

The value is not in paperwork. The agent earns its place when it computes
something the user genuinely cannot do as well alone:

- Designing the full three-leg stack, not just finding samples
- Reverse-engineering broker supply networks from literature to find direct hospital sources
- Identifying CROs that can screen the specific sample type for the specific assay
- Allocating budget across legs to maximize scientific yield
- Surfacing surplus inventory, commissioned collection, and bypass routes
- Flagging infeasibility early with minimum viable relaxation

**Two stages. They must never mix.**
Stage 1: figure out what three-leg package makes sense.
Stage 2: orchestrate acquisition across all legs. Nothing from Stage 2
begins until the user has confirmed the full plan from Stage 1.

## Model allocation

| Phase | Model | Rule |
|---|---|---|
| 0, 0.5 | Opus (main session) | Constraint classification + feasibility math — small calls, no subagent |
| 1: source discovery | Haiku subagent | Script calls + artifact queries + compliance flagging |
| 2: cost stack | Sonnet subagent | Cite every number to pricing-data.md; write cost_stack.json |
| 3: bundle optimization | Sonnet subagent | Assemble 3 bundle configs; write bundle_candidates.json |
| 5: action map | Haiku subagent | Route per source; write action_map.json |
| 6: outreach angles | Sonnet subagent | Personalized PI emails + call scripts |
| 7: bounty contract | Sonnet subagent | Assemble bounty_contract.md |

Opus orchestrates — NEVER reads raw JSON inline (cost_stack.json,
bundle_candidates.json). Read only 3–5 sentence digests from subagents.

## Run state

Log every phase:
```bash
python3 scripts/run_state.py {run_dir} start bounty_parse
python3 scripts/run_state.py {run_dir} complete bounty_parse --artifact bounty_spec.json
python3 scripts/run_state.py {run_dir} start feasibility_check
python3 scripts/run_state.py {run_dir} complete feasibility_check
# ... and so on for every phase
```

On crash recovery: `run_state.py status` → resume from first incomplete phase.

---

## Stage 1: Figure Out What Package Makes Sense

### Phase 0 — Bounty requirements + constraint classification

**Input**: natural language bounty post (budget + desired outcome, criteria optional)

Classify every stated requirement:

- `hard` — cannot change without breaking science or legal basis: commercial use required, specific biomarker assayed, minimum N for statistical power, specific regulatory consent scope
- `soft` — can adapt with good reason and user agreement: sample type, geography, timeline, specific cohort, longitudinal vs cross-sectional
- `budget` — treat as hard; allocate across the three legs (sourcing / screening+QA / assay). If the user only names a total, the agent proposes the allocation and flags it for confirmation. Default starting split: 30% sourcing / 15% screening+QA / 45% assay / 10% overhead — but this shifts significantly by indication and source type.
- `implicit` — unstated but logically required from the use case:
  - want metabolomics → need non-hemolyzed plasma
  - want longitudinal → need ≥2 timepoints in the same subject
  - want commercial use → need consent scope that permits it
  - want rare disease biomarker → expect 2–3× base pricing

Maximum 1 clarifying question, and only if the ambiguity changes hard vs. soft classification. Never ask what is implied.

**Output**: `store/runs/{run_id}/bounty_spec.json`
```json
{
  "budget_total": 50000,
  "budget_allocated": {"samples": 30000, "assay": 15000, "overhead": 5000},
  "hard_constraints": ["commercial_use_allowed", "n_min_150", "plasma_or_equivalent"],
  "soft_constraints": ["geography_EU", "timeline_12wk", "longitudinal"],
  "implicit_constraints": ["non_hemolyzed", "fasting_preferred"],
  "prize_conditions": ">=150 samples, metabolomics-grade plasma, commercial use allowed, within EUR 50K all-in",
  "authority_level": "draft_and_preview"
}
```

### Phase 0.5 — Pre-search feasibility check

Before any search, check if the bounty can mathematically close.
Use only verified figures from `references/pricing-data.md`. No invented ranges.

Anchor on the **cheapest verified source** for the sample type:
- ADNI: free data via LONI
- NACC: free
- NIA: EUR 7.91–29.09/vial
- Lifelines: EUR 3.70–28.00/sample (volume-dependent)

Anchor on the **most accessible verified assay** for the modality:
- Nightingale NMR metabolomics: EUR 22–44/sample (derived, pricing-data.md)
- Biocrates kit-based: EUR 100–129/sample (historical, pricing-data.md)
- Metabolon untargeted: EUR 800–1500/sample (estimated, pricing-data.md — low confidence)

If even the cheapest verified option exceeds the budget: **infeasible as stated**. Do not proceed to search.

**If infeasible**: do not fail. Be resourceful.
1. Identify which soft constraint to relax first for maximum budget headroom
2. State the scientific cost precisely: "dropping longitudinal means cross-sectional only — you lose the ability to compute delta biomarkers over time"
3. Propose adapted prize conditions and ask user to confirm before proceeding

If feasible: proceed to Phase 1.

### Phase 1 — Source discovery (Haiku subagent)

Run two parallel discovery tracks. Both must complete before moving to Phase 2.

---

#### Track A — Cohort track (academic, government, surplus)

Trigger fast search or reuse prior vcro-os run artifacts.
Focus exclusively on sources that pass hard constraint checks.

Discovery angles — in priority order:

1. **Surplus/unadvertised inventory**: query clinicaltrials_api.py for completed trials with `biospecimen_retention=YES`, phase 2 or 3, relevant indication. These samples exist, are often not advertised, and PIs are typically motivated to recover value from them.

2. **Government and academic biobanks**: free or near-free sample access but often restrict commercial use. Check consent scope from `access_and_ownership.txt` explicitly — do not assume.

3. **Multi-site aggregation**: if no single source meets the N target, identify complementary smaller sources that could be combined. Flag harmonization risk immediately (different collection protocols, tube types, storage).

4. **Assay-locked sources**: Nightingale ships kits to site — samples do not need to move. Relevant when samples are at an institution that restricts external shipment.

Reuse from prior pipeline run if available:
- `contacts.json` — PI names, emails, IRB numbers, portal URLs
- `access_summary.json` — access routes, timelines, commercial use flags
- `ranking.json` — top cohorts already ranked for fit

---

#### Track B — Commercial broker reverse-engineering track

Commercial brokers (BioIVT, Discovery Life Sciences, iSpecimen, Precision for Medicine, REPROCELL Bioserve, ABS Bio) do not publish their hospital supplier networks. But the literature does.

**Step 1 — Mine the literature for broker citations**
Search PubMed and Europe PMC for papers in the target indication that cite commercial brokers as sample sources. Search terms:
- `"[indication] AND (BioIVT OR "Discovery Life Sciences" OR iSpecimen OR "Precision for Medicine" OR Bioserve OR "ABS Bio")`
- Also search methods sections: "samples were obtained from", "biospecimens were purchased from", "commercially available samples"

For each paper found: extract the broker name, institution that provided samples to the broker (often named in the methods or acknowledgements), sample type, disease state, and collection year range.

**Step 2 — Map broker → source institution**
Build a broker supply network map for the target indication:
```
BioIVT → [Hospital A (plasma, ALS, 2019-2023), Registry B (serum, ALS controls, 2020-2022)]
Discovery Life Sciences → [Hospital C (PBMC, ALS, 2021), ...]
iSpecimen → [...]
```

If the source institution is named: flag it as a **direct access candidate** — a hospital or registry that supplies commercial brokers and may accept direct procurement requests at cost-recovery pricing.

**Step 3 — Direct vs. broker cost comparison**
For each source institution identified:
- Broker route: quote-only (note in cost stack as `requires_quote`), fast (2–6 weeks), turnkey consent/QC/shipping handled
- Direct route: cost-recovery pricing using analogues from pricing-data.md (hospital biobank: USA Health $8-35/sample, BMC $12-43/sample), slower (1–4 months), buyer handles IRB/DUA, but 50–70% cheaper

Flag the delta. Let the user choose based on timeline vs. budget priority.

**Step 4 — Identify broker-only inventory**
Some brokers hold samples from sources not in the literature at all — proprietary collections from contracted hospital networks. These cannot be bypassed. Flag these separately: `broker_proprietary` — approach the broker directly, no bypass possible.

**Output from Track B**: list of (broker, source_institution_if_known, bypass_feasibility, estimated_direct_vs_broker_cost_delta) per source found

---

#### Track C — CRO and screening provider discovery

For Leg 2 (screen/QA), identify which CROs or service providers can validate sample quality before the assay budget is committed.

**Why this leg matters**: committing Leg 3 (assay) budget before QA is the most common way bounties fail. A failed hemolysis check or low yield on 50% of samples after the assay is already running destroys the project. Leg 2 is insurance — it costs 5–15% of total budget and protects the other 85%.

**What CRO screening covers** (match to the assay type):
- Pre-analytical QC: hemolysis index, protein concentration, freeze-thaw cycle count, storage temperature log
- Yield assessment: confirm sufficient volume/concentration for the intended assay
- Matrix compatibility: confirm sample matrix is compatible with the assay platform (e.g. EDTA plasma vs. heparin plasma for NMR)
- Pilot run: run 5–10 samples through the assay before full commitment

**CRO discovery approach**:
1. Search `vcro-source` artifacts (`provider_intelligence.json`) for CROs already identified in the pipeline run
2. Search PubMed methods sections for CRO names cited alongside QC or pre-analytical validation steps in the target indication
3. Web search: "[indication] sample QC CRO", "[assay type] pre-analytical validation service"
4. Check whether the assay provider (Leg 3) offers integrated QC — Nightingale includes QC in their NMR workflow; Metabolon has a sample QC step; EMBL requires minimum sample volume/quality metrics before run

**Cost estimates for Leg 2** (flag all as `estimated` — no published CRO QA rate cards in pricing-data.md):
- Basic pre-analytical QC panel (hemolysis, protein, volume check): ~$5–20/sample estimated
- Matrix compatibility + yield assessment: ~$15–40/sample estimated
- Pilot assay run (5–10 samples): cost of mini-batch at assay provider, typically 20–30% above per-sample rate
- Full QC + pilot: ~$25–60/sample estimated all-in

These are estimates with no verified source — treat as planning ranges only. Always request formal quotes before committing.

**Output from Track C**: list of (CRO/provider, services offered, compatibility with identified assay provider, estimated cost range, contact route)

---

#### Combined Phase 1 output

Merge Track A and Track B into a single candidate list. Flag each source with:
- `source_type`: cohort / commercial_broker / direct_hospital / surplus_trial
- `commercial_use`: confirmed / unconfirmed / requires_negotiation
- `bypass_possible`: true (source institution identified) / false (broker_proprietary) / N/A
- Estimated N available
- Access route

Digest to Opus: max 12 lines, name real sources, flag the best bypass opportunity if found.

### Phase 2 — Cost stack per source (Sonnet subagent)

For every candidate source, build a full cost-from-freezer-to-data estimate.

**Data rule: in this field, in god we trust — all others must bring data.**

Every line item must cite a specific entry in `references/pricing-data.md`. No invented ranges.

The cost stack has three legs. Build all three for every candidate bundle.

**Leg 1 — Sample acquisition**
   - If source is in pricing-data.md (ADNI, NACC, Lifelines, UK Biobank, NIA, EMBL, Baylor, Duke, Boston Core, USA Health): use the published or derived figure verbatim with its confidence tag
   - If source is an unknown hospital or core lab: find the nearest verified analogue in pricing-data.md by institution type, cite it explicitly: "No published pricing. Nearest verified analogue: Boston University Core (EUR 12–43/sample). Official quote required to confirm."
   - If no analogue exists in pricing-data.md: `"sample_cost": "unknown — no comparable verified data. Official quote required."` — full stop, no number

**Leg 2 — Screening/QA (CRO)**
From Track C findings. Flag all as `estimated` — no published CRO rate cards in pricing-data.md.
- Basic QC (hemolysis, protein, volume): ~$5–20/sample estimated
- Matrix compatibility + yield: ~$15–40/sample estimated
- Pilot run at assay provider: mini-batch rate (20–30% above per-sample rate)
- Always flag: "official quote required from [CRO name]"

**Leg 3 — Assay** — pricing-data.md only:
   - Nightingale NMR: EUR 22–44 (derived from 2023 financials, confidence: derived)
   - Metabolon untargeted: EUR 800–1500 (estimated, confidence: low)
   - Biocrates kit-based: EUR 100–129 (historical kit price, confidence: estimated)

3. **Shipping** — flag as `requires_quote` unless a verified figure exists; note geography (intra-EU vs trans-atlantic)

4. **Processing/QC** — state as percentage of assay cost if known from a source, otherwise `requires_quote`

5. **DUA/legal overhead** — if published (UK Biobank GBP 9K/3yr): cite it. Otherwise: `requires_negotiation`

**Output**: `store/runs/{run_id}/cost_stack.json`
```json
{
  "source": "Lifelines",
  "components": [
    {
      "item": "sample_acquisition",
      "low": 3.70, "high": 28.00, "unit": "EUR/sample",
      "basis": "Lifelines tariff card 2023, references/pricing-data.md",
      "confidence": "published"
    },
    {
      "item": "assay_nightingale",
      "low": 22, "high": 44, "unit": "EUR/sample",
      "basis": "Nightingale 2023 annual report financials, references/pricing-data.md",
      "confidence": "derived"
    },
    {
      "item": "shipping",
      "low": null, "high": null,
      "basis": "requires_quote", "confidence": "unknown"
    },
    {
      "item": "dua_overhead",
      "low": null, "high": null,
      "basis": "requires_negotiation", "confidence": "unknown"
    }
  ],
  "total_known_low": 25.70,
  "total_known_high": 72.00,
  "unknown_components": ["shipping", "dua_overhead"],
  "note": "Total excludes shipping and DUA — request quote to complete"
}
```

**Never produce a total cost figure when unknown components exist.**
Show the known range + list unknowns explicitly. The user decides whether to proceed.

### Phase 3 — Bundle optimization (Sonnet subagent)

Assemble the package that satisfies all hard constraints within budget.
Produce exactly 3 bundle configurations. Always consider both Track A (cohorts) and Track B (commercial broker vs. direct hospital) sources when assembling bundles. A bundle can mix source types — e.g., 100 samples direct from a hospital BioIVT supplies + 50 from a completed trial.

- **Max coverage** — most N, most modalities, within budget. May mix direct hospital + surplus trial.
- **Fastest to close** — shortest access timeline, within budget. Commercial broker or self-serve sources prioritized even if more expensive.
- **Cheapest / bypass** — lowest per-sample cost using direct hospital routes identified in Track B, bypassing broker markup. Slower but maximizes budget headroom.

For each bundle, show the full three-leg pipeline plan:

```
BUNDLE [X] — [name]
────────────────────────────────────────────────────
LEG 1 · SOURCE       [provider], [N] samples, [access route]
                     Cost: [low–high], [confidence], [basis]
                     Timeline: [weeks to samples shipped]

LEG 2 · SCREEN/QA   [CRO or assay provider QC], [services]
                     Cost: [low–high], estimated (no published rate)
                     Timeline: [weeks], runs in parallel with Leg 1 contracting

LEG 3 · ASSAY        [platform], [N metabolites/biomarkers]
                     Cost: [low–high], [confidence], [basis]
                     Timeline: [weeks from sample receipt to data]

TOTAL KNOWN:         [sum of known components]
UNKNOWN COMPONENTS:  [list]
HANDOFF SEQUENCE:    Leg 1 contract → ship to [CRO] → QC pass gate → ship to [assay] → data
BUDGET ALLOCATION:   Leg1: X% / Leg2: Y% / Leg3: Z% / overhead: W%
SCIENTIFIC RATIONALE: [what this bundle delivers and what it doesn't]
────────────────────────────────────────────────────
```

Surface optimization signals:
- **Volume threshold arbitrage**: "adding 20 samples crosses the 500-sample tier — per-sample cost drops EUR 34 → EUR 22, total savings EUR 240"
- **Geographic arbitrage**: EU cost-recovery biobanks vs US commercial for the same sample type — flag if user's criteria are geography-agnostic
- **Modality bundling**: "Lifelines includes NMR metabolomics in the base cost — you get metabolomics + genomics for the price of one collection"
- **Surplus opportunity**: "Trial NCT01234567 completed 18 months ago with biospecimen_retention=YES — PI motivated to place these, likely negotiable below market rate"

**Output**: `store/runs/{run_id}/bundle_candidates.json`

Digest to Opus: 3–5 sentences covering recommended bundle, key trade-offs, total cost range, and one surprising finding (surplus, volume break, geographic arbitrage).

### Phase 4 — Bundle review (user gate)

Opus presents the recommended bundle to the user. User must confirm before Stage 2 begins.

Show:
- Which bundle is recommended and why
- What each alternative trades off
- Whether any hard constraint had to flex and the scientific cost of that
- Total known cost breakdown + list of unknown components requiring quotes
- Whether the prize conditions are fully met or partially met

**No action planning begins until user confirms the bundle.**

---

## Stage 2: Act to Acquire the Bundle

### Phase 5 — Action map (Haiku subagent)

For each source in the confirmed bundle, classify where the agent adds value:

**Tier 1 — Compute** (agent does non-obvious work, user takes the simple action):
- `surplus_outreach` — non-advertised inventory, PI likely motivated; agent identifies the angle
- `broker_bypass` — agent identified the hospital that supplies the broker from the literature; show the delta (broker quote-only vs. direct cost-recovery estimate), let user decide speed vs. cost trade-off
- `opaque_cost_confirmed` — pricing heuristic with analogue cited; agent produces the estimate, user confirms with quote
- `harmonization_flag` — specific pre-analytical incompatibility between sources; agent flags, user decides
- `volume_threshold_alert` — agent identifies the break point; user decides whether to adjust N

**Tier 2 — Angle** (intellectual framing is the value, not the draft):
- `pi_outreach` — personalized email grounded in the PI's specific paper, using their terminology, framed as "validate your finding" not "buy your samples". This is the actual intellectual work.
- `cold_call_script` — question sequence for the source type (biobank admin / PI / CRO sales) + expected response tree
- `voice_ai` — parameterized script if voice AI is available

**Tier 3 — Link** (self-service exists; just surface it):
- `self_serve` — direct link + what to specify in the order (Nightingale, Lifelines)
- `portal_application` — direct link + 3-item checklist of what the user will need to have ready (ADNI, NACC, UK Biobank)

The action map covers all three legs and their dependencies. Some actions must happen in sequence (cannot book assay until QC pass is confirmed). Surface this explicitly.

```
LEG 1 actions → must complete before LEG 2 ships → LEG 2 must pass before LEG 3 commits
```

**Output**: `store/runs/{run_id}/action_map.json`
Per provider across all three legs: `{leg, tier, action_type, depends_on, agent_output, what_user_does_next, estimated_response_time}`

### Phase 6 — Outreach angles (Sonnet subagent)

For every Tier 2 source in the action map, draft the intellectual content.

**PI outreach angle**:
- Read the PI's specific paper from the pipeline run (results section, discussion)
- Identify what they were trying to show and what they found
- Frame the outreach as: "We want to validate your finding in an independent dataset" — this aligns interests
- Use their specific terminology, cite their specific cohort name, reference their specific marker
- Do NOT write a generic "we are interested in your samples" email — that has near-zero reply rate

**Call script**:
- Open: state the specific ask in one sentence
- Qualification questions: sample availability, consent scope, timeline, cost process
- Expected objections and responses: IRB scope concerns, data sharing hesitation, pricing process
- Close: what you are asking them to do next (send info sheet, schedule a call, forward to data manager)

**Output**: per source in action_map.json, populate `agent_output` with the draft content

### Phase 7 — Bounty contract (Sonnet subagent)

Structured document that aggregates all of Stage 1 and gives the agent graded authority for Stage 2.

Sections:
1. **Bounty definition** — prize conditions, hard constraints, soft constraints, budget allocation across three legs
2. **Pipeline plan** — full three-leg stack: source provider + CRO + assay platform, with handoff sequence, costs, and timelines
3. **Agent mandate** — what actions the agent is authorized to take at each leg, up to what budget threshold, what requires user escalation before proceeding
4. **Binding terms** — what confidentiality the agent may agree to on the user's behalf, no-commitment clauses, QC pass/fail gates (if Leg 2 fails, agent stops and reports before committing Leg 3 budget)
5. **Action log** — what was sent, to whom, when — per leg (populated as actions execute)

Format: structure and language should look like a standard CDA/MTA preamble. Counterparties (biobanks, PIs, CROs) recognize this format — it signals a serious, well-organized buyer.

The contract also serves as an internal procurement brief the user can share with legal or finance.

**Output**: `store/runs/{run_id}/bounty_contract.md` → post to Notion if token available

### Phase 8 — Execution (authority-dependent)

Default: `authority_level = "draft_and_preview"` — all materials ready, user executes manually, agent provides tracking checklist per source.

If `authority_level = "execute"`:
- Send approved emails (or generate mailto: links)
- Submit portal applications
- Trigger voice AI calls
- Log every action to run_state.py with timestamp, recipient, and action type

**Preview is always the gate.** Never execute an action without rendering the full draft for the user to review and approve — even in execute mode. Show what will be sent before sending it.

---

## Additional flows

### Commission new collection (CRO mode)
If no existing sources match the bounty: pivot to commissioning fresh collection.
- Identify CROs that do fresh collection for the indication
- Estimate per-subject recruitment + assay cost (typically 3–5× existing sample cost; cite any published CRO rate data if available)
- Compare vs. existing sample procurement: fresh = more controlled, slower, more expensive
- Generate RFP outline for CRO outreach

### Assay provider selection given sample location
If samples cannot move (institutional restriction, consent scope, stability): determine which assay providers can service in-place or accept aliquots.
- Nightingale: ships kit to site, processes centrally — geography agnostic
- Metabolon: requires sample shipment to Durham, NC — check feasibility
- Academic cores (EMBL, Baylor, Duke): require shipped aliquots

Generate assay provider fit matrix: source location × assay provider → feasible / requires_negotiation / infeasible.

---

## Hypotheses to validate before full deployment

### Stage 1 — Discovery
- **H1**: Cost stack anchoring on pricing-data.md analogues is accurate enough (within 30%) to drive bundle feasibility decisions before getting quotes
- **H2**: Completed ClinicalTrials.gov entries with biospecimen_retention=YES represent reachable surplus inventory
- **H3**: Access timeline estimates from vcro-access are reliable enough to eliminate sources against a hard timeline constraint
- **H4**: Multi-site aggregation is scientifically viable with pre-analytical compatibility checks
- **H5 (broker bypass)**: Commercial broker source institutions are nameable from literature methods sections often enough (>40% of papers) to make the bypass track systematically useful, not just occasionally lucky

### Stage 2 — Action
- **H5**: Personalized PI outreach framed as "validate your finding" has meaningfully higher reply rate than generic inquiry
- **H6**: Commercial biobanks (BioIVT, Discovery Life Sciences) accept structured RFQ emails with a spec format
- **H7**: Voice AI call scripts accelerate response for time-sensitive or surplus inquiries
- **H8**: The bounty contract format creates trust with counterparties and accelerates DUA negotiation

Run the validation sprint before building Phase 6 (outreach) and Phase 7 (contract) in full:
1. Test cost stack accuracy: 5 known sources with published prices, apply analogue method, measure error
2. ClinicalTrials surplus signal: completed + biospecimen_retention=YES — how many have active contact info?
3. BioIVT/Discovery inquiry surfaces: do they accept spec-format RFQs?
4. Lifelines catalog: publicly queryable? Per-sample pricing visible?
5. Nightingale order flow: minimum info needed to generate a quote link?

---

## Critical rules

1. Stage 1 always completes and is confirmed by the user before Stage 2 begins — no exceptions
2. Every cost figure must cite a specific entry in pricing-data.md. No invented numbers.
3. If no verified analogue exists for a source's pricing, output "official quote required" — not a range
4. Never produce a total cost figure when unknown components exist — show knowns + flag unknowns
5. Outreach angles must be grounded in the PI's specific paper — not a generic template
6. Opus reads only digests from subagents — never cost_stack.json or bundle_candidates.json inline
7. Log every phase to run_state.py before and after
8. Preview is always the gate for execution — show before sending, always
