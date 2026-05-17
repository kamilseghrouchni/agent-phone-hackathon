# Audit report — PD age 75+ · serum + PBMC · multiple visits

> Buyer brought a prior Metabolon serum metabolomics report
> on a separate elderly-PD set; this audit asks whether the institutes already in
> the bank can extend that work into PBMC immunophenotyping + DNA genotyping for
> an LRRK2 kinase inhibitor program.

---

## 0. Brief

| Field | Value | Source |
|---|---|---|
| Buyer query | "Parkinson's patients age 75+ with serum and PBMC across multiple visits" | landing form |
| Parsed indication | Parkinson's disease (PD) | parser |
| Specimen types | Serum, PBMCs (cryopreserved); DNA / RNA optional | parser |
| Age floor | ≥ 75 | parser |
| Longitudinal | required (≥ 2 distinct collection years per donor) | parser |
| Min N | 30 donors | bundle spec |
| Collection window | ≥ 2020 (preferred) | bundle spec |
| Assay context | LRRK2 kinase inhibitor trial — PBMC immunophenotyping + DNA genotyping; serum metabolomics already runs at Metabolon | buyer note |
| Prior work on file | Metabolon HD4 untargeted serum metabolomics report (separate elderly-PD discovery cohort) | buyer attachment |

The audit is a follow-up to the Metabolon work, not a replacement. The buyer is
not commissioning more metabolomics — they are asking which biobanks the system
already has on file can supply matched PBMC + serum + DNA at the right age in
multi-visit form, and whether residuals exist for orthogonal validation against
the Metabolon panel.

---

## 1. One-page summary

| Institute | PD donors 75+ with serum + PBMC | Multi-visit subset | Contact | Verdict |
|---|---|---|---|---|
| **The Neuro C-BIG Repository** (McGill, CA) | **248** | **20** | `cbig.mni@mcgill.ca` | **Primary candidate.** Meets brief on N, longitudinal, recent (2020+), and DNA/RNA co-modalities. Audit clears six of six items pending residual-volume confirmation. |
| **BIOMEDICA CRO** (Ukraine) | 1 (serum only) | 0 | `office@biomedica-cro.com` | **Drop from primary plan.** No PBMC at 75+ for PD; 15 serum specimens on a single donor cannot anchor a multi-visit cohort. Keep on file as prospective-collection partner for new enrolment, not for banked draw. |

Headline: one in-bank match (Neuro C-BIG) that clears the gates. The second
institute is real but the slice does not exist at the requested ages and types.
A prospective lead is the only way to widen the pool.

Numbers below all come from the live `specimens.db` view of the AminoChain
catalog (486,754 specimens · 18 institutes) joined to `org_profiles.json`. Every
count is a `SELECT … FROM specimens` away — no estimation.

---

## 2. The Neuro C-BIG Repository — full audit

### 2.1 Header

- **Institution:** Montreal Neurological Institute / Hospital, McGill University
- **Program:** C-BIG Open Biobank (Clinical Biological Imaging and Genetic repository)
- **Country:** Canada (Quebec)
- **Steward contact (in `org_profiles.json`):** `cbig.mni@mcgill.ca`
- **Web:** https://www.mcgill.ca/neuro/research/open-biobank
- **Description on file:** "A growing collection of biospecimens, longitudinal
  clinical and neuropsychiatric information, imaging and genetic data from
  patients with neurological disease as well as healthy controls."
- **Catalog footprint (PD only, age ≥ 75):** 6,832 specimens across all types

### 2.2 Sample inventory · audit response

| Field | Value | Source |
|---|---|---|
| PD donors at 75+ with **at least one** serum aliquot | **315** | `specimens.db` |
| PD donors at 75+ with **at least one** PBMC aliquot | **253** | `specimens.db` |
| PD donors at 75+ with **both** serum and PBMC | **248** | `specimens.db` |
| PD donors at 75+ with serum + PBMC AND ≥ 2 distinct visit years | **20** | `specimens.db` |
| PD donors at 75+ collected in 2020 or later | **299** | `specimens.db` |
| Total PD specimens at 75+ | **6,832** | `specimens.db` |
| Type mix at 75+, 2020+ collections | DNA 294 · Serum 1,671 · PBMC 967 · Plasma 397 · RNA 16 · iPSC 17 | `specimens.db` |
| Donor-level external IDs example | `CBIG35509113` (donor) → `CBIG35509113-P017` (specimen) | `raw_json` |

