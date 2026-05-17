# University Medical Center New Orleans

> Source probe: [`data/cohort-probes/umc-new-orleans.md`](../../data/cohort-probes/umc-new-orleans.md)

---

## Buyer query

> *"Need longitudinal serum + plasma from hospitalized COVID patients across
> the full severity range, with PASC follow-up. Sociodemographically diverse
> population preferred."*

---

## Layer 1 — Summary card

| Slot | Value |
|---|---|
| **Program name** | ClinSeqSer (Clinical Sequencing for Serum and Secretions for SARS-CoV-2 Countermeasure Development) |
| **Steward** | Dahlene N. Fusco (PI) — Tulane Internal Medicine, Infectious Diseases |
| **Pool size** | 456 acute COVID (Aug 2020–Sep 2021) + 89 earlier (Mar–Aug 2020) + 107 PASC longitudinal arm |
| **Activity proof** | Started Mar 2020. Ongoing 3-month-interval longitudinal follow-up in PASC arm. ≥6 cohort papers across 2021–2024. **Post-2022 enrollment status unconfirmed** |
| **Reuse / external-access proof** | Olink Proximity Extension Assay run on stored plasma; Zalgen Labs reSARS™ ELISA on stored serum; viral genomes deposited public on GISAID + [BioProject PRJNA681020](https://www.ncbi.nlm.nih.gov/bioproject/PRJNA681020); [PMC8313480](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8313480/) Cell paper has 30+ co-authors across Scripps, UCSD, UCLA, Tulane, LSU, USAMRIID, Georgetown, Leuven |
| **Specimen + data depth** | NP swab · saliva · serum · plasma collected at every visit (initial + every 3 months). Wet ice → −80 °C → batched aliquoting at Tulane. Olink ~25-marker plasma proteome on PASC subset. Viral genomes on samples with Ct ≤30 |
| **Access path** | **Tulane (Fusco), not UMC.** UMC NOLA is the clinical host — *not* the data steward. Naive lookup pings the wrong door |
| **Sources** | 6 PMC + 2 medRxiv preprints (full ledger in deep dive) |

---

## Layer 2 — Deep dive

### 1. Header

- **Institution:** University Medical Center New Orleans (CMS id 190005, LA, AMC, medium tier)
- **Role tag:** `Clinical host` — enrolls patients, but does NOT steward the data or biorepository
- **Last verified:** —

### 2. Program inventory

**ClinSeqSer (Clinical Sequencing for Serum and Secretions for SARS-CoV-2 Countermeasure Development)**
- **Steward PI:** Dahlene N. Fusco (Tulane Internal Medicine, ID)
- **Sites:** UMC New Orleans + Tulane Medical Center
- **IRB:** Tulane University School of Medicine
- **Status:** `Active follow-up` (PASC arm continues 3-month-interval visits); acute enrollment status post-2022 unconfirmed
- **Most recent publication:** 2024 ([PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) — anchor analysis)
- **Funding source:** Multi-institutional consortium with CDC collaboration (Plumb, Hagen, Midgley named on anchor)

No evidence of any non-ClinSeqSer prospective registry at UMC NOLA. The cohort is **disease-bounded (COVID-19 only)**.

### 3. Quantified evidence

Every cell links to its source.

| Field | Value | Source |
|---|---|---|
| Total enrolled (Aug 2020 – Sep 2021 window) | 527 | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Analyzed (anchor) | 456 | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Earlier window (Mar – Aug 2020) | 89 | [med_bdd554e8720f](https://www.medrxiv.org/) |
| PASC longitudinal arm | 107 | [med_60eafd236c72](https://www.medrxiv.org/) |
| IDWeek poster sub-cohort | 60 | [PMC8690443](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8690443/) |
| Black non-Hispanic | 60.5% | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Median age | 56 (range 18–98) | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Severe (≥6 L/min O₂ or intubated) | 187 (40.1%) | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| In-hospital mortality | 60 (13.1%) | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Hypertension | 61% | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Obesity | 40% | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Diabetes | 34% | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Immunocompromised | 20% | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |
| Geography | New Orleans, LA — Gulf South, high Social Vulnerability Index | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) |

### 4. Variables captured per patient

**Demographics**
- Age (continuous; range 18–98)
- Sex (M/F)
- Race & ethnicity (5-category: Black NH / White NH / Hispanic / Asian NH / American Indian / Other / Unknown)

**Behavioral**
- Smoking history (current/previous tobacco)
- Substance abuse history

**Anthropometrics**
- Obesity flag; BMI continuous + admit SBP + pulse BP in [med_bdd554e8720f](https://www.medrxiv.org/)

**Comorbidities (binary flags + 0–14 count)**
- Cardiac, pulmonary, neurologic, renal, liver, immunocompromised, diabetes, hematologic, autoimmune, endocrine, gastrointestinal, hypertension

**COVID course**
- Date of symptom onset, date of admission (median 5 d after onset)
- Vaccination status (verified for 92% of 389)
- Delta-predominant period flag

**Treatments administered**
- Dexamethasone, remdesivir, anti-spike mAb (casirivimab/imdevimab, bamlanivimab/etesevimab), baricitinib, tocilizumab, convalescent plasma

**Severity / outcomes**
- ≥6 L/min oxygen flag (severe), high-flow nasal cannula vs intubation
- WHO scale 5–8 mapping
- In-hospital mortality, LOS

**Laboratory**
- Continuous values + median-split binary
- Cycle threshold (Ct) — nasal + saliva separately, first specimen during 0–7d after symptom onset
- Anti-N antibody categorized by 14d / 15–28d post-onset

**Biomarkers (from siblings)**
- Anti-N IgG (Zalgen reSARS™)
- S-RBD IgG
- ACE2-spike inhibition %
- IL-6, TNF, IL-10
- Olink ~25-marker plasma proteome ([med_60eafd236c72](https://www.medrxiv.org/))

**Public deposit**
- Viral genomes on GISAID + [BioProject PRJNA681020](https://www.ncbi.nlm.nih.gov/bioproject/PRJNA681020)

### 5. People

| Name | Role | Affiliation |
|---|---|---|
| Dahlene N. Fusco | PI, all cohort papers | Tulane Internal Medicine, ID |
| Drouin | Co-author across cohort papers | Tulane |
| Robert Garry | Co-author on multiple papers; Zalgen Labs shareholder | Tulane / Zalgen Labs |
| Plumb, Hagen, Midgley | CDC collaborators on anchor | CDC COVID-19 response |
| Andersen lab | Cell paper genomics | Scripps |
| Knight lab | Cell paper microbiome | UCSD |
| (Multi-institutional) | 30+ co-authors on Cell paper | UCLA, LSU, USAMRIID, Georgetown, Leuven |

### 6. Reuse / external-access track record

**Strong reuse signal across multiple modalities:**
- **Commercial vendors:** Olink Proximity Extension Assay (plasma proteomics on PASC subset); Zalgen Labs reSARS™ ELISA (anti-N IgG); Meso Scale Discovery multiplex
- **Public deposit:** viral sequences on GISAID + [BioProject PRJNA681020](https://www.ncbi.nlm.nih.gov/bioproject/PRJNA681020) — implies a public-genomics-data muscle that not every site has
- **Academic consortium:** [PMC8313480](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8313480/) Cell paper — multi-institutional consortium with Scripps Andersen, UCSD Knight, USAMRIID, Georgetown, Leuven

**Publication velocity:** ~6 cohort-derived papers in 5 years. Slower than Louisville (~15) — consistent with single-disease, smaller-N, pandemic-era cohort.

**Gap:** No external-author-only paper analogous to Louisville's [PMC7414893](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7414893/). External access is mediated through Tulane PI on every paper.

### 7. Access path

| Step | Detail |
|---|---|
| Direct contact | **Dahlene N. Fusco, Tulane Internal Medicine ID** — PI |
| Steward institution | **Tulane University School of Medicine** (NOT UMC) |
| IRB | Tulane SOM IRB; 45 C.F.R. part 46 / 21 C.F.R. part 56 compliance. Pandemic-era verbal IC waiver |
| What UMC handles | Clinical care + patient enrollment |
| What Tulane handles | Specimen storage (−80 °C, batched aliquoting), assays, database, reuse decisions |
| Where UMC's parent (LCMC Health) creeps in | Clinical operations only |
| Decision authority | Fusco lab at Tulane controls freezer + database + DUA decisions |

**Critical:** Direct outreach to UMC NOLA likely routes to LCMC Health for clinical operations. For research-cohort access the path is **Tulane IRB + Fusco lab**, not UMC.

### 8. Source ledger

| Type | ID | Year | What we extracted |
|---|---|---|---|
| Paper | [PMC10951213](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951213/) | 2024 | Anchor: ClinSeqSer methods, Aug 2020 – Sep 2021 cohort |
| Preprint | med_bdd554e8720f | 2024 | Mar – Aug 2020 subset, BP/obesity, n=89 |
| Preprint | med_60eafd236c72 | 2024 | PASC, n=107, blood + Olink proteome |
| Paper | [PMC8690443](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8690443/) | 2021 | IDWeek poster: ClinSeqSer biomarker work, n=60 |
| Paper | [PMC8313480](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8313480/) | 2021 | Cell: SARS-CoV-2 genomic emergence, multi-institutional |
| Preprint | [PMC7872376](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7872376/) | 2021 | bioRxiv preprint of above |
| Public dataset | [BioProject PRJNA681020](https://www.ncbi.nlm.nih.gov/bioproject/PRJNA681020) | — | Viral genome deposit |
| Public dataset | [GISAID](https://www.gisaid.org/) | — | Viral genome deposit |

### 9. What we don't know

- Current enrollment status (post-2022)
- Biorepository inventory / volumes / freezer
- DUA path or pricing
- IRB scope for non-COVID secondary use
- Whether UMC NOLA has its own (non-ClinSeqSer) prospective cohorts
- Whether UMC NOLA has signed data-sharing agreements with Tulane that would govern external access requests
- IRB reference number (Tulane SOM IRB named, no number published)

### 10. How we found this

- **Method:** paperclip (PMC + bioRxiv + medRxiv) two-stage probe — anchor paper + sibling sweep
- **Anchor query:** PubMed + bioRxiv anchored on UMC New Orleans + COVID cohort + biospecimens
- **Sibling sweep:** ~6 cohort-derived papers traced via Fusco/Drouin authorship
- **Confidence band:** **Medium** — anchor + siblings give protocol & reuse evidence; **post-2022 liveness uncertain**; structural finding (steward ≠ host) added by sibling pass
- **Probe state classification:** `cohort_present_but_stewarded_elsewhere` + `steward = Tulane (Fusco lab)`

**Key meta-finding:** The probe surfaces a structural fact that isn't in the curated AMC list — UMC looks like an AMC on paper, but it is a clinical host for a Tulane-stewarded cohort. That kind of distinction a hospital-level table cannot encode and that determines whether direct outreach goes to the right party.
