# Eval Bundles — Sourcing Pipeline

Generated: —
Total bundles: 36 (23 original + 13 new)
Dual ground truth: AminoChain commercial inventory + academic literature papers

## How to use

See **[how-to-run.md](how-to-run.md)** for the full eval harness documentation.

Each bundle has 5 files:
- `query.json` — buyer's sourcing request (input to pipeline)
- `ground_truth.json` — AminoChain specimens + orgs (secondary ground truth)
- `academic_ground_truth.json` — papers + institutions the pipeline should find (primary ground truth)
- `eval_criteria.json` — per-layer scoring rubrics, expected readiness ranges, known unknowns
- `difficulty.json` — difficulty rating + expected failure modes

### Dual ground truth

The sourcing pipeline is paper-first (PubMed → author → institution → biobank). AminoChain orgs are mostly commercial CROs with no publications. Score recall against `academic_ground_truth.json` (primary), treat AminoChain overlap as bonus.

| Ground truth | What it contains | How to score |
|---|---|---|
| `academic_ground_truth.json` | Papers with PMIDs, institutions, specimen info | Primary recall target — pipeline should find these |
| `ground_truth.json` | AminoChain commercial inventory | Bonus signal — pipeline may find via web search |

## Bundle index

### Oncology-ADC (5 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `tnbc-er-neg-pr-neg-ffpe` | hard | 576 | 7 | 3 | ER-/PR-; K2EDTA, -80C; matched; treatment-naive |
| `nsclc-metastatic-t4-or-m1-serum` | hard | 209 | 1 | 2 | T4/M1; SST, -80C; matched; treatment-naive |
| `bladder-t2plus-ffpe-urine` | medium | 344 | 7 | 3 | T2+; urine preservative; matched |
| `crc-t3n1-ffpe-plasma-matched` | easy | 531 | 6 | 4 | T3N1; K2EDTA, -80C; matched; treatment-naive preferred |
| `pancreatic-late-stage-ffpe-serum` | medium | 428 | 5 | 3 | T2+; SST, -80C; matched |

### Oncology — New (3 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `thyroid-cancer-ffpe-serum-staged` | medium | 891 | 8 | 5 | PTC; BRAF V600E preferred; TNM staged |
| `esophageal-cancer-ffpe-plasma` | medium | 640 | 7 | 5 | SCC or EAC; treatment-naive; histology subtype |
| `hcc-liver-ffpe-serum` | hard | 291 | 3 | 5 | HCC; etiology documented; Child-Pugh preferred |

### Immuno-oncology (2 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `melanoma-high-grade-tissue-k2edta-plasma` | easy | 1755 | 7 | 5 | T4/N+; K2EDTA, -80C; matched; no prior chemo |
| `lung-scc-streck-bct-liquid-biopsy` | impossible | 0 | 0 | 2 (none banked) | Streck BCT; matched — confirmed impossible |

### Neurodegeneration (6 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `als-csf-serum-dna-trio` | hard | 241 | 1 | 4+ | CSF+serum+DNA trio; cryopreserved; age>=50 |
| `pd-age-over-75-serum-pbmc-dna` | medium | 368 | 2 | 3 | PBMC cryopreserved; matched; age>=75 |
| `ms-csf-serum-recent-collection` | hard | 241 | 1 | 5 | Matched CSF+serum; recent collection |
| `alzheimers-tissue-serum-csf` | medium | 496 | 4 | 5 | Brain tissue; Braak staging; neuropath confirmed |
| `dementia-serum-plasma-dna-longitudinal` | easy | 990 | 6 | 5 | Longitudinal 2+ timepoints; cognitive scores |
| `pls-csf-serum-pbmc-dna` | hard | 529 | 1 | 6 | Ultra-rare MND; CSF+serum+PBMC+DNA from same patients |

### Cardiometabolic (2 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `diabetes-bmi-documented-edta-urine-plasma` | medium | 266 | 2 | 3 | Morning urine; EDTA; BMI documented; matched |
| `chf-atherosclerosis-comorbid-plasma-tissue` | medium | 700 | 2 | 4 | Comorbid CHF+atherosclerosis; plasma -80C; age>=60 |

### Immunology (2 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `copd-k2edta-plasma-buffy-bal` | medium | 412 | 2 | 4 | K2EDTA+buffy+BAL; matched; treatment-naive |
| `asthma-medication-documented-serum-plasma` | hard | 214 | 1 | 3 | Medication history; matched serum+plasma |

### Autoimmune — New (3 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `psoriasis-skin-biopsy-plasma-serum` | medium | 562 | 3 | 6 | Lesional+non-lesional paired; PASI documented |
| `lupus-sle-tissue-serum` | hard | 203 | 3 | 5 | Kidney biopsy (LN class III-V); ANA/anti-dsDNA |
| `rheumatoid-arthritis-synovial-serum-urine` | medium | 284 | 3 | 5 | Synovial fluid/tissue; RF/anti-CCP; medication history |

### Infectious (1 bundle)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `covid-vaccinated-2024-plasma-serum-buffy` | medium | 1028 | 2 | 3 | Vaccinated; matched plasma+serum+buffy |

