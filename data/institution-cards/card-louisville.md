# University of Louisville Hospital

> Source probe: [`data/cohort-probes/louisville-hospital.md`](../../data/cohort-probes/louisville-hospital.md)

---

## Buyer query

> *"Need banked urine + respiratory specimens from adult community-acquired
> pneumonia patients, n ≥ 500, with linked clinical metadata and comorbidity
> data. Pneumococcal etiology a plus."*

---

## Layer 1 — Summary card

| Slot | Value |
|---|---|
| **Program name** | University of Louisville Pneumonia Study Group — city-wide CAP cohort |
| **Steward** | Julio A. Ramirez (PI) + Stephen Furmanek — University of Louisville Division of Infectious Diseases |
| **Pool size** | 8,284 CAP hospitalizations / 24 mo · 6,196 consented for biospecimens (urine) · 5,402 with UAD-24 + Quellung serotyping |
| **Activity proof** | Anchor cohort 2014–2016. Sibling SARS-CoV-2 papers cover 1,645 patients in 2020+. "Ten-Year Retrospective" papers in 2025/2026 imply continuous enrollment 2014–2024 |
| **Reuse / external-access proof** | [PMC7414893](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7414893/) ran microbiome + metabolome + cytokines on stored urine — author list includes Pierre, Akbilgic, Smallwood, Cao, Fitzpatrick, Jonsson (non-Louisville affiliations). Hard evidence specimens cross institutional boundaries |
| **Specimen + data depth** | Urine (UAD-24 + residual for 16S microbiome / metabolome / cytokines) · blood culture isolates · respiratory cultures · linked CRF with demographics, geomasked address, census-tract SES, full Charlson comorbidities, HbA1c, troponin, echo, ECG, severity scores, mortality at 4 timepoints |
| **Access path** | **Direct ask to Ramirez group at U of L Division of Infectious Diseases.** Same PI controls clinical ops + database + biorepository |
| **Sources** | 15 PMC IDs (full ledger in deep dive) |

---

## Layer 2 — Deep dive

### 1. Header

- **Institution:** University of Louisville Hospital (CMS id 180141, KY, AMC, medium tier)
- **Role tag:** `Steward` — academic core + PI host for the cohort
- **Last verified:** —

### 2. Program inventory

**University of Louisville Pneumonia Study Group — city-wide CAP cohort**
- **Steward PI:** Julio A. Ramirez (U of L Division of ID)
- **Co-investigators:** Stephen Furmanek, Forest Arnold, Ruth Carrico, Timothy Wiemken, Rodrigo Cavallazzi, Jose Bordon, Paula Peyrani, Thomas Chandler, Ashley Wilde
- **Status:** `Active` (continuous enrollment 2014 → at least 2024 per sibling-paper evidence)
- **Most recent publication:** 2025 ([PMC11768315](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11768315/) — Mycoplasma outbreak)
- **Funding source:** Not explicitly stated in anchor; multi-paper output implies sustained funding
- **Geographic scope:** All 9 adult hospitals serving Louisville KY (population-based, not single-hospital)

### 3. Quantified evidence

Every cell links to its source.

| Field | Value | Source |
|---|---|---|
| Total enrollment (anchor window) | 8,284 | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) |
| Consented for biospecimens (urine) | 6,196 | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) |
| With UAD-24 + Quellung | 5,402 | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) |
| Pneumococcal pneumonia identified | 708 (13%) | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) |
| ICH (immunocompromised host) subset | 761 (10% of 7,449) | [PMC10676121](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10676121/) |
| COPD subset | 2,765 (51% of consented) | [PMC8654722](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8654722/) |
| SARS-CoV-2 CAP (extension window) | 1,645 patients | [PMC9674393](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9674393/), [PMC9166248](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9166248/) |
| Enrollment window (anchor) | — → — | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) |
| Geography | Adult residents, Louisville KY | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) |
| Participating sites | 9 (all adult hospitals in Louisville) | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) Suppl §1 |
| IRB # | 11.0613, 13.0408 | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) |

