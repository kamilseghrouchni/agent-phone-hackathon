# EvergreenHealth Medical Center

> Source probe: [`data/cohort-probes/evergreen-health.md`](../../data/cohort-probes/evergreen-health.md)

---

## Buyer query

> *"Looking for banked MS patient specimens (CSF, serum) with longitudinal
> clinical follow-up. Or banked tumor tissue from community-oncology
> breast / prostate / CRC cases."*

---

## Layer 1 — Summary card

| Slot | Value |
|---|---|
| **Program name** | No single named cohort. Trial-portfolio aggregate across **4 stewards**: FHCC at EvergreenHealth (oncology) · EH MS Center (Brown) · pharma-sponsored neuroscience · EvergreenHealth Research (ID) |
| **Steward** | Per program: Fred Hutch (oncology); Theodore R. Brown, MD MPH (MS, IIT); pharma sponsors (movement disorders); Diego Lopez de Castilla, MD (ID) |
| **Pool size** | 38 currently recruiting trials · 543 trials all-time at Kirkland WA · Brown MS IIT trials n=21–43 each (11 trials, all single-site) |
| **Activity proof** | 38 recruiting *now* on ClinicalTrials.gov · Brown's IIT pipeline ongoing |
| **Reuse / external-access proof** | Sponsor-driven: NCI / SWOG / Alliance / NRG / ECOG-ACRIN / CCTG (oncology); Denali, BlueRock, AskBio, Roche, BMS, Eli Lilly, ACADIA (pharma neurology); CHDI Enroll-HD; Parkinson's Foundation PD GENEration |
| **Specimen + data depth** | Inferred from trial protocols — whole blood, plasma, serum, urine for PK/PD; LRRK2 genotyping; spinal taps implied by some PD biomarker work. **No EH-stewarded biorepository** — specimens flow upward to sponsor / consortium central labs |
| **Access path** | **Differs per program** — needs program-specific routing: Fred Hutch for oncology; Brown lab for MS; EH neuroscience research office for movement disorders; EvergreenHealth Research office for ID |
| **Sources** | Literature: 4 PMC papers (none EH-stewarded). Trial portfolio: ClinicalTrials.gov (~38 NCT IDs sampled) |

---

## Layer 2 — Deep dive

### 1. Header

- **Institution:** EvergreenHealth Medical Center, Kirkland WA (CMS id 500124, **non-academic community**, medium tier)
- **Role tag:** `Site participant` — EH is a clinical execution site for partner-stewarded trials. **Not a steward of any published cohort.**
- **Last verified:** —

### 2. Program inventory

EH operates under **three distinct facility brands** on ClinicalTrials.gov, each with its own cohort character.

#### Cluster A — Oncology (Fred Hutch satellite)

