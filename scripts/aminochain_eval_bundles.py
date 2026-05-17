#!/usr/bin/env python3
"""
Generate eval bundles from AminoChain extracted data.

Each bundle = query.json + ground_truth.json + eval_criteria.json + difficulty.json
Tests the sourcing pipeline (docs/mvp-v2.md) against real specimen registry data.

Usage:
  python3 scripts/aminochain_eval_bundles.py
"""

import json
import math
import time
from pathlib import Path

# ── paths ──────────────────────────────────────────────────────────────────

AMINOCHAIN_DIR = Path("store/eval/aminochain/organized")
SPECIMENS_FILE = AMINOCHAIN_DIR / "all_specimens.jsonl"
ORG_PROFILES_FILE = AMINOCHAIN_DIR / "org_profiles.json"
MATCHED_PAIRS_FILE = AMINOCHAIN_DIR / "matched_pairs.json"
BUNDLES_DIR = Path("store/eval/bundles")

# ── bundle definitions ─────────────────────────────────────────────────────

BUNDLE_DEFS = [
    # ── Oncology ADC ──────────────────────────────────────────────────────
    {
        "id": "tnbc-er-neg-pr-neg-ffpe", "area": "oncology-adc",
        "query_text": "Triple-negative breast cancer FFPE — must be ER-negative AND PR-negative confirmed by IHC. Need grade 3+ invasive ductal carcinoma, treatment-naive (no prior chemo/radiation/hormonal). Matched K2EDTA plasma stored at -80C for ctDNA. N >= 40 paired.",
        "intent": "commission",
        "parsed": {
            "indication": ["Breast cancer", "Invasive ductal cancer (IDC)"],
            "specimen_types": ["Tissue (FFPE)", "Plasma"],
            "biomarkers_required": ["ER negative", "PR negative"],
            "biomarkers_desired": ["HER2", "Ki67"],
            "preservation": "Fixed", "min_n": 40,
            "treatment_status": "strictly treatment-naive",
            "matched_pairs": True,
            "grade_minimum": 3,
            "preanalytical": {"tube_type": "K2EDTA", "storage_temp": "-80C"},
            "assay_context": "TROP2 ADC patient selection — sacituzumab govitecan CDx development"
        },
        "filters": {"diagnoses": ["Breast cancer", "Invasive ductal cancer (IDC)"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },
    {
        "id": "nsclc-metastatic-t4-or-m1-serum", "area": "oncology-adc",
        "query_text": "Metastatic NSCLC (stage IV — T4 or M1) serum samples stored at -80C in SST tubes. Need treatment-naive patients only. Must have documented smoking history. Matched buffy coat for germline DNA. N >= 30.",
        "intent": "commission",
        "parsed": {
            "indication": ["Non-Small cell lung cancer (NSCLC)", "Lung cancer"],
            "specimen_types": ["Serum", "Buffy coat"],
            "biomarkers_desired": ["EGFR", "ALK", "PD-L1"],
            "staging_required": "T4 or M1",
            "min_n": 30,
            "treatment_status": "treatment-naive",
            "matched_pairs": True,
            "preanalytical": {"tube_type": "SST", "storage_temp": "-80C"},
            "clinical_data_required": ["smoking_history"],
            "assay_context": "Datopotamab deruxtecan (Dato-DXd) TROP2 ADC — late-stage NSCLC cohort"
        },
        "filters": {"diagnoses": ["Non-Small cell lung cancer (NSCLC)"],
                     "specimen_types": ["Serum"]},
        "secondary_filters": {"specimen_types": ["Buffy coat"]},
    },
    {
        "id": "bladder-t2plus-ffpe-urine", "area": "oncology-adc",
        "query_text": "Muscle-invasive bladder cancer (T2+) FFPE with papillary urothelial histology. Need matched urine collected in EDTA/Azide/Glycerol preservative. HIV/HepB/HepC screening status must be documented. N >= 20.",
        "intent": "commission",
        "parsed": {
            "indication": ["Bladder Cancer"],
            "specimen_types": ["Tissue (FFPE)", "Urine"],
            "staging_required": "T2+",
            "histology_required": "papillary urothelial carcinoma",
            "preservation": "Fixed", "min_n": 20,
            "matched_pairs": True,
            "preanalytical": {"urine_preservative": "EDTA/Azide/Glycerol"},
            "clinical_data_required": ["HIV_status", "HepB_status", "HepC_status"],
            "assay_context": "Enfortumab vedotin Nectin-4 CDx — urine ctDNA concordance"
        },
        "filters": {"diagnoses": ["Bladder Cancer"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Urine"]},
    },
    {
        "id": "crc-t3n1-ffpe-plasma-matched", "area": "oncology-adc",
        "query_text": "Colorectal adenocarcinoma FFPE, specifically T3N1M0 or T3N1M1 staging, with matched K2EDTA plasma at -80C. Need tumor percentage documented. Treatment-naive preferred but post-surgical resection samples acceptable. N >= 50 paired.",
        "intent": "commission",
        "parsed": {
            "indication": ["Colon cancer", "Gastrointestinal disorder"],
            "specimen_types": ["Tissue (FFPE)", "Plasma"],
            "staging_required": "T3N1",
            "histology_required": "adenocarcinoma",
            "preservation": "Fixed", "min_n": 50,
            "treatment_status": "treatment-naive preferred, post-surgical OK",
            "matched_pairs": True,
            "preanalytical": {"tube_type": "K2EDTA", "storage_temp": "-80C"},
            "clinical_data_required": ["tumor_percentage"],
            "assay_context": "Tusamitamab ravtansine (CEACAM5 ADC) — MRD ctDNA assay validation"
        },
        "filters": {"diagnoses": ["Colon cancer"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },
    {
        "id": "pancreatic-late-stage-ffpe-serum", "area": "oncology-adc",
        "query_text": "Pancreatic ductal adenocarcinoma FFPE, T2+ staging, with matched serum stored in Vacutainer SST at -80C. Need BMI and weight documented (cachexia correlation). Patients with documented concomitant diabetes are acceptable. N >= 30.",
        "intent": "commission",
        "parsed": {
            "indication": ["Pancreatic cancer", "Gastrointestinal disorder"],
            "specimen_types": ["Tissue (FFPE)", "Serum"],
            "staging_required": "T2+",
            "preservation": "Fixed", "min_n": 30,
            "matched_pairs": True,
            "preanalytical": {"tube_type": "SST", "storage_temp": "-80C"},
            "clinical_data_required": ["BMI", "weight", "concomitant_diabetes"],
            "assay_context": "HER2-low pancreatic cancer — T-DXd expansion cohort biomarker study"
        },
        "filters": {"diagnoses": ["Pancreatic cancer"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Serum"]},
    },

    # ── Immuno-oncology ───────────────────────────────────────────────────
    {
        "id": "melanoma-high-grade-tissue-k2edta-plasma", "area": "immuno-oncology",
        "query_text": "High-grade (grade 3+) cutaneous melanoma FFPE with T4N0 or nodal-positive staging. Need matched K2EDTA plasma at -80C. Require documented surgical procedure type. Prior chemo patients excluded. N >= 25.",
        "intent": "commission",
        "parsed": {
            "indication": ["Melanoma", "Skin cancer"],
            "specimen_types": ["Tissue (FFPE)", "Plasma"],
            "biomarkers_desired": ["BRAF", "PD-L1"],
            "staging_required": "T4 or N+",
            "grade_minimum": 3,
            "preservation": "Fixed", "min_n": 25,
            "treatment_status": "no prior chemo",
            "matched_pairs": True,
            "preanalytical": {"tube_type": "K2EDTA", "storage_temp": "-80C"},
            "assay_context": "Anti-LAG3 + anti-PD1 combo — TMB/ctDNA correlation in advanced melanoma"
        },
        "filters": {"diagnoses": ["Melanoma", "Skin cancer"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },
    {
        "id": "lung-scc-streck-bct-liquid-biopsy", "area": "immuno-oncology",
        "query_text": "Lung squamous cell carcinoma (SCC) — need liquid biopsy specimens collected in Streck BCT tubes (cell-free DNA preservation). Patients with documented smoking history (pack-years). Matched FFPE from surgical resection. Any stage. N >= 15.",
        "intent": "commission",
        "parsed": {
            "indication": ["Squamous cell cancer (SCC)", "Lung cancer", "Non-Small cell lung cancer (NSCLC)"],
            "specimen_types": ["Other (Streck BCT)", "Tissue (FFPE)"],
            "preanalytical": {"tube_type": "Streck BCT"},
            "clinical_data_required": ["smoking_history_pack_years"],
            "matched_pairs": True, "min_n": 15,
            "assay_context": "cfDNA-based TMB estimation — pembrolizumab CDx for lung SCC"
        },
        "filters": {"diagnoses": ["Squamous cell cancer (SCC)", "Lung cancer"],
                     "specimen_types": ["Other"]},
        "secondary_filters": {"specimen_types": ["Tissue"]},
    },

    # ── Neurodegeneration ─────────────────────────────────────────────────
    {
        "id": "als-csf-serum-dna-trio", "area": "neurodegeneration",
        "query_text": "ALS patients with CSF + serum + DNA from the same donor (trio specimens). CSF must be cryopreserved. Need documented age > 50 at collection. Require both sporadic and familial ALS subtypes in the cohort. N >= 20 trios.",
        "intent": "commission",
        "parsed": {
            "indication": ["Amyotrophic Lateral Sclerosis (ALS)"],
            "specimen_types": ["Cerebrospinal fluid (CSF)", "Serum", "DNA"],
            "biomarkers_desired": ["NfL", "SOD1"],
            "matched_pairs": True, "min_n": 20,
            "age_minimum": 50,
            "preanalytical": {"csf_preservation": "cryopreserved"},
            "clinical_data_required": ["als_subtype_sporadic_vs_familial"],
            "assay_context": "SOD1 antisense oligonucleotide trial — baseline NfL stratification"
        },
        "filters": {"diagnoses": ["Amyotrophic Lateral Sclerosis (ALS)"],
                     "specimen_types": ["Cerebrospinal fluid (CSF)"]},
        "secondary_filters": {"specimen_types": ["Serum", "DNA"]},
    },
    {
        "id": "pd-age-over-75-serum-pbmc-dna", "area": "neurodegeneration",
        "query_text": "Parkinson's disease patients aged 75+ with serum + PBMCs + DNA from same donor. Need documented medication history. Cryopreserved PBMCs required. Collected 2020 or later. N >= 30.",
        "intent": "commission",
        "parsed": {
            "indication": ["Parkinson's disease (PD)", "Neurological condition"],
            "specimen_types": ["Serum", "PBMCs", "DNA"],
            "matched_pairs": True, "min_n": 30,
            "age_minimum": 75,
            "collection_date_minimum": 2020,
            "preanalytical": {"pbmc_preservation": "cryopreserved"},
            "clinical_data_required": ["medication_history"],
            "assay_context": "LRRK2 kinase inhibitor trial — elderly PD immunophenotyping + genotyping"
        },
        "filters": {"diagnoses": ["Parkinson's disease (PD)"],
                     "specimen_types": ["Serum"]},
        "secondary_filters": {"specimen_types": ["Peripheral blood mononuclear cells (PBMCs)", "DNA"]},
    },
    {
        "id": "ms-csf-serum-recent-collection", "area": "neurodegeneration",
        "query_text": "Multiple sclerosis CSF + matched serum, collected 2023 or later. Need frozen storage. Documented MS subtype (RRMS vs PPMS vs SPMS). Both male and female donors needed — at least 40% each sex. N >= 25.",
        "intent": "commission",
        "parsed": {
            "indication": ["Multiple Sclerosis (MS)", "Neurological condition"],
            "specimen_types": ["Cerebrospinal fluid (CSF)", "Serum"],
            "matched_pairs": True, "min_n": 25,
            "collection_date_minimum": 2023,
            "sex_balance": "at least 40% each sex",
            "clinical_data_required": ["ms_subtype"],
            "assay_context": "Bruton's tyrosine kinase (BTK) inhibitor — CSF biomarker panel"
        },
        "filters": {"diagnoses": ["Multiple Sclerosis (MS)"],
                     "specimen_types": ["Cerebrospinal fluid (CSF)"]},
        "secondary_filters": {"specimen_types": ["Serum"]},
    },

    # ── Cardiometabolic ───────────────────────────────────────────────────
    {
        "id": "diabetes-bmi-documented-edta-urine-plasma", "area": "cardiometabolic",
        "query_text": "Type 2 diabetes patients with documented BMI > 30 and weight in kg. Need EDTA urine (morning collection, simple spin) + matched plasma at -20C. Patients with documented cardiac comorbidities (CHF, hypertension, arrhythmia) preferred. Collected 2023+. N >= 40.",
        "intent": "commission",
        "parsed": {
            "indication": ["Diabetes", "Congestive Heart Failure (CHF)"],
            "specimen_types": ["Urine", "Plasma"],
            "matched_pairs": True, "min_n": 40,
            "collection_date_minimum": 2023,
            "clinical_data_required": ["BMI", "weight_kg", "cardiac_comorbidities"],
            "preanalytical": {"urine_type": "morning collection", "urine_tube": "EDTA/Azide/Glycerol", "plasma_storage": "-20C"},
            "assay_context": "Tirzepatide (GLP-1/GIP dual agonist) — renal biomarker panel for diabetic nephropathy"
        },
        "filters": {"diagnoses": ["Diabetes"],
                     "specimen_types": ["Urine"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },
    {
        "id": "chf-atherosclerosis-comorbid-plasma-tissue", "area": "cardiometabolic",
        "query_text": "Patients with BOTH congestive heart failure AND atherosclerosis (comorbid). Need plasma stored at -80C + any available tissue. Documented height, weight, and hemolysis level. Age 60+. N >= 15.",
        "intent": "commission",
        "parsed": {
            "indication": ["Congestive Heart Failure (CHF)", "Atherosclerosis"],
            "specimen_types": ["Plasma", "Tissue"],
            "matched_pairs": True, "min_n": 15,
            "comorbidity_required": ["CHF", "atherosclerosis"],
            "age_minimum": 60,
            "clinical_data_required": ["height", "weight", "hemolysis_level"],
            "preanalytical": {"plasma_storage": "-80C"},
            "assay_context": "Cardiovascular inflammation proteomics — IL-1beta pathway biomarkers"
        },
        "filters": {"diagnoses": ["Congestive Heart Failure (CHF)"],
                     "specimen_types": ["Plasma"]},
        "secondary_filters": {"specimen_types": ["Tissue"]},
    },

    # ── Immunology ────────────────────────────────────────────────────────
    {
        "id": "copd-k2edta-plasma-buffy-bal", "area": "immunology",
        "query_text": "COPD patients with K2EDTA plasma at -80C + buffy coat + BAL fluid from same donor. Need documented pack-year smoking history and FEV1 values. Treatment-naive (no prior ICS or biologics). N >= 10 trios.",
        "intent": "commission",
        "parsed": {
            "indication": ["Chronic Obstructive Pulmonary Disease (COPD)"],
            "specimen_types": ["Plasma", "Buffy coat", "Bronchoalveolar lavage fluid"],
            "matched_pairs": True, "min_n": 10,
            "treatment_status": "treatment-naive",
            "preanalytical": {"tube_type": "K2EDTA", "storage_temp": "-80C"},
            "clinical_data_required": ["smoking_pack_years", "FEV1"],
            "assay_context": "Dupixent COPD expansion — Type 2 inflammation biomarker discovery"
        },
        "filters": {"diagnoses": ["Chronic Obstructive Pulmonary Disease (COPD)"],
                     "specimen_types": ["Plasma"]},
        "secondary_filters": {"specimen_types": ["Buffy coat", "Bronchoalveolar lavage fluid"]},
    },
    {
        "id": "asthma-medication-documented-serum-plasma", "area": "immunology",
        "query_text": "Asthma patients with documented current medication list. Need paired serum + plasma, both from same blood draw. Must have documented BMI. Age 40-70. Exclude patients with cancer history. N >= 40.",
        "intent": "commission",
        "parsed": {
            "indication": ["Asthma"],
            "specimen_types": ["Serum", "Plasma"],
            "matched_pairs": True, "min_n": 40,
            "age_range": "40-70",
            "exclusion": "cancer history",
            "clinical_data_required": ["medication_list", "BMI"],
            "assay_context": "Tezepelumab (anti-TSLP) — broad asthma phenotyping, non-eosinophilic subset"
        },
        "filters": {"diagnoses": ["Asthma"],
                     "specimen_types": ["Serum"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },

    # ── Infectious ────────────────────────────────────────────────────────
    {
        "id": "covid-vaccinated-2024-plasma-serum-buffy", "area": "infectious",
        "query_text": "COVID-19 positive patients collected in 2024, with documented vaccination status (manufacturer + dose count). Need plasma + serum + buffy coat trio from same donor. Must have HIV/HepB/HepC screening documented as negative. Both male and female. N >= 50.",
        "intent": "commission",
        "parsed": {
            "indication": ["Coronavirus (Covid)"],
            "specimen_types": ["Plasma", "Serum", "Buffy coat"],
            "matched_pairs": True, "min_n": 50,
            "collection_date_minimum": 2024,
            "clinical_data_required": ["vaccination_status", "vaccine_manufacturer", "dose_count", "HIV_negative", "HepB_negative", "HepC_negative"],
            "sex_balance": "both required",
            "assay_context": "Variant-specific neutralizing antibody titer assay — next-gen COVID vaccine development"
        },
        "filters": {"diagnoses": ["Coronavirus (Covid)"],
                     "specimen_types": ["Plasma"]},
        "secondary_filters": {"specimen_types": ["Serum", "Buffy coat"]},
    },

    # ── Heme ──────────────────────────────────────────────────────────────
    {
        "id": "lymphoma-ffpe-grade3-serum-matched", "area": "heme",
        "query_text": "Non-Hodgkin lymphoma FFPE tissue, grade 3+, with matched serum at -80C. Need documented tumor size and pathological grade. Exclude patients with prior radiation. Age 50+. N >= 20 paired.",
        "intent": "commission",
        "parsed": {
            "indication": ["Lymphoma", "Non-Hodgkin lymphoma"],
            "specimen_types": ["Tissue (FFPE)", "Serum"],
            "grade_minimum": 3,
            "preservation": "Fixed", "min_n": 20,
            "treatment_status": "no prior radiation",
            "matched_pairs": True, "age_minimum": 50,
            "preanalytical": {"serum_storage": "-80C"},
            "clinical_data_required": ["tumor_size", "pathological_grade"],
            "assay_context": "Loncastuximab tesirine (CD19 ADC) — tumor microenvironment spatial profiling"
        },
        "filters": {"diagnoses": ["Lymphoma"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Serum"]},
    },

    # ── Rare ──────────────────────────────────────────────────────────────
    {
        "id": "cholangiocarcinoma-t2n1-ffpe-plasma", "area": "rare",
        "query_text": "Intrahepatic cholangiocarcinoma FFPE, T2N1 or higher staging, with matched plasma. Need documented surgical procedure and pathology report including tumor size. HIV/HepB/HepC status required. Any N — this is rare.",
        "intent": "commission",
        "parsed": {
            "indication": ["Cholangiocarcinoma"],
            "specimen_types": ["Tissue (FFPE)", "Plasma"],
            "staging_required": "T2N1+",
            "preservation": "Fixed",
            "matched_pairs": True,
            "clinical_data_required": ["surgical_procedure", "tumor_size", "pathology_report", "HIV_HepB_HepC_status"],
            "assay_context": "FGFR2 selective inhibitor — ctDNA minimal residual disease monitoring"
        },
        "filters": {"diagnoses": ["Cholangiocarcinoma"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },
    {
        "id": "glioblastoma-frozen-plasma-young", "area": "rare",
        "query_text": "Glioblastoma fresh-frozen tissue (NOT FFPE) + matched plasma from patients under 60. Need documented IDH mutation status or at minimum Ki67 proliferation index. Tissue from surgical resection only. N >= 10.",
        "intent": "commission",
        "parsed": {
            "indication": ["Glioblastoma"],
            "specimen_types": ["Tissue (Frozen)", "Plasma"],
            "biomarkers_desired": ["IDH1", "IDH2", "Ki67", "MGMT"],
            "preservation": "Frozen", "min_n": 10,
            "age_maximum": 60,
            "matched_pairs": True,
            "clinical_data_required": ["surgical_procedure"],
            "assay_context": "GBM neoantigen vaccine — tumor mutational burden profiling from fresh tissue"
        },
        "filters": {"diagnoses": ["Glioblastoma"],
                     "specimen_types": ["Tissue"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },

    # ── Women's health ────────────────────────────────────────────────────
    {
        "id": "ovarian-t3-ffpe-plasma-er-annotated", "area": "womens-health",
        "query_text": "Advanced ovarian cancer (T3+) FFPE with ER and PR receptor status documented. Need matched plasma at -80C. Only serous histology. Treatment-naive. Documented surgical procedure (debulking vs biopsy). N >= 30.",
        "intent": "commission",
        "parsed": {
            "indication": ["Ovarian cancer"],
            "specimen_types": ["Tissue (FFPE)", "Plasma"],
            "biomarkers_required": ["ER", "PR"],
            "staging_required": "T3+",
            "histology_required": "serous",
            "preservation": "Fixed", "min_n": 30,
            "treatment_status": "treatment-naive",
            "matched_pairs": True,
            "preanalytical": {"plasma_storage": "-80C"},
            "clinical_data_required": ["surgical_procedure_type"],
            "assay_context": "Mirvetuximab soravtansine (FRa ADC) — FRa/hormone receptor co-expression"
        },
        "filters": {"diagnoses": ["Ovarian cancer"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
    },
    {
        "id": "cervical-young-t1-ffpe-hiv-screened", "area": "womens-health",
        "query_text": "Cervical cancer in patients under 40, T1N0 staging, FFPE tissue. Must have documented HIV/HepB/HepC negative status. Need serum with documented hemolysis level (must be non-hemolyzed). Squamous cell or adenocarcinoma histology. N >= 15.",
        "intent": "commission",
        "parsed": {
            "indication": ["Cervical cancer"],
            "specimen_types": ["Tissue (FFPE)", "Serum"],
            "staging_required": "T1N0",
            "preservation": "Fixed", "min_n": 15,
            "age_maximum": 40,
            "matched_pairs": True,
            "clinical_data_required": ["HIV_negative", "HepB_negative", "HepC_negative", "hemolysis_level"],
            "assay_context": "Tisotumab vedotin — tissue factor expression in early-stage cervical cancer"
        },
        "filters": {"diagnoses": ["Cervical cancer"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Serum"]},
    },

    # ── Cross-cutting (hardest) ───────────────────────────────────────────
    {
        "id": "multi-cancer-comorbid-covid-tissue", "area": "cross-cutting",
        "query_text": "Cancer patients who also had documented COVID-19 — any solid tumor FFPE with documented vaccination status. Need samples collected 2024. Want to compare tumor immune infiltrate between vaccinated and unvaccinated cancer patients. Any cancer type. N >= 20.",
        "intent": "commission",
        "parsed": {
            "indication": ["Coronavirus (Covid)", "any solid tumor"],
            "specimen_types": ["Tissue (FFPE)"],
            "comorbidity_required": ["cancer", "COVID-19"],
            "collection_date_minimum": 2024,
            "clinical_data_required": ["vaccination_status"],
            "preservation": "Fixed", "min_n": 20,
            "assay_context": "COVID impact on tumor immunity — mRNA vaccine + checkpoint inhibitor interaction"
        },
        "filters": {"diagnoses": ["Coronavirus (Covid)"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
    },
    {
        "id": "breast-idc-her2-er-pr-ki67-full-panel", "area": "cross-cutting",
        "query_text": "Invasive ductal breast carcinoma FFPE with COMPLETE biomarker panel: HER2/neu + ER + PR + Ki67 ALL documented on the SAME specimen. Need grade 2+ and full TNM staging (T, N, M all non-null). Treatment-naive, post-surgical resection. Need specimen collected 2020+. Matched plasma in K2EDTA at -80C. N >= 25 paired.",
        "intent": "commission",
        "parsed": {
            "indication": ["Breast cancer", "Invasive ductal cancer (IDC)"],
            "specimen_types": ["Tissue (FFPE)", "Plasma"],
            "biomarkers_required": ["HER2", "ER", "PR", "Ki67"],
            "preservation": "Fixed", "min_n": 25,
            "grade_minimum": 2,
            "staging_required": "complete TNM (T+N+M all documented)",
            "treatment_status": "treatment-naive, post-surgical",
            "collection_date_minimum": 2020,
            "matched_pairs": True,
            "preanalytical": {"tube_type": "K2EDTA", "storage_temp": "-80C"},
            "assay_context": "Molecular subtype classifier validation — Luminal A vs B vs HER2-enriched vs Basal"
        },
        "filters": {"diagnoses": ["Breast cancer", "Invasive ductal cancer (IDC)"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Plasma"]},
        "require_all_biomarkers": ["HER2", "ER", "PR", "Ki67"],
    },
    {
        "id": "prostate-acinar-high-grade-ffpe-serum", "area": "cross-cutting",
        "query_text": "Prostate acinar adenocarcinoma, Gleason grade 3+4 or higher (grade 2+ in structured data), T2+ staging. FFPE tissue with matched serum. Need documented PSA level or any tumor marker. Treatment-naive only — no prior hormonal therapy. Age 55-75. N >= 25.",
        "intent": "commission",
        "parsed": {
            "indication": ["Prostate cancer", "Acinar adenocarcinoma"],
            "specimen_types": ["Tissue (FFPE)", "Serum"],
            "grade_minimum": 2,
            "staging_required": "T2+",
            "preservation": "Fixed", "min_n": 25,
            "treatment_status": "treatment-naive, no hormonal therapy",
            "matched_pairs": True,
            "age_range": "55-75",
            "clinical_data_required": ["PSA_or_tumor_marker"],
            "assay_context": "PSMA-targeted ADC — PSMA expression vs circulating biomarker correlation"
        },
        "filters": {"diagnoses": ["Prostate cancer", "Acinar adenocarcinoma"],
                     "specimen_types": ["Tissue"], "preservation": ["Fixed"]},
        "secondary_filters": {"specimen_types": ["Serum"]},
    },
]

# ── helpers ────────────────────────────────────────────────────────────────

def load_specimens():
    specs = []
    with open(SPECIMENS_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                specs.append(json.loads(line))
    return specs


def load_org_map():
    with open(ORG_PROFILES_FILE) as f:
        data = json.load(f)
    return {o["id"]: o for o in data.get("organizations", data)}


def matches_filter(spec, filt):
    if "diagnoses" in filt:
        spec_diags = set(spec.get("specimen_diagnoses", []))
        if not spec_diags.intersection(filt["diagnoses"]):
            return False
    if "specimen_types" in filt:
        if spec.get("specimen_type") not in filt["specimen_types"]:
            return False
    if "preservation" in filt:
        if spec.get("preservation_category") not in filt["preservation"]:
            return False
    return True


def get_biomarkers(spec):
    markers = {}
    for m in spec.get("unstructured_measurements", []):
        name = (m.get("measurement") or "").lower()
        val = m.get("value")
        if "her2" in name:
            markers["HER2"] = val
        if name in ("er", "estrogen receptor"):
            markers["ER"] = val
        if name in ("pr", "progesterone receptor"):
            markers["PR"] = val
        if "ki67" in name or "ki-67" in name:
            markers["Ki67"] = val
        if "pd-l1" in name or "pdl1" in name:
            markers["PD-L1"] = val
    return markers


def is_treatment_naive(spec):
    txt = (spec.get("unstructured_treatments") or "").lower()
    if not txt:
        return None  # unknown
    chemo_no = "chemo" in txt and "no" in txt
    radio_no = "radio" in txt and "no" in txt
    hormonal_no = "hormonal" in txt and "no" in txt
    if chemo_no and radio_no:
        return True
    return False


def build_ground_truth(bundle_def, specimens, org_map):
    filt = bundle_def["filters"]
    primary = [s for s in specimens if matches_filter(s, filt)]

    secondary = []
    if "secondary_filters" in bundle_def:
        sfilt = {**filt}
        sfilt.update(bundle_def["secondary_filters"])
        # keep diagnoses from primary filter
        if "preservation" in sfilt and "preservation" not in bundle_def["secondary_filters"]:
            del sfilt["preservation"]
        sfilt_clean = {"diagnoses": filt.get("diagnoses", []),
                       "specimen_types": bundle_def["secondary_filters"]["specimen_types"]}
        secondary = [s for s in specimens if matches_filter(s, sfilt_clean)]

    all_matched = primary + secondary

    # Group by org
    by_org = {}
    for s in all_matched:
        oid = s.get("organization_id", "")
        by_org.setdefault(oid, []).append(s)

    orgs_out = []
    for oid, specs in sorted(by_org.items(), key=lambda x: -len(x[1])):
        org_info = org_map.get(oid, {})
        primary_here = [s for s in specs if matches_filter(s, filt)]
        secondary_here = [s for s in specs if s not in primary_here]

        # Biomarker stats
        bm_counts = {"HER2": 0, "ER": 0, "PR": 0, "Ki67": 0, "PD-L1": 0}
        tnm_count = 0
        naive_count = 0
        for s in specs:
            bms = get_biomarkers(s)
            for k in bm_counts:
                if k in bms:
                    bm_counts[k] += 1
            sm = s.get("structured_measurements") or {}
            if sm.get("T") is not None:
                tnm_count += 1
            if is_treatment_naive(s):
                naive_count += 1

        # Demographics
        ages = [s.get("age_at_collection") for s in specs if s.get("age_at_collection")]
        countries = list(set(s.get("country_of_origin", "") for s in specs))

        # Matched pairs (same donor in primary and secondary)
        primary_donors = set(s.get("donor_id") for s in primary_here)
        secondary_donors = set(s.get("donor_id") for s in secondary_here)
        matched = len(primary_donors & secondary_donors)

        orgs_out.append({
            "name": org_info.get("name", "Unknown"),
            "organization_id": oid,
            "country": countries,
            "website": org_info.get("websiteUrl", ""),
            "contact_email": org_info.get("contactEmail", ""),
            "address": org_info.get("address", ""),
            "description": (org_info.get("description") or "")[:200],
            "specimens": {
                "primary": {"count": len(primary_here), "type": filt.get("specimen_types", ["any"])[0] if filt.get("specimen_types") else "any"},
                "secondary": {"count": len(secondary_here), "type": bundle_def.get("secondary_filters", {}).get("specimen_types", ["none"])[0] if bundle_def.get("secondary_filters") else "none"},
            },
            "biomarkers": {k: v for k, v in bm_counts.items() if v > 0},
            "tnm_staged": tnm_count,
            "treatment_naive": naive_count,
            "matched_pair_donors": matched,
            "demographics": {
                "mean_age": round(sum(ages) / len(ages), 1) if ages else None,
                "n_with_age": len(ages),
                "countries": countries,
            },
        })

    # Specimen samples (up to 5 from primary)
    samples = []
    for s in primary[:5]:
        bms = get_biomarkers(s)
        sm = s.get("structured_measurements") or {}
        samples.append({
            "specimen_id": s.get("specimen_id", "")[:12] + "...",
            "specimen_type": s.get("specimen_type"),
            "preservation": s.get("preservation_category"),
            "source_site": s.get("source_site"),
            "sex": s.get("sex"),
            "age": s.get("age_at_collection"),
            "diagnoses": s.get("specimen_diagnoses", []),
            "biomarkers": bms if bms else "none annotated",
            "tnm": {k: sm.get(k) for k in ["T", "N", "M", "stage", "grade"] if sm.get(k) is not None} or None,
            "treatments": s.get("unstructured_treatments", "Not Provided"),
            "organization": org_map.get(s.get("organization_id", ""), {}).get("name", "Unknown"),
        })

    # Coverage gaps
    all_bm = {"HER2": 0, "ER": 0, "PR": 0, "Ki67": 0, "PD-L1": 0}
    for s in primary:
        bms = get_biomarkers(s)
        for k in all_bm:
            if k in bms:
                all_bm[k] += 1
    gaps = {}
    for k, v in all_bm.items():
        pct = round(v / len(primary) * 100, 1) if primary else 0
        if pct < 5:
            gaps[k.lower()] = f"{pct}% annotated — effectively not available"
    gaps["consent_scope"] = "not available in specimen data — requires direct inquiry"
    gaps["freeze_thaw_count"] = "not tracked in AminoChain data"

    return {
        "bundle_id": bundle_def["id"],
        "source": "aminochain",
        "extraction_date": "2026-04-23",
        "summary": {
            "total_primary_specimens": len(primary),
            "total_secondary_specimens": len(secondary),
            "total_donors": len(set(s.get("donor_id") for s in all_matched)),
            "organizations": [o["name"] for o in orgs_out if o["specimens"]["primary"]["count"] > 0],
            "matched_pair_donors": sum(o["matched_pair_donors"] for o in orgs_out),
        },
        "organizations": [o for o in orgs_out if o["specimens"]["primary"]["count"] > 0 or o["specimens"]["secondary"]["count"] > 0],
        "specimen_sample": samples,
        "coverage_gaps": gaps,
    }


def _estimate_readiness(org):
    """Estimate expected readiness scores for an org based on AminoChain data."""
    n = org["specimens"]["primary"]["count"]
    has_email = org["contact_email"] and "@" in org["contact_email"] and "aminochainprovider" not in org["contact_email"]
    has_website = bool(org["website"])
    has_biomarkers = sum(org.get("biomarkers", {}).values()) > 0
    has_tnm = org["tnm_staged"] > 0
    is_commercial = any(w in org["name"].lower() for w in ["proteogenex", "biomedica", "cro", "csd", "jlr", "medical gate"])

    # SI: specimen clarity
    if n >= 100 and has_biomarkers:
        si = "4-5"
    elif n >= 20:
        si = "3-4"
    elif n > 0:
        si = "2-3"
    else:
        si = "1"

    # CR: transaction readiness
    if has_email and has_website and is_commercial:
        cr = "4-5"
    elif has_email and has_website:
        cr = "3-4"
    elif has_email or has_website:
        cr = "2-3"
    else:
        cr = "1-2"

    # CF: protocol fitness (AminoChain has preservation + some storage, not full SOPs)
    if has_tnm and has_biomarkers:
        cf = "2-3"
    else:
        cf = "1-2"

    # MD: momentum (can't measure from registry data — pipeline must discover via PubMed/CTgov)
    if is_commercial:
        md = "3-4"
    else:
        md = "unknown"

    return {"SI": si, "CR": cr, "CF": cf, "MD": md}


def build_eval_criteria(bundle_def, ground_truth):
    """Build scoring rubrics per layer with pass/fail conditions."""
    orgs = ground_truth.get("organizations", [])
    orgs_with_data = [o for o in orgs if o["specimens"]["primary"]["count"] > 0]
    org_names = [o["name"] for o in orgs_with_data]

    # Per-org expected readiness
    org_readiness = {}
    for o in orgs_with_data[:5]:
        org_readiness[o["name"]] = {
            "expected_scores": _estimate_readiness(o),
            "specimen_count": o["specimens"]["primary"]["count"],
            "has_contact": bool(o["contact_email"] and "aminochainprovider" not in o["contact_email"]),
            "has_biomarkers": bool(o.get("biomarkers")),
        }

    # Biomarker gap analysis
    biomarkers_required = bundle_def["parsed"].get("biomarkers_required", [])
    biomarkers_desired = bundle_def["parsed"].get("biomarkers_desired", [])
    all_primary = ground_truth["summary"]["total_primary_specimens"]

    biomarker_availability = {}
    for bm in set(biomarkers_required + biomarkers_desired):
        total_annotated = sum(o.get("biomarkers", {}).get(bm, 0) for o in orgs)
        pct = round(total_annotated / all_primary * 100, 1) if all_primary else 0
        biomarker_availability[bm] = {
            "annotated": total_annotated,
            "pct": pct,
            "status": "available" if pct > 10 else "sparse" if pct > 0 else "not_indexed",
        }

    # Known unknowns (things the system MUST flag as gaps)
    known_unknowns = [
        {"field": "consent_scope", "reason": "not in any public registry — requires direct inquiry"},
        {"field": "commercial_use_terms", "reason": "not documented publicly — requires negotiation"},
        {"field": "freeze_thaw_count", "reason": "not tracked in specimen registries"},
    ]
    for bm in biomarkers_required:
        if biomarker_availability.get(bm, {}).get("status") == "not_indexed":
            known_unknowns.append({"field": f"{bm}_expression", "reason": f"{bm} not indexed in registry — needs retrospective IHC/FISH"})
    for bm in biomarkers_desired:
        if biomarker_availability.get(bm, {}).get("status") == "not_indexed":
            known_unknowns.append({"field": f"{bm}_expression", "reason": f"{bm} not indexed — retrospective testing required"})

    return {
        "bundle_id": bundle_def["id"],
        "layer_1_data": {
            "source_recall": {
                "ground_truth_orgs": org_names,
                "pass": "find >= 30% of ground truth orgs OR find >= 2 orgs with matching specimens",
                "notes": "Pipeline searches PubMed/CTgov/web — may find orgs not in AminoChain. Those are valid, not errors."
            },
            "evidence_integrity": {
                "checks": [
                    "every [documented] claim has verbatim quote + source ID",
                    "no 'likely'/'probably'/'typically' in Layer 1 facts",
                    "specimen counts cite a source, never estimated from training data",
                ],
                "pass": "zero violations",
                "hard_gate": True,
            },
            "pillar_coverage_per_source": {
                "SI_fields": ["specimen_type", "n_value", "storage_conditions", "biorepository_name"],
                "CR_fields": ["contact_name", "contact_email", "website", "access_route", "consent_scope"],
                "CF_fields": ["preservation_method", "collection_protocol", "storage_temp", "time_to_freeze"],
                "MD_fields": ["publication_count", "publication_recency", "trial_count", "industry_partnerships"],
                "pass": "mean >= 40% of available fields filled per source",
            },
        },
        "layer_2_inference": {
            "label_separation": {
                "required_labels": ["documented", "verified", "unverified", "not_stated"],
                "checks": [
                    "every claim carries one of the 4 labels",
                    "every [verified]/[unverified] cites the [documented] facts it's based on",
                    "hypotheses state what verification was attempted",
                ],
                "pass": ">= 80% of claims properly labeled",
                "hard_gate": True,
            },
            "score_calibration": {
                "per_org_expected": org_readiness,
                "pass": "mean absolute error <= 1.0 per criterion vs expected range",
            },
            "gap_honesty": {
                "must_flag_as_unknown": known_unknowns,
                "pass": "flag >= 60% of known unknowns",
                "fail": "< 30% flagged (system presents incomplete picture as complete)",
            },
        },
        "layer_3_output": {
            "outreach_brief_required_fields": {
                "documented": ["specimens.types", "specimens.n", "specimens.source_id"],
                "contacts": ["name OR email"],
                "scores": ["SI", "CR", "CF", "MD", "readiness"],
                "gaps": ["field", "status", "what_to_ask"],
                "outreach": ["what_to_ask", "opening_hook"],
            },
            "ground_truth_overlap": {
                "aminochain_orgs": {o["name"]: o["specimens"]["primary"]["count"] for o in orgs_with_data[:5]},
                "pass": "at least 1 recommended source overlaps with AminoChain orgs",
            },
            "hallucination_check": {
                "checks": [
                    "no invented specimen counts — every N cites a source",
                    "no invented contacts — every email traces to paper/website/registry",
                    "no training-data fills for cost or biomarker data",
                ],
                "hard_gate": True,
            },
        },
        "biomarker_availability": biomarker_availability,
    }


def build_difficulty(bundle_def, ground_truth):
    """Assess bundle difficulty based on data availability and complexity."""
    orgs = ground_truth.get("organizations", [])
    n_primary = ground_truth["summary"]["total_primary_specimens"]
    n_orgs = len([o for o in orgs if o["specimens"]["primary"]["count"] > 0])

    # Data availability
    if n_primary >= 500 and n_orgs >= 5:
        data_avail = "high"
    elif n_primary >= 100 and n_orgs >= 2:
        data_avail = "medium"
    elif n_primary > 0:
        data_avail = "low"
    else:
        data_avail = "none"

    # Org discoverability (commercial orgs are harder to find via PubMed)
    commercial_orgs = [o for o in orgs if any(w in o["name"].lower() for w in ["proteogenex", "biomedica", "cro", "csd", "jlr", "medical gate"])]
    academic_orgs = [o for o in orgs if o not in commercial_orgs]
    if len(academic_orgs) >= len(commercial_orgs):
        disc = "medium — mix of academic and commercial sources"
    elif commercial_orgs:
        disc = "hard — mostly commercial biobanks, less PubMed presence"
    else:
        disc = "easy — academic sources discoverable through publications"

    # Biomarker specificity
    bm_req = bundle_def["parsed"].get("biomarkers_required", [])
    if not bm_req:
        bm_diff = "low — no specific biomarker filtering required"
    else:
        total_annotated = sum(
            sum(o.get("biomarkers", {}).get(bm, 0) for o in orgs)
            for bm in bm_req
        )
        if total_annotated > 100:
            bm_diff = f"medium — {', '.join(bm_req)} annotated in {total_annotated} specimens"
        elif total_annotated > 0:
            bm_diff = f"high — {', '.join(bm_req)} sparsely annotated ({total_annotated} specimens)"
        else:
            bm_diff = f"very high — {', '.join(bm_req)} not indexed in registry, needs retrospective testing"

    # Overall
    if data_avail == "none":
        difficulty = "impossible"
    elif data_avail == "low" or "very high" in bm_diff:
        difficulty = "hard"
    elif data_avail == "high" and "low" in bm_diff:
        difficulty = "easy"
    else:
        difficulty = "medium"

    # Expected failure modes
    failures = []
    if commercial_orgs:
        failures.append(f"May not find commercial biobanks ({', '.join(o['name'] for o in commercial_orgs[:3])}) through PubMed — they publish less than academic centers")
    if not bm_req:
        pass
    elif any("not indexed" in bm_diff for _ in [1]):
        failures.append(f"May overestimate {'/'.join(bm_req)} availability if system infers 'standard practice' instead of checking")
    if bundle_def["parsed"].get("matched_pairs"):
        failures.append("Matched pair discovery requires cross-referencing donor IDs — hard without registry access")
    if bundle_def["parsed"].get("treatment_status"):
        failures.append("Treatment-naive filtering depends on parsing free-text treatment fields — may miss nuance")
    if data_avail in ("low", "none"):
        failures.append("Thin data — system should honestly report scarcity, not hallucinate sources")
    failures.append("May find valid sources NOT in AminoChain (academic cohorts, biobanks) — these are correct finds, just unverifiable against this ground truth")

    return {
        "bundle_id": bundle_def["id"],
        "difficulty": difficulty,
        "factors": {
            "data_availability": data_avail,
            "org_discoverability": disc,
            "biomarker_specificity": bm_diff,
            "specimen_count": n_primary,
            "org_count": n_orgs,
        },
        "expected_failure_modes": failures,
    }


# ── main ───────────────────────────────────────────────────────────────────

def main():
    print("[bundles] loading specimens...")
    specimens = load_specimens()
    org_map = load_org_map()
    print(f"[bundles] {len(specimens)} specimens, {len(org_map)} organizations")

    index_entries = []

    for bdef in BUNDLE_DEFS:
        bid = bdef["id"]
        area = bdef["area"]
        out_dir = BUNDLES_DIR / area / bid
        out_dir.mkdir(parents=True, exist_ok=True)

        # query.json
        query = {
            "bundle_id": bid,
            "therapeutic_area": area,
            "query_text": bdef["query_text"],
            "intent": bdef["intent"],
            "parsed": bdef["parsed"],
        }
        with open(out_dir / "query.json", "w") as f:
            json.dump(query, f, indent=2)

        # ground_truth.json
        gt = build_ground_truth(bdef, specimens, org_map)
        with open(out_dir / "ground_truth.json", "w") as f:
            json.dump(gt, f, indent=2)

        # eval_criteria.json (replaces expected_outputs.json)
        ec = build_eval_criteria(bdef, gt)
        with open(out_dir / "eval_criteria.json", "w") as f:
            json.dump(ec, f, indent=2)

        # difficulty.json
        diff = build_difficulty(bdef, gt)
        with open(out_dir / "difficulty.json", "w") as f:
            json.dump(diff, f, indent=2)

        # Remove old expected_outputs.json if present
        old = out_dir / "expected_outputs.json"
        if old.exists():
            old.unlink()

        n_primary = gt["summary"]["total_primary_specimens"]
        n_orgs = len(gt["summary"]["organizations"])
        n_matched = gt["summary"]["matched_pair_donors"]
        print(f"  {area}/{bid}: {n_primary} specimens, {n_orgs} orgs, {diff['difficulty']} difficulty")

        index_entries.append({
            "bundle_id": bid,
            "area": area,
            "query_text": bdef["query_text"][:120],
            "intent": bdef["intent"],
            "difficulty": diff["difficulty"],
            "primary_specimens": n_primary,
            "organizations": n_orgs,
            "matched_pairs": n_matched,
            "path": f"{area}/{bid}",
        })

    # index.json
    index = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_bundles": len(index_entries),
        "bundles": index_entries,
    }
    with open(BUNDLES_DIR / "index.json", "w") as f:
        json.dump(index, f, indent=2)

    print(f"\n[bundles] {len(index_entries)} bundles generated → {BUNDLES_DIR}/")


if __name__ == "__main__":
    main()