### 4. Variables captured per patient

**Demographics & social**
- Age (continuous, reported as median + IQR)
- Sex
- Race (Black / African American flag — finer race may exist)
- Geomasked home address → census tract via US Census Bureau
- Census-tract-level: income, % Black, % ≥65
- Nursing home residency
- SSN used for admission-deduplication

**Anthropometric / behavioral**
- Obesity flag (BMI-derived); BMI continuous in [PMC7983275](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7983275/)
- Smoking status

**Comorbidities (Charlson-style binary flags)**
- HIV, neoplastic disease, renal disease, CHF, COPD, stroke, diabetes, CAD, AF, liver disease, advanced-stage cancer, chemotherapy use, corticosteroid use

**On-admission clinical**
- Direct ICU admission, altered mental status, vasopressors day 1, mechanical ventilator day 1
- PSI risk class IV–V flag
- CURB-65, PaO₂/FiO₂ (sibling)
- HbA1c, admission glucose ([PMC9166248](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9166248/))
- Troponin, echo features ([PMC11238549](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11238549/))
- ECG features ([PMC8757653](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8757653/))

**Microbiology / etiology**
- Blood cultures, respiratory cultures
- UAD-24 (Luminex serotype-specific monoclonal Ab capture, 24 S. pneumoniae serotypes)
- Quellung serotyping on culture-positive isolates
- Influenza, RSV, SARS-CoV-2 (NP swab + sputum + saliva concordance)
- Group B Streptococcus ([PMC8561246](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8561246/))
- C. difficile ([PMC10124648](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10124648/))

**Biospecimens stored**
- Urine — used for 16S microbiome, untargeted metabolome, cytokine multiplex ([PMC7414893](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7414893/))
- Respiratory samples
- Blood

**Outcomes**
- LOS, in-hospital mortality, 30-day mortality, 6-month mortality, 1-year mortality, 30-day readmission
- Composite "clinical failure" (vent or vasopressors during stay)
- CV events composite (MI, new arrhythmia, stroke, PE, pulmonary edema)

**External linkage**
- 2014 BRFSS (Louisville) for comorbidity-specific population denominators
- 2014 NHIS for COPD adjustment
- US Census 2014 adult population for incidence rate

### 5. People

| Name | Role | Affiliation |
|---|---|---|
| Julio A. Ramirez | PI, senior author across all anchor + sibling papers | U of L Division of Infectious Diseases |
| Stephen Furmanek | Senior co-author, operational lead | U of L |
| Forest Arnold | Co-investigator | U of L |
| Ruth Carrico | Co-investigator | U of L |
| Timothy Wiemken | Co-investigator | U of L |
| Rodrigo Cavallazzi | Co-investigator | U of L |
| Jose Bordon | Co-investigator | U of L |
| Paula Peyrani | Co-investigator | U of L |
| Thomas Chandler | Co-investigator | U of L |
| Ashley Wilde | Co-investigator | U of L |

15+ distinct first authors across the sibling network — confirms PI controls access but actively delegates / collaborates. *"One phone call, but the call gets answered."*

### 6. Reuse / external-access track record

**Strongest signal:** [PMC7414893](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7414893/) (2020) — multi-omics on stored urine. Author list includes **Pierre, Akbilgic, Smallwood, Cao, Fitzpatrick, Jonsson** — affiliations outside Louisville. Hard evidence biospecimens cross institutional boundaries, not just that they exist.

**Publication velocity:** ~2–3 papers/year off this cohort over 10+ years. Healthy. Trends to 0 would signal dormancy.

**Self-criticism as quality signal:** [PMC10163290](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10163290/) reports NP swabs alone underdetect RSV. [PMC10124648](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10124648/) reports C. diff misdiagnoses. Same group publishing negative findings about their own diagnostics is rare and credible.