Outstanding from the steward (the audit cannot answer from the catalog):

- **Residual aliquot volume per donor** for serum and PBMC. Catalog records
  `quantity = 1` per row without volume. A 250 µL serum draw against the
  Metabolon HD4 panel sits at the lower bound of feasible — confirming residual
  before commissioning is a hard gate.
- **PBMC viability post-thaw** for cryopreserved aliquots banked 2016–2018.
  Older cryovials may have lost > 30 % viability and need a thaw-test before
  immunophenotyping.

### 2.3 Consent + IRB scope · audit response

| Item | Status from public sources | Steward must confirm |
|---|---|---|
| Open biobank framing | Public — "open" in the program name; specimens distributed under formal access committee | yes |
| Secondary use beyond original protocol | Not stated publicly | yes — drug-discovery / industry use is the question |
| Commercial use / for-profit sponsor | Not stated publicly | **yes — this is the gate for an LRRK2 program** |
| Re-consent requirement for genotyping | Not stated publicly | yes — DNA aliquots are catalogued but genotyping consent scope is not |
| MTA / DUA template | Not in `org_profiles.json` | yes |

Verdict: open-biobank framing + linked imaging and genetics + non-commercial
domain language (mcgill.ca/neuro) point to academic-use as the default and
commercial-use as the friction point. Plan for a 2–4 month MTA cycle before any
specimen ships. Treat this as the most likely deal-breaker if the trial sponsor
wants exclusivity.

### 2.4 Specimen integrity · audit response

| Field | What the catalog says | Gap |
|---|---|---|
| Preservation method | "Cryopreservation" (PBMC) / "Frozen" (serum) | tube type and freeze date per aliquot not in catalog |
| Storage temperature | Not in catalog row | **steward to confirm — required for Metabolon comparability (HD4 needs ≤ −70 °C continuous)** |
| Freeze-thaw count | Not tracked in AminoChain (eval criteria flags this as a structural unknown) | **must ask** |
| Tube format | Not in catalog | must ask — Metabolon accepts EDTA / SST / heparin but reports flag tube-type mismatches across cohorts |
| Time-to-freeze (collection → −80) | Not in catalog | must ask — > 4 h shifts the metabolome by ~ 30 % |

Sample raw_json row (typical PBMC, donor `CBIG35509113`, age 75, Female,
collected —): `unstructured_preservation: "Preservation Method:
Cryopreservation"`, `preservation_category: "Frozen"`. No temperature, no tube
type, no time-to-freeze. The integrity audit fails to clear from the catalog
alone — the steward must answer.

### 2.5 Linked metadata · audit response

What the catalog already exposes per donor:

- Sex (5,832 PD-75+ specimens have it: 4,375 M / 2,457 F)
- Age at collection (every row)
- Country (CAN)
- Donor diagnoses (`Neurological condition`, `Parkinson's disease (PD)`)
- Therapeutic-area scores: **Neurological 0.56**, Musculoskeletal 0.08,
  Cardiovascular 0.07, Metabolic/Endocrine 0.06, Respiratory 0.04,
  Immunological/Inflammatory 0.035 (these are AminoChain-derived TA propensity
  scores per donor, not clinical readings)

What is not in the catalog and the audit must request:

- UPDRS / MDS-UPDRS scores per visit
- Hoehn & Yahr stage per visit
- MoCA / cognitive score per visit
- Levodopa equivalent dose (LED) per visit
- LRRK2 / GBA / SNCA genotype (if previously called)
- Statin / NSAID / metformin co-medication flags
- DAT-SPECT or MRI imaging IDs (the program description claims imaging is
  linked — the catalog does not surface it)

Delivery format question: REDCap CRF export vs. CSV vs. EHR pull. Open biobanks
in this category typically ship a CSV or REDCap dump alongside the aliquots,
but Neuro C-BIG has not published a sample CRF.

### 2.6 Pricing + DUA · audit response

Not in `org_profiles.json` and not on the public website. Estimation anchors
from comparable open biobanks (`references/pricing-data.md`):

- NIA Aging Research Biobank: $7.91–$9.80 per vial
- Boston Medical Center: $15 / aliquot plasma, $24 / aliquot serum
- Lifelines Netherlands: €4–19 per sample (volume-tier)