### Heme (2 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `lymphoma-ffpe-grade3-serum-matched` | medium | 375 | 7 | 4 | Grade 3+; serum -80C; no prior radiation; age>=50 |
| `cll-leukemia-pbmc-plasma-tissue` | hard | 231 | 10 | 5 | CLL; PBMC+plasma; treatment-naive; IGHV status |

### Rare (3 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `cholangiocarcinoma-t2n1-ffpe-plasma` | medium | 200 | 4 | 3 | T2N1+; matched FFPE+plasma |
| `glioblastoma-frozen-plasma-young` | medium | 258 | 9 | 3 | Frozen tissue+plasma; matched; age<=60 |
| `thymoma-ffpe-plasma-staged` | hard | 260 | 4 | 6 | Masaoka-Koga staged; WHO histotype (A/AB/B1/B2/B3/C) |

### Women's Health (3 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `ovarian-t3-ffpe-plasma-er-annotated` | medium | 462 | 6 | 4 | T3+; ER/PR annotated; matched FFPE+plasma |
| `cervical-young-t1-ffpe-hiv-screened` | medium | 238 | 4 | 2 | T1N0; age<=40; HIV screened |
| `uterine-endometrial-ffpe-plasma-staged` | medium | 1543 | 9 | 5 | FIGO staged; histotype documented; treatment-naive |

### Hepatology — New (1 bundle)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `cirrhosis-liver-tissue-ffpe` | hard | 174 | 1 | 5 | Any etiology; METAVIR F4; Child-Pugh preferred |

### Cross-cutting (3 bundles)

| Bundle | Difficulty | AC Specimens | AC Orgs | Academic Papers | Key constraints |
|---|---|---|---|---|---|
| `multi-cancer-comorbid-covid-tissue` | hard | 692 | 1 | 3 | Cancer+COVID comorbid tissue |
| `breast-idc-her2-er-pr-ki67-full-panel` | medium | 576 | 7 | 2 | Complete IHC panel + TNM; K2EDTA, -80C; matched |
| `prostate-acinar-high-grade-ffpe-serum` | medium | 427 | 6 | 3 | T2+; treatment-naive; no hormonal therapy |

## Difficulty distribution

| Difficulty | Count | Bundles |
|---|---|---|
| easy | 3 | `crc-t3n1`, `melanoma-high-grade`, `dementia-longitudinal` |
| medium | 22 | Most bundles |
| hard | 10 | `tnbc`, `nsclc`, `als-csf`, `ms-csf`, `asthma`, `multi-cancer-covid`, `hcc-liver`, `lupus-sle`, `cll-leukemia`, `thymoma`, `cirrhosis`, `pls-csf` |
| impossible | 1 | `lung-scc-streck-bct` |

## Coverage

| Metric | Value |
|---|---|
| AminoChain specimens in bundles | 17,635 of 27,514 (64.1%) |
| Therapeutic areas covered | 13 |
| Unique AminoChain orgs referenced | 13 |
| Academic papers in ground truth | ~135 |
| Academic institutions referenced | ~80 |

## Data provenance

- **AminoChain source**: AminoChain Specimen Center API (`data-api.aminochain.io`)
- **AminoChain extraction date**: —
- **AminoChain raw data**: `store/eval/aminochain/` (27,514 specimens, 257 JSONL files)
- **Academic papers**: PubMed, medRxiv, bioRxiv searches conducted —/24
- **Scripts**: `scripts/aminochain_extract.py`, `scripts/aminochain_eval_bundles.py`

## Organizations in AminoChain ground truth

| Organization | Contact | Country | Specimens |
|---|---|---|---|
| BIOMEDICA CRO | office@biomedica-cro.com | UKR | 9,383 |
| ProteoGenex | dsuchkov@proteogenex.com | USA | 5,822 |
| The Neuro C-BIG Repository | cbig.mni@mcgill.ca | CAN | 2,769 |
| Stibion | info@stibion.nl | NLD | 759 |
| Ukraine Research Group | sales@ukrresearch.com | UKR | 613 |
| Medical Gate | (generic) | TUR | 517 |
| CSD Bio | d.obukhov@csd.com.ua | UKR | 480 |
| France Tissue Bank | contact@francetissuebank.com | FRA | 430 |
| CHTN Eastern | dfitzsim@pennmedicine.upenn.edu | USA | 226 |
| Reference Medicine | (generic) | USA | 212 |
| Shlok Superspecialty Care | (generic) | IND | 26 |
| JLR Life Sciences | (generic) | — | 2 |
| NDRI | info@ndriresource.org | USA | 2 |

### Retrievability via academic literature

| Tier | Orgs | Discovery channel | % of AC specimens |
|---|---|---|---|
| Retrievable via PubMed/preprints | CHTN, C-BIG, NDRI, ProteoGenex | Papers cite them as specimen source | ~32% |
| Not retrievable (no academic footprint) | BIOMEDICA CRO, CSD Bio, Ukraine Research Group, France Tissue Bank, Medical Gate, Stibion | Zero publications | ~68% |
