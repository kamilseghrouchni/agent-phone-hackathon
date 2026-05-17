#!/usr/bin/env python3
"""
Fetch PMC XML and materialise high-value sections into vcro-store.

Usage:
  python3 fetch_pmc_sections.py \
    --pmc_ids PMC1234567 PMC7654321 \
    --cache_dir /path/to/vcro-store

This script:
- Fetches PMC XML via NCBI eutils
- Walks <sec> elements and routes them into semantic section files:
  cohort.txt, biospecimens.txt, endpoints_and_modalities.txt,
  access_and_ownership.txt, results_primary.txt, limitations_and_conclusion.txt

It is intentionally conservative and best-effort: if parsing fails, it logs
warnings and continues. It never overwrites existing section files.
"""

import argparse
import os
import sys
import textwrap
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
HEADERS = {"User-Agent": "vcro-hunt/1.0"}


def fetch_pmc_xml(pmc_id: str) -> str:
    clean = pmc_id.replace("PMC", "").strip()
    url = f"{BASE}/efetch.fcgi?db=pmc&id={clean}&rettype=xml&retmode=xml"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", errors="replace")


def classify_section(title: str | None, text: str) -> set[str]:
    """Return a set of section types this block belongs to.

    section_type in {
      cohort, biospecimens, endpoints_and_modalities,
      access_and_ownership, results_primary, limitations_and_conclusion
    }
    """

    title_l = (title or "").lower()
    text_l = text.lower()
    types: set[str] = set()

    # Cohort / participants
    if any(k in title_l for k in ["patients", "participants", "subjects", "cohort", "study population", "sample", "population"]):
        types.add("cohort")
    elif "we included" in text_l or "we enrolled" in text_l or "participants were" in text_l:
        types.add("cohort")

    # Biospecimens
    if any(k in title_l for k in ["sample", "specimen", "biospecimen", "biological", "blood", "serum", "plasma", "csf", "cerebrospinal"]):
        types.add("biospecimens")
    elif any(k in text_l for k in ["plasma", "serum", "cerebrospinal", "csf", "blood sample", "stored at -80"]):
        types.add("biospecimens")

    # Endpoints and modalities
    if any(k in title_l for k in ["outcome", "assessment", "endpoint", "cognitive", "biomarker", "measures"]):
        types.add("endpoints_and_modalities")
    elif any(k in text_l for k in ["mmse", "cdr", "adas-cog", "ptau", "p-tau", "amyloid", "abeta", "nfl", "neurofilament", "mri", "pet"]):
        types.add("endpoints_and_modalities")

    # Access / ownership / ethics
    if any(k in title_l for k in ["ethics", "data availability", "data sharing", "funding"]):
        types.add("access_and_ownership")
    elif any(k in text_l for k in ["data are available", "data availability", "upon reasonable request", "data sharing", "consortium", "biobank", "data use agreement"]):
        types.add("access_and_ownership")

    # Results
    if any(k in title_l for k in ["results", "findings"]):
        types.add("results_primary")

    # Limitations / conclusions
    if any(k in title_l for k in ["discussion", "conclusion", "limitations"]):
        types.add("limitations_and_conclusion")
    elif "limitation" in text_l or "limitations" in text_l:
        types.add("limitations_and_conclusion")

    return types


def write_sections(cache_dir: str, pmc_id: str, xml_str: str) -> None:
    pmc_dir = os.path.join(cache_dir, "sources", "pmc", pmc_id)
    os.makedirs(pmc_dir, exist_ok=True)

    sections: dict[str, list[str]] = {
        "cohort": [],
        "biospecimens": [],
        "endpoints_and_modalities": [],
        "access_and_ownership": [],
        "results_primary": [],
        "limitations_and_conclusion": [],
    }

    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError as e:
        print(f"WARN: PMC {pmc_id}: XML parse error: {e}", file=sys.stderr)
        return

    # Walk all <sec> blocks
    for sec in root.iter("sec"):
        title_elem = sec.find("title")
        title = title_elem.text.strip() if title_elem is not None and title_elem.text else None
        text = " ".join(sec.itertext()).strip()
        if not text:
            continue
        stypes = classify_section(title, text)
        if not stypes:
            continue
        block = []
        if title:
            block.append(f"### {title}\n")
        block.append(textwrap.fill(text, width=100))
        block_text = "\n\n".join(block)
        for st in stypes:
            sections[st].append(block_text)

    # Write files only if they do not already exist
    mapping = {
        "cohort": "cohort.txt",
        "biospecimens": "biospecimens.txt",
        "endpoints_and_modalities": "endpoints_and_modalities.txt",
        "access_and_ownership": "access_and_ownership.txt",
        "results_primary": "results_primary.txt",
        "limitations_and_conclusion": "limitations_and_conclusion.txt",
    }
    for st, filename in mapping.items():
        path = os.path.join(pmc_dir, filename)
        if os.path.exists(path):
            continue
        if sections[st]:
            with open(path, "w", encoding="utf-8") as f:
                f.write("\n\n\n".join(sections[st]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pmc_ids", nargs="+", required=True)
    parser.add_argument("--cache_dir", required=True)
    args = parser.parse_args()

    for pmc in args.pmc_ids:
        pmc_norm = pmc
        if not pmc_norm.upper().startswith("PMC"):
            pmc_norm = "PMC" + pmc_norm
        try:
            xml_str = fetch_pmc_xml(pmc_norm)
            if len(xml_str) < 500:
                print(f"WARN: PMC {pmc_norm}: very short XML, skipping", file=sys.stderr)
                continue
            write_sections(args.cache_dir, pmc_norm, xml_str)
        except Exception as e:
            print(f"WARN: PMC {pmc_norm}: fetch or write failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
