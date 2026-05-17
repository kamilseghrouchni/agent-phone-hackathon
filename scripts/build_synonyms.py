"""Hand-curated synonym map covering the 23 bundles' indication / specimen /
anatomy / treatment vocab. Living document — extend as queries surface gaps.

Output: data/enriched/synonyms.json
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "enriched" / "synonyms.json"


# Each entry: aliases (lowercased) -> canonical form (matches DB / bundle vocab)
SYNONYMS = {
    # ----- Indications: cancers
    "indication": {
        "mm": "multiple myeloma",
        "multiple myeloma": "multiple myeloma",
        "tnbc": "triple-negative breast cancer",
        "triple negative breast cancer": "triple-negative breast cancer",
        "triple-negative breast cancer": "triple-negative breast cancer",
        "idc": "invasive ductal carcinoma",
        "invasive ductal carcinoma": "invasive ductal carcinoma",
        "dcis": "ductal carcinoma in situ",
        "her2+ breast": "her2-positive breast cancer",
        "her2-positive breast cancer": "her2-positive breast cancer",
        "nsclc": "non-small cell lung cancer",
        "non-small cell lung cancer": "non-small cell lung cancer",
        "lung scc": "lung squamous cell carcinoma",
        "lung squamous cell carcinoma": "lung squamous cell carcinoma",
        "lung adenocarcinoma": "lung adenocarcinoma",
        "luad": "lung adenocarcinoma",
        "crc": "colorectal cancer",
        "colorectal cancer": "colorectal cancer",
        "colorectal adenocarcinoma": "colorectal adenocarcinoma",
        "hcc": "hepatocellular carcinoma",
        "hepatocellular carcinoma": "hepatocellular carcinoma",
        "pancreatic cancer": "pancreatic ductal adenocarcinoma",
        "pdac": "pancreatic ductal adenocarcinoma",
        "pancreatic ductal adenocarcinoma": "pancreatic ductal adenocarcinoma",
        "esophageal cancer": "esophageal cancer",
        "escc": "esophageal squamous cell carcinoma",
        "esophageal squamous cell carcinoma": "esophageal squamous cell carcinoma",
        "eac": "esophageal adenocarcinoma",
        "esophageal adenocarcinoma": "esophageal adenocarcinoma",
        "bladder cancer": "bladder cancer",
        "muscle-invasive bladder cancer": "muscle-invasive bladder cancer",
        "melanoma": "melanoma",
        "cutaneous melanoma": "cutaneous melanoma",
        "ovarian cancer": "ovarian cancer",
        "cervical cancer": "cervical cancer",
        "endometrial cancer": "endometrial cancer",
        "uterine cancer": "uterine cancer",
        "thyroid cancer": "thyroid cancer",
        "cholangiocarcinoma": "cholangiocarcinoma",
        "glioblastoma": "glioblastoma",
        "gbm": "glioblastoma",
        "lymphoma": "lymphoma",
        "follicular lymphoma": "follicular lymphoma",
        "fl": "follicular lymphoma",
        "dlbcl": "diffuse large b-cell lymphoma",
        "diffuse large b-cell lymphoma": "diffuse large b-cell lymphoma",
        "prostate cancer": "prostate cancer",
        "acinar prostate cancer": "acinar prostate adenocarcinoma",
        "breast cancer": "breast cancer",
        # ----- Indications: neuro
        "ad": "alzheimer's disease",
        "alzheimer's": "alzheimer's disease",
        "alzheimer's disease": "alzheimer's disease",
        "pd": "parkinson's disease",
        "parkinson's": "parkinson's disease",
        "parkinson's disease": "parkinson's disease",
        "ms": "multiple sclerosis",
        "multiple sclerosis": "multiple sclerosis",
        "als": "amyotrophic lateral sclerosis",
        "amyotrophic lateral sclerosis": "amyotrophic lateral sclerosis",
        # ----- Cardio / metabolic / immuno / infectious / respiratory
        "chf": "congestive heart failure",
        "congestive heart failure": "congestive heart failure",
        "atherosclerosis": "atherosclerosis",
        "diabetes": "diabetes",
        "t2d": "type 2 diabetes",
        "type 2 diabetes": "type 2 diabetes",
        "copd": "chronic obstructive pulmonary disease",
        "chronic obstructive pulmonary disease": "chronic obstructive pulmonary disease",
        "asthma": "asthma",
        "covid": "covid-19",
        "covid-19": "covid-19",
        "sars-cov-2": "covid-19",
        "hiv": "hiv",
    },
    # ----- Specimen types (DB canonical names)
    "specimen_type": {
        # FFPE / fixed / frozen tissue all collapse to the DB enum "Tissue".
        # The fix/fresh/frozen distinction lives on the `preservation` field.
        "ffpe": "Tissue",
        "ffpe tissue": "Tissue",
        "fixed tissue": "Tissue",
        "frozen tissue": "Tissue",
        "tissue (ffpe)": "Tissue",
        "tissue": "Tissue",
        "plasma": "Plasma",
        "serum": "Serum",
        "k2edta plasma": "Plasma",
        "edta plasma": "Plasma",
        "buffy coat": "Buffy coat",
        "pbmc": "Peripheral blood mononuclear cells (PBMCs)",
        "pbmcs": "Peripheral blood mononuclear cells (PBMCs)",
        "bmmc": "Bone marrow mononuclear cells (BMMCs)",
        "bmmcs": "Bone marrow mononuclear cells (BMMCs)",
        "bone marrow": "Bone marrow mononuclear cells (BMMCs)",
        "csf": "Cerebrospinal fluid (CSF)",
        "cerebrospinal fluid": "Cerebrospinal fluid (CSF)",
        "whole blood": "Whole blood",
        "blood": "Whole blood",
        "urine": "Urine",
        "dna": "DNA",
        "rna": "RNA",
        "ipsc": "Induced pluripotent stem cells (iPSCs)",
        "ipscs": "Induced pluripotent stem cells (iPSCs)",
        "saliva": "Saliva",
        "nasal swab": "Nasal secretions",
    },
    # ----- Anatomy (raw_anatomy / source_site values)
    "anatomy": {
        "breast": "breast",
        "lung": "lung",
        "colon": "colon",
        "liver": "liver",
        "pancreas": "pancreas",
        "esophagus": "esophagus",
        "bladder": "bladder",
        "skin": "skin",
        "ovary": "ovary",
        "cervix": "cervix",
        "endometrium": "endometrium",
        "thyroid": "thyroid",
        "bile duct": "bile duct",
        "brain": "brain",
        "lymph node": "lymph node",
        "prostate": "prostate",
        "bone marrow": "bone marrow",
    },
    # ----- Preservation
    "preservation": {
        "ffpe": "Fixed",
        "fixed": "Fixed",
        "fresh frozen": "Frozen",
        "frozen": "Frozen",
        "fresh": "Fresh",
        "viable": "Fresh",
        "-80c": "Frozen",
        "-80": "Frozen",
        "ln2": "Frozen",
    },
    # ----- Treatment status
    "treatment_status": {
        "treatment-naive": "naive",
        "treatment naive": "naive",
        "naive": "naive",
        "untreated": "naive",
        "pre-treatment": "naive",
        "post-treatment": "post",
        "post treatment": "post",
        "any": "any",
    },
    # ----- Country aliases (ISO-ish)
    "country": {
        "usa": "USA",
        "us": "USA",
        "united states": "USA",
        "uk": "GBR",
        "united kingdom": "GBR",
        "france": "FRA",
        "germany": "DEU",
        "ukraine": "UKR",
        "china": "CHN",
        "japan": "JPN",
    },
}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(SYNONYMS, indent=2))
    total = sum(len(v) for v in SYNONYMS.values())
    print(f"synonyms.json: {total} entries across {len(SYNONYMS)} fields")


if __name__ == "__main__":
    main()