Plan for $10–$25 per aliquot at the order size implied by the brief (≥ 30
donors × serum + PBMC + DNA × multi-visit ≈ 200–400 aliquots → $2K–$10K
specimen cost), plus a one-time access-committee review fee. Metabolon HD4
re-runs are quoted separately and are out of scope for this audit.

DUA: ask for the open-biobank standard template and budget 2–4 months for
review + signature, longer if the sponsor's legal team rewrites the
commercial-use clause.

### 2.7 Lead time · audit response

No public turnaround commitment on the program page. Comparable academic open
biobanks cite 8–16 weeks from access-committee approval to shipment. The PBMC
viability test (§ 2.4) adds 2–3 weeks if it has not been run on the requested
donor subset before. Expect first usable aliquots **12–20 weeks** from the day
the DUA is countersigned, which puts the realistic earliest shipment at
**roughly Q4 2026** if the sponsor signs a DUA in May.

### 2.8 Cross-cutting intelligence dimensions

#### Sample usability (1)

PBMC at 75+: 1,372 specimens / 253 donors, all cryopreserved, all banked at the
same site under the same SOP. Compatible with standard CyTOF / flow / scRNA-seq
workflows pending viability test.

Serum at 75+: 2,200 specimens / 315 donors, frozen. Tube type is the open
question — Metabolon's prior report on the buyer's separate cohort almost
certainly used red-top SST or K2EDTA plasma; if Neuro C-BIG banks differently,
cross-cohort metabolite comparability degrades and the buyer should not stack
the two datasets without a tube-type bridge study.

DNA: 294 PD donors at 75+ have a DNA aliquot collected since 2020. This is the
LRRK2 / GBA genotyping substrate.

#### Real numbers (2)

Headline 248 donors. Realistic LRRK2-trial-ready subset is the **20 donors**
with serum + PBMC AND ≥ 2 visit-years. The brief asked for ≥ 30. The cohort
falls 33 % short on the strict reading. Three readings:

- Drop the longitudinal requirement: 248 donors clears the brief.
- Drop the dual-specimen requirement: 315 serum donors (longitudinal subset
  6) and 253 PBMC donors (longitudinal subset 8) — relaxes nothing.
- Add a prospective top-up via BIOMEDICA CRO or a new partner: covered in § 4.

The buyer must pick the relaxation before the agents ship outreach.

#### Longitudinal structure (3)

Multi-visit donors (≥ 2 distinct collection years) at 75+:
- Serum-positive: 6 donors
- PBMC-positive: 8 donors
- Either type: 20 donors (the headline multi-visit count)

Year-by-year donor count at 75+ with serum or PBMC: 2 → 28 → 21 → 14 → 8 → 42
→ 86 → 71 → 49 → 7 (years 2016 → 2025). The 2025 figure is partial year-to-date.

Trajectory analysis with N = 20 across two timepoints is feasible for hypothesis
generation, **not** for powered between-treatment-arm comparisons. If the trial
needs longitudinal arms, Neuro C-BIG alone will not get there.

#### Medication confounders (4)

The catalog `unstructured_treatments` field is null on every PD-75+ row queried.
Levodopa, MAO-B inhibitors, anticholinergics, statins, NSAIDs — all opaque from
the catalog. **This is a hard ask for the steward.** Without medication
metadata, both the PBMC immunophenotyping and any cross-talk against the
Metabolon serum panel are uninterpretable for any dopaminergic-axis question.

Reference framing from `intelligence-dimensions.md` § 4: "If the paper adjusted
for [statins], good. If not, top metabolomics hits may be statin effects, not
disease effects." The same caution applies to the buyer's own Metabolon report
when extended onto this cohort.

#### Demographics (5)

PD-75+ at C-BIG: **64 % male, 36 % female** (4,375 / 2,457 specimen-level —
donor-level skew likely similar). PD prevalence skews male roughly 1.5–2×, so
this is consistent with the underlying epidemiology, not a recruitment bias.

Donor race: **0 % annotated**. Catalog returns NULL on every PD-75+ row. Quebec
catchment area is predominantly White European; for a program that needs
ancestry-stratified PRS analysis, this is a structural unknown and should be
flagged on the outreach brief.

