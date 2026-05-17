"""Hand-picked 6 demo queries with explicit roles. Each maps to a bundle so
publications + failure modes can be densely populated in the demo.

Output: data/enriched/curated_queries.json
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "enriched" / "curated_queries.json"


CURATED = [
    {
        "id": "melanoma-happy-path",
        "role": "happy-path",
        "label": "Melanoma FFPE + matched plasma",
        "text": "High-grade cutaneous melanoma FFPE with matched K2EDTA plasma at -80C, T4N0 or node-positive",
        "bundle_id": "melanoma-high-grade-tissue-k2edta-plasma",
        "expected_difficulty": "easy",
    },
    {
        "id": "lymphoma-rich-publications",
        "role": "rich-publications",
        "label": "Grade 3 follicular lymphoma + matched serum",
        "text": "Grade 3 follicular lymphoma FFPE with matched serum or plasma — need treatment-naive subset",
        "bundle_id": "lymphoma-ffpe-grade3-serum-matched",
        "expected_difficulty": "medium",
    },
    {
        "id": "lung-scc-source-wider",
        "role": "thin-result",
        "label": "Lung SCC liquid biopsy in Streck BCT",
        "text": "Lung squamous cell carcinoma liquid biopsy specimens collected in Streck BCT tubes",
        "bundle_id": "lung-scc-streck-bct-liquid-biopsy",
        "expected_difficulty": "impossible",
    },
    {
        "id": "tnbc-multi-gap",
        "role": "multi-gap",
        "label": "Triple-negative breast cancer FFPE",
        "text": "Triple-negative breast cancer FFPE — must be ER-negative AND PR-negative confirmed by IHC, grade 3+ invasive ductal",
        "bundle_id": "tnbc-er-neg-pr-neg-ffpe",
        "expected_difficulty": "hard",
    },
    {
        "id": "pd-longitudinal",
        "role": "longitudinal",
        "label": "Parkinson's longitudinal serum + PBMC",
        "text": "Parkinson's patients age 75+ with serum and PBMC across multiple visits",
        "bundle_id": "pd-age-over-75-serum-pbmc-dna",
        "expected_difficulty": "medium",
    },
    {
        "id": "breast-idc-compare",
        "role": "follow-up-to-compare",
        "label": "Breast IDC FFPE with full panel",
        "text": "Breast invasive ductal carcinoma FFPE with HER2 + ER + PR + Ki67 panel documented",
        "bundle_id": "breast-idc-her2-er-pr-ki67-full-panel",
        "expected_difficulty": "medium",
    },
]


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(CURATED, indent=2))
    print(f"curated_queries.json: {len(CURATED)} queries")


if __name__ == "__main__":
    main()