- **Brand on CT.gov:** "FHCC at EvergreenHealth" (formerly "Seattle Cancer Care Alliance at EvergreenHealth")
- **Steward:** Fred Hutchinson Cancer Center
- **Site PIs:** Varadarajan, Qureshi, Dean, Moore, Currin
- **Status:** `Recruiting`
- **Trial examples:**
  - [NCT06524544](https://clinicaltrials.gov/study/NCT06524544) — NCI urothelial PD-(L)1 resistance Ph3
  - [NCT05812807](https://clinicaltrials.gov/study/NCT05812807) — Alliance OptimICE-PCR Ph3 TNBC
  - [NCT06592924](https://clinicaltrials.gov/study/NCT06592924) — CCTG mCSPC docetaxel Ph3
- **Therapeutic depth:** Solid tumors broad — breast, prostate, urothelial, NSCLC, CRC; some heme

#### Cluster B — MS (investigator-initiated, EH-native)

- **Brand on CT.gov:** EvergreenHealth (direct)
- **Steward:** **Theodore R. Brown, MD MPH** (sponsor-investigator)
- **Status:** 11 individually-initiated trials, all MS-focused, all single-site (locations_count = 1)
- **Trial examples:**
  - [NCT02086188](https://clinicaltrials.gov/study/NCT02086188) — mirabegron in MS-related overactive bladder Ph4
  - [NCT03110315](https://clinicaltrials.gov/study/NCT03110315) — suvorexant for MS fatigue Ph4
  - [NCT02369224](https://clinicaltrials.gov/study/NCT02369224) — validation of the **Evergreen Myometric Strength Test for Lower Extremities** (EH-named instrument)
- **Therapeutic depth:** MS deep, all subtypes implied. Classic IIT MS center profile.

#### Cluster C — Movement disorders / neuroscience (pharma-sponsored multicenter)

- **Brand on CT.gov:** EvergreenHealth (direct)
- **Steward:** Pharma sponsors; likely local hub is the **Booth Gardner Parkinson's Care Center** at EvergreenHealth Neuroscience Institute
- **Status:** Active recruiting across multiple Phase 2/3
- **Trial examples:**
  - [NCT06602193](https://clinicaltrials.gov/study/NCT06602193) — Denali / BIIB122 LRRK2-PD Ph2
  - [NCT06944522](https://clinicaltrials.gov/study/NCT06944522) — BlueRock bemdaneprocel cell therapy Ph3 (sham-surgery-controlled, neurosurgery)
  - [NCT06285643](https://clinicaltrials.gov/study/NCT06285643) — AskBio AAV2-GDNF gene therapy Ph2 (intraputaminal — needs neurosurgery + interventional MRI)
  - [NCT06680830](https://clinicaltrials.gov/study/NCT06680830) — Neuron23 NEU-411 Ph2
  - [NCT06809400](https://clinicaltrials.gov/study/NCT06809400) — Eli Lilly LY4006896 Ph1
  - [NCT06585787](https://clinicaltrials.gov/study/NCT06585787) — Karuna/BMS KarXT for Alzheimer psychosis Ph3
  - [NCT07011745](https://clinicaltrials.gov/study/NCT07011745) — BMS KarXT for AD agitation Ph3
  - [NCT07029581](https://clinicaltrials.gov/study/NCT07029581) — ACADIA ACP-204 LBD psychosis Ph2
  - [NCT07304089](https://clinicaltrials.gov/study/NCT07304089) — Vima Therapeutics dystonia Ph2
  - [NCT07111663](https://clinicaltrials.gov/study/NCT07111663) — Vima dystonia observational
  - [NCT06667414](https://clinicaltrials.gov/study/NCT06667414) — Roche Huntington genotyping
  - [NCT01574053](https://clinicaltrials.gov/study/NCT01574053) — CHDI Enroll-HD global registry
  - [NCT04994015](https://clinicaltrials.gov/study/NCT04994015) — Parkinson's Foundation PD GENEration

#### Cluster D — ID / hepatology (smaller programs)

- **Brand on CT.gov:** "EvergreenHealth Research"
- **Steward:** EH-native research office
- **Site PI:** Diego Lopez de Castilla, MD
- **Trial example:** [NCT05259618](https://clinicaltrials.gov/study/NCT05259618) — elevated ALT

### 3. Quantified evidence

| Field | Value | Source |
|---|---|---|
| Total trials all-time at Kirkland WA | 543 | ClinicalTrials.gov LocationFacility query |
| Currently RECRUITING in Kirkland | **38** | ClinicalTrials.gov |
| Brown MS IIT trials | 11 (all single-site) | ClinicalTrials.gov sponsor-investigator filter |
| Brown MS trial sizes | n=21–43 each | Sample of 11 trial pages |
| EH-stewarded cohort papers (literature) | 0 | Paperclip / PubMed search |
| Co-op groups participating | NCI, SWOG, NRG, Alliance, ECOG-ACRIN, CCTG | CT.gov sponsor field |
| Pharma sponsors with EH presence | Pfizer, Merck, AstraZeneca, AbbVie, Novartis, Eli Lilly, Roche, BMS, Janssen, Boston Scientific, Stryker | CT.gov sponsor field |

**The literature returns nothing EH-stewarded.** That is the single most important quantified finding — and it's only meaningful because CT.gov flips it.

### 4. Variables captured per patient

**Cannot extract a per-patient variable list from EH directly** (no EH-stewarded protocol published). What the trial protocols *imply* EH executes:

**Specimen collection (executed locally)**
- Whole blood, plasma, serum, urine — standard PK/PD + biomarker draws
- LRRK2 genotyping (sample collection for sponsor's CLIA / partnered central lab)
- Spinal taps implied by some PD biomarker work (needs verification)

**Procedural / clinical (executed locally)**
- ED-acute enrollment ([NCT05702034](https://clinicaltrials.gov/study/NCT05702034) — Janssen Milvexian Ph3 stroke)
- Outpatient infusion for Ph3 mAb / cell therapy (oncology + neurology)
- DBS-related follow-up (Boston Scientific Vercise registry)
- Surgical AAV gene therapy delivery (NCT06285643 — neurosurgery + interventional MRI)
- Stereotactic cell-therapy delivery (NCT06944522 — neurosurgery, sham-surgery-controlled)

**Imaging**
- MRI (per multiple PD/MS protocols)
- CT (oncology staging)
- Functional motor / strength testing (Brown's EMST-LE was developed here — home-grown instrument)

**Lab analyses (sent out, not on-site)**
- Targeted PD biomarkers (pS935 LRRK2, urine BMP) → sponsor central lab
- Oncology biomarker panels → NCI / co-op group central labs
- Genetic registry analyses → consortium core (PD GENEration, Enroll-HD)

**Net:** EH can **deliver** complex modalities (gene therapy, cell therapy, DBS, oncology). The **analytical work happens elsewhere.** EH is a clinical-execution site, not an analytical site.

### 5. People

| Name | Role | Cluster |
|---|---|---|
| **Theodore R. Brown, MD MPH** | Sponsor-investigator on 11 MS IIT trials | MS |
| Diego Lopez de Castilla, MD | Site PI, ID | EvergreenHealth Research |
| Varadarajan | Site PI, oncology | FHCC at EvergreenHealth |
| Qureshi | Site PI, oncology | FHCC at EvergreenHealth |
| Dean | Site PI, oncology | FHCC at EvergreenHealth |
| Moore | Site PI, oncology | FHCC at EvergreenHealth |
| Currin | Site PI, oncology | FHCC at EvergreenHealth |
| Francis X. Riedo | ID — McMichael NEJM co-author (CDC LTCF outbreak) | Historical (2020) |
| Matthew Arentz | Critical care — JAMA 21-pt EH ICU case series; later UW work | Historical (2020) / migrated |

Movement-disorders cluster lacks a named local PI in our extraction — likely identifiable from individual trial pages on CT.gov but not captured in this probe.

### 6. Reuse / external-access track record

**Different shape from Louisville/UMC.** No biospecimen reuse pattern — because EH is not a biospecimen owner.

What we have instead:
- **Sponsor partnerships as proxy for "outsiders engage with this site"**
  - 6 NCI co-op groups (NCI, SWOG, NRG, Alliance, ECOG-ACRIN, CCTG)
  - 11+ pharma sponsors with active recruitment
  - 2 disease registries (Enroll-HD, PD GENEration)
- **Brown's IIT productivity:** 11 single-site trials launched and run from EH = real research-execution capacity, even though publication trail is thin
- **Sample-flow direction:** outward. Specimens leave the building, go to NCI/SWOG/sponsor central labs

**No external-author paper analogous to Louisville's [PMC7414893](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7414893/).** Honest gap. The reuse evidence is procedural (sponsors keep coming back to enroll patients), not specimen-based.

### 7. Access path

**Different per program — single contact does not exist.**

| If the buyer wants… | The right door is… |
|---|---|
| Oncology trial enrollment | Fred Hutchinson Cancer Center (not EH directly) |
| MS trial / specimen collaboration | **Theodore R. Brown lab at EH MS Center** (direct) |
| Movement disorders / neurology trial | EH Neuroscience Institute research office; identify the local PI per trial via CT.gov |
| ID / hepatology trial | EvergreenHealth Research office (Lopez de Castilla) |
| Banked MS specimens | Possibly Brown's residuals — **not advertised as a biorepository** |
| Banked oncology specimens | NOT EH — go to SWOG Specimen Repository, NCI BioSpecimen Core Resource, Cooperative Human Tissue Network |
| Banked pharma trial samples | NOT EH — owned by sponsor under CTA |

**Net:** for the dominant volume of EH research activity, **specimens are not banked at EH**. EH does not have rights to use them for secondary work. Outreach targeting *banked specimens* should bypass EH entirely. Outreach targeting *prospective enrollment* into a new study should go program-by-program.

### 8. Source ledger

**Literature side (negative finding):**

| Type | ID | Year | What it told us |
|---|---|---|---|
| Paper | [PMC7121761](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7121761/) | 2020 | LTCF outbreak — CDC/PHSKC owned the cohort, EH was treating site |
| Paper | [PMC7143164](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7143164/) | 2020 | UW Seattle ICU 9-hospital registry — **EH not included** |
| Paper | [PMC7314181](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7314181/) | 2020 | Buckner Seattle 105-pt CAP — EH not mentioned |
| Paper | [PMC9574438](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9574438/) | 2022 | Arentz on UW immunology paper — suggests UW affiliation alongside EH |
| Paper (not indexed) | Arentz et al. JAMA 2020 | 2020 | 21-pt EH ICU case series — paperclip doesn't have it; PMID 32191259 |

**Trial-portfolio side (positive finding):**

| Cluster | Sample NCT IDs |
|---|---|
| Oncology | [NCT06524544](https://clinicaltrials.gov/study/NCT06524544), [NCT05812807](https://clinicaltrials.gov/study/NCT05812807), [NCT06592924](https://clinicaltrials.gov/study/NCT06592924) |
| MS (Brown IITs) | [NCT02086188](https://clinicaltrials.gov/study/NCT02086188), [NCT03110315](https://clinicaltrials.gov/study/NCT03110315), [NCT02369224](https://clinicaltrials.gov/study/NCT02369224) |
| Movement disorders | [NCT06602193](https://clinicaltrials.gov/study/NCT06602193), [NCT06944522](https://clinicaltrials.gov/study/NCT06944522), [NCT06285643](https://clinicaltrials.gov/study/NCT06285643), [NCT06680830](https://clinicaltrials.gov/study/NCT06680830), [NCT06809400](https://clinicaltrials.gov/study/NCT06809400), [NCT06585787](https://clinicaltrials.gov/study/NCT06585787), [NCT07011745](https://clinicaltrials.gov/study/NCT07011745), [NCT07029581](https://clinicaltrials.gov/study/NCT07029581), [NCT07304089](https://clinicaltrials.gov/study/NCT07304089), [NCT07111663](https://clinicaltrials.gov/study/NCT07111663), [NCT06667414](https://clinicaltrials.gov/study/NCT06667414), [NCT01574053](https://clinicaltrials.gov/study/NCT01574053), [NCT04994015](https://clinicaltrials.gov/study/NCT04994015) |
| Stroke | [NCT05702034](https://clinicaltrials.gov/study/NCT05702034) |
| ID | [NCT05259618](https://clinicaltrials.gov/study/NCT05259618) |

### 9. What we don't know

- Whether Brown's MS IIT trials retain any residual biospecimens locally, and on what terms they'd be released
- Local PI names for the movement-disorders cluster (likely identifiable from CT.gov per-trial)
- Whether the Booth Gardner Parkinson's Care Center has a research-side intake / IRB process distinct from EH-wide
- Whether EH has internal QI registries or commercial-research-network participation that simply doesn't publish (literature can't see this)
- Pricing / DUA terms for any of the four clusters
- Whether residual specimens from completed pharma trials are recoverable (typically no — sponsor-owned per CTA)

### 10. How we found this

- **Method (stage 1, literature):** paperclip (PMC + bioRxiv + medRxiv) — returned a clean negative
- **Method (stage 2, trials):** ClinicalTrials.gov LocationFacility query for "EvergreenHealth" + "Kirkland WA"; sponsor + brand disambiguation pass
- **Confidence band:** **High** for the negative literature finding; **Medium** for the trial-portfolio inventory (sample of ~38 active trials examined in detail; full 543 not enumerated)
- **Probe state classification:** `no_local_cohort_but_active_trial_site` + `programs = [oncology_FHCC, MS_Brown_IIT, neuro_pharma, ID_native]` + `access_paths = [per_program]`

**Key meta-finding:** For community hospitals, **CT.gov is more informative than literature** about prospective research engagement. Reasons:
- Co-op group sites publish under the consortium, not the site
- Pharma trial sites don't publish; the sponsor does
- IIT trials register on CT.gov even when results never reach a journal
- Specialty programs (MS center, movement disorders) are findable via individual-investigator sponsorship records

**The "no published cohort" finding flipped from "literature negative" to "literature blind to a real, multi-program research operation."** This is the single biggest reason the probe pattern needs the CT.gov pass for non-AMC hospitals.