**Pre-curated subgroups already shipped as analyses:** COPD, ICH, T2D, SARS-CoV-2, RSV, GBS, C. diff. The cohort isn't a raw dump — curated slices are ready to hand off.

### 7. Access path

| Step | Detail |
|---|---|
| Direct contact | Julio A. Ramirez or Stephen Furmanek, U of L Division of Infectious Diseases |
| Steward institution | University of Louisville School of Medicine |
| IRB | U of L Human Subjects Research Protection Program (# 11.0613, # 13.0408 cover the existing protocol) |
| Required additional gates | Each of 9 participating hospitals approved separately — secondary-use scope outside CAP requires fresh protocol amendment |
| Decision authority | PI (Ramirez group) controls bank + database; track record of releasing externally |
| Data delivery | Paper CRF → web DB hosted by U of L Division of ID. **Not direct EHR pipe.** |

### 8. Source ledger

Every artifact touched in this probe.

| Type | ID | Year | What we extracted |
|---|---|---|---|
| Paper | [PMC10673027](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10673027/) | 2023 | Anchor: cohort definition, N, geospatial, IRB |
| Paper | [PMC10676121](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10676121/) | 2023 | ICH subset (7,449 N variant) |
| Paper | [PMC10142714](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10142714/) | 2023 | Influenza vs SARS-CoV-2 CAP |
| Paper | [PMC10163290](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10163290/) | 2023 | RSV in adults |
| Paper | [PMC9674393](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9674393/) | 2022 | 1,645-pt SARS-CoV-2 CAP, CV complications |
| Paper | [PMC9166248](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9166248/) | 2022 | Hyperglycemia + CAP, HbA1c |
| Paper | [PMC8654722](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8654722/) | 2021 | COPD subset |
| Paper | [PMC8561246](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8561246/) | 2021 | Group B Strep CAP |
| Paper | [PMC8562015](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8562015/) | 2021 | PSI / CURB-65 |
| Paper | [PMC7997853](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7997853/) | 2021 | CV events |
| Paper | [PMC7983275](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7983275/) | 2021 | BMI vs mortality |
| Paper | [PMC8399246](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8399246/) | 2021 | ICH outcomes |
| Paper | [PMC7414893](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7414893/) | 2020 | **Reuse proof** — urine microbiome / metabolome / cytokines, non-Louisville authors |
| Paper | [PMC11238549](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11238549/) | 2024 | Echo + troponin |
| Paper | [PMC11768315](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11768315/) | 2025 | Most recent — Mycoplasma outbreak |
| Paper | [PMC10124648](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10124648/) | — | C. difficile self-criticism |
| Paper | [PMC8757653](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8757653/) | — | ECG features |

### 9. What we don't know

- Exact current N or whether enrollment is still active in 2026 (likely yes, not confirmed)
- Residual aliquot volumes per patient
- Freezer inventory / current usable specimen count
- Whether biospecimens are released to external requesters under what terms (pricing, DUA template)
- IRB scope for secondary use beyond pneumonia
- Linkage to claims, mortality registry, or longitudinal EHR pull
- Whether non-CAP admissions at U of L Hospital are similarly catalogued (this cohort is CAP-only)
- Ownership: U of L Hospital vs U of L School of Medicine vs Norton Healthcare (Louisville's main co-enrolling system)

These are the questions a first call answers — not the questions the page should pretend to answer.

### 10. How we found this

- **Method:** paperclip (PMC + bioRxiv + medRxiv) two-stage probe — anchor paper + sibling sweep
- **Anchor query:** PubMed search anchored on "University of Louisville Pneumonia Study Group" + Ramirez authorship
- **Sibling sweep:** ~15 metadata reads + 2–3 full reads
- **Confidence band:** **High** — protocol fully extractable from anchor + supplement; reuse confirmed by external-author paper; 10-year publication velocity confirms liveness
- **Probe state classification:** `cohort_present_and_stewarded_locally`