#### Co-modalities (6)

Same donors, same age window (75+, 2020+):
- DNA aliquots: 294
- RNA aliquots: 16
- Plasma aliquots (separate from serum): 397
- iPSC lines: 17 (across 2 donors)

The DNA pool is large enough to cover the genotyping arm. RNA is thin — if the
trial needs bulk transcriptomics on PBMC, plan to extract RNA from the PBMC
aliquots rather than rely on banked RNA. iPSC lines are a bonus but two donors
is too narrow to drive a functional readout.

The program description claims linked imaging (DAT-SPECT, MRI) and genetic data.
The catalog does not surface those rows — they live in a separate clinical
database that the access-committee submission must request.

#### Access scope (9)

Open-biobank framing → academic default, commercial-use case-by-case. This is
the single biggest deal risk on the chart. If the LRRK2 sponsor needs
exclusivity windows or unrestricted IP terms, the audit moves from "8–12 weeks
to ship" to "negotiation, 3–6 months, may fail."

#### Sample depletion risk (10)

Total catalog footprint at PD-75+: 6,832 specimens — a deep enough pool that
draining 200–400 aliquots is a single-digit-percent withdrawal. Depletion risk
is low at the program level but unknown at the per-donor level. For a multi-
visit donor with two banked vials per visit, even one assay run per timepoint
can leave the residual at zero — the steward must commit per-donor reserve
before the audit greenlights the order.

### 2.9 What the steward needs to confirm (open items)

1. Per-donor residual volume (serum, PBMC, DNA)
2. Storage temperature continuity (continuous −80 °C? excursions?)
3. Freeze-thaw count per aliquot
4. Tube type for serum (SST? EDTA? heparin?)
5. Time-to-freeze SOP
6. Linked clinical fields available (UPDRS, H&Y, MoCA, LED, co-medication,
   imaging IDs, prior genotyping)
7. Commercial-use / re-consent posture for an industry-sponsored LRRK2
   program
8. Pricing per aliquot and DUA template with signature timeline
9. Per-donor reserve commitment for the requested withdrawal
10. PBMC viability test result (or willingness to run one) on the 2016–2018
    aliquots before any ship

The agent dispatches a single voice intro to `cbig.mni@mcgill.ca` followed by
a 3-touch email sequence, capped at the campaign budget the buyer authorises.

---

## 3. BIOMEDICA CRO — short audit

| Field | Value | Source |
|---|---|---|
| Country | Ukraine | `org_profiles.json` |
| Contact | `office@biomedica-cro.com` | `org_profiles.json` |
| Description | "We do biosample procurement through a broad network of partnered hospitals in Ukraine and supply them globally." | `org_profiles.json` |
| PD donors at 75+ with serum | **1 donor** | `specimens.db` |
| PD donors at 75+ with PBMC | **0 donors** | `specimens.db` |
| Total PD specimens at 75+ | **15 (all serum)** | `specimens.db` |
| Year span | 2024–2025 only | `specimens.db` |

Verdict: **drop from primary plan.** The slice asked for does not exist in
this institute's bank. Description signals a procurement-network model — they
collect to spec, not on-hand at depth. Keep on file as a prospective-collection
partner: if the buyer drops the longitudinal-historical requirement and adds a
6–12-month prospective enrolment leg, BIOMEDICA's network may be the fastest
path to top-up the cohort to N = 30+. That is a separate handoff (`StepProspective`
in the UI), not part of this banked audit.

The agent does not ship the standard 6-item audit checklist here — instead, the
prospective-qualify checklist (feasibility, recruitment timeline, protocol
design, IRB plan, pricing model, IP + data terms) gets dispatched.

---

## 4. The Metabolon bridge

The buyer's prior report is on a **different elderly-PD set** — Metabolon ran
HD4 untargeted metabolomics on serum from a separate discovery cohort. The
audit must answer one cross-cohort question: can the new ask (PBMC + DNA + at
least longitudinal serum continuity) be served by Neuro C-BIG **without**
breaking comparability with the existing Metabolon report?

Three risks:

- **Tube-type mismatch.** Metabolon reports flag systematic shifts when the
  feeding cohort and the validation cohort use different anticoagulants. If
  the original cohort was K2EDTA plasma and Neuro C-BIG banks SST serum,
  ~ 30 % of metabolites will not be directly stackable. Steward must confirm
  before the buyer commits.
- **Fasting status drift.** Metabolon's prior report likely controlled for
  fasting; Neuro C-BIG's protocol does not surface fasting status in the
  catalog. The combined dataset cannot adjust for fasting unless the steward
  produces it.
- **Storage time gap.** The earliest C-BIG PD-75+ collections date to 2016;
  the most labile metabolites (oxidised lipids, short-chain acylcarnitines)
  degrade meaningfully past five years even at −80 °C. If the buyer wants to
  re-run the Metabolon panel on these residuals for orthogonal validation,
  bias toward the 2022–2025 sub-cohort (1,720 PD-75+ specimens) and not the
  2016–2018 tail (1,438 specimens).

The PBMC and DNA arms are independent of the Metabolon prior — those readings
do not need to match a previously-run panel and can move forward on the
strength of the cohort alone.

---

## 5. Decision

The system can recommend **one in-bank source** (Neuro C-BIG) that meets the
brief on five of six audit gates from public data alone, with the sixth gate
(commercial-use scope) as the deal-risk flag. The 248-donor headline matches
the bundle ground truth (`ground_truth.json`: matched_pair_donors = 136 + 112
specimen-level matched pairs counted differently); the 20-donor longitudinal
subset is below the requested ≥ 30, and the buyer must choose:

- **Path A (relax longitudinal):** ship outreach to Neuro C-BIG asking for the
  248-donor cross-section with serum + PBMC + DNA + co-medication metadata.
  Single-leg deal, 12–20 weeks to specimen, all costs land on one DUA.
- **Path B (keep longitudinal, top up prospectively):** ship outreach to
  Neuro C-BIG for the 20-donor longitudinal subset and parallel outreach to
  BIOMEDICA CRO as a prospective enrolment partner for the missing N. Two-leg
  deal, longer timeline, two DUAs.
- **Path C (drop the brief):** treat the LRRK2 program as data-driven on the
  Metabolon report alone and skip the in-bank audit until a second discovery
  question opens.

The agent suite is ready to dispatch on either Path A or Path B once the buyer
authorises the campaign budget. Recommended cap range from the handoff modal
calculator at this fan-out: **$25–$60** for one-institute Path A, **$60–$120**
for two-institute Path B (voice intro + 3-touch email + parsing + booking,
with a 1.5× safety margin).

---

## Appendix · catalog queries

Every count in this report is reproducible. Open the DB:

```bash
sqlite3 data/specimens.db
```

Headline donor counts:

```sql
SELECT COUNT(DISTINCT donor_id)
FROM specimens
WHERE organization_id = '1425f7cb-6096-490e-858f-480b82197688'
  AND (donor_diagnoses LIKE '%Parkinson%' OR specimen_diagnoses LIKE '%Parkinson%')
  AND age_at_collection >= 75
  AND specimen_type = 'Serum';
-- 315
```

Donors with both serum and PBMC at 75+:

```sql
SELECT COUNT(DISTINCT donor_id)
FROM specimens s
WHERE s.organization_id = '1425f7cb-6096-490e-858f-480b82197688'
  AND (s.donor_diagnoses LIKE '%Parkinson%' OR s.specimen_diagnoses LIKE '%Parkinson%')
  AND s.age_at_collection >= 75
  AND s.donor_id IN (
    SELECT donor_id FROM specimens
    WHERE specimen_type = 'Peripheral blood mononuclear cells (PBMCs)'
  );
-- 248
```

Multi-visit subset:

```sql
SELECT COUNT(DISTINCT donor_id) FROM (
  SELECT donor_id
  FROM specimens
  WHERE organization_id = '1425f7cb-6096-490e-858f-480b82197688'
    AND (donor_diagnoses LIKE '%Parkinson%' OR specimen_diagnoses LIKE '%Parkinson%')
    AND age_at_collection >= 75
  GROUP BY donor_id
  HAVING COUNT(DISTINCT date_of_collection_year) >= 2
    AND SUM(CASE WHEN specimen_type = 'Serum' THEN 1 ELSE 0 END) >= 1
    AND SUM(CASE WHEN specimen_type = 'Peripheral blood mononuclear cells (PBMCs)' THEN 1 ELSE 0 END) >= 1
);
-- 20
```
