#!/usr/bin/env python3
"""
Sweep assay catalog → discover analytical platforms via ClinicalTrials.gov.

For each row in data/assay_catalog.tsv, query CT.gov for trials whose
intervention matches `specific_assay`, then extract:
  - INDUSTRY lead sponsors (the platform itself)
  - INDUSTRY collaborators (when sponsor is academic)

Writes per-assay JSONL to data/platforms/<slug>.jsonl
Plus aggregated data/platforms/_index.json
"""

import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

BASE = "https://clinicaltrials.gov/api/v2/studies"
HEADERS = {"Accept": "application/json", "User-Agent": "vcro-platform-discovery/1.0"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "assay_catalog.tsv")
OUT_DIR = os.path.join(ROOT, "data", "platforms")

# When the catalog's specific_assay name doesn't match how trials describe
# the intervention, fall back to these search aliases.
ALIASES: dict[str, list[str]] = {
    "Methylation array (EPIC)": ["DNA methylation profiling", "EPIC array", "Infinium MethylationEPIC"],
    "Whole genome bisulfite sequencing (WGBS)": ["bisulfite sequencing", "WGBS"],
    "ATAC-seq": ["ATAC-seq", "chromatin accessibility"],
    "Targeted RNA panel (nCounter)": ["NanoString", "nCounter"],
    "LC-MS/MS proteomics (DIA/TMT)": ["mass spectrometry proteomics", "proteomics"],
    "Olink (PEA panels)": ["Olink"],
    "SomaScan (aptamer)": ["SomaScan", "SOMAscan"],
    "Mass cytometry (CyTOF)": ["mass cytometry", "CyTOF"],
    "Untargeted LC-MS metabolomics": ["metabolomics"],
    "Shotgun metagenomics": ["shotgun metagenomic", "metagenomic sequencing"],
    "SNP genotyping array": ["genotyping array", "GWAS array"],
    "T-cell receptor sequencing": ["TCR sequencing", "ImmunoSEQ", "clonoSEQ"],
    "Multiplex immunofluorescence": ["multiplex immunofluorescence", "PhenoCycler", "CODEX multiplex"],
    "Imaging mass cytometry": ["imaging mass cytometry", "Hyperion"],
}


def slugify(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower())
    s = re.sub(r"[\s-]+", "_", s).strip("_")
    return s[:60]


def fetch(intervention: str, page_size: int = 50) -> list[dict]:
    """Query CT.gov by intervention term. Returns studies list."""
    params = urllib.parse.urlencode({
        "query.intr": intervention,
        "pageSize": page_size,
    })
    url = f"{BASE}?{params}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read()).get("studies", [])
    except Exception as e:
        print(f"  ! fetch failed for {intervention!r}: {e}", file=sys.stderr)
        return []


def extract_platforms(studies: list[dict], assay: str) -> list[dict]:
    """Pull industry sponsors (observational trials only) and industry collaborators.

    Heuristic for filtering noise:
      - INTERVENTIONAL drug trials often have pharma as sponsor and use the
        assay only as a biomarker readout — not analytical platforms.
      - OBSERVATIONAL trials with industry sponsor → that sponsor is almost
        always the analytical platform (they built the assay being studied).
      - Industry collaborators in either trial type are good candidates.
    """
    platforms: dict[str, dict] = {}

    for s in studies:
        p = s.get("protocolSection", {})
        ident = p.get("identificationModule", {})
        sponsor_mod = p.get("sponsorCollaboratorsModule", {})
        design = p.get("designModule", {})
        contacts = p.get("contactsLocationsModule", {})
        status = p.get("statusModule", {})

        nct = ident.get("nctId", "")
        title = ident.get("briefTitle", "")
        n = design.get("enrollmentInfo", {}).get("count", 0)
        try:
            n = int(n)
        except Exception:
            n = 0
        overall_status = status.get("overallStatus", "")
        study_type = design.get("studyType", "")

        lead = sponsor_mod.get("leadSponsor", {}) or {}
        lead_name = lead.get("name", "")
        lead_class = lead.get("class", "")
        collabs = sponsor_mod.get("collaborators", []) or []

        locs = contacts.get("locations", []) or []
        countries = sorted({l.get("country", "") for l in locs if l.get("country")})

        # Lead sponsor as platform — only when OBSERVATIONAL (drops pharma drug trials)
        if lead_class == "INDUSTRY" and lead_name and study_type == "OBSERVATIONAL":
            key = lead_name.strip().lower()
            entry = platforms.setdefault(key, {
                "name": lead_name.strip(),
                "role": "sponsor",
                "class": lead_class,
                "evidence": [],
                "countries": set(),
            })
            entry["evidence"].append({
                "nct_id": nct,
                "title": title[:120],
                "n_enrolled": n,
                "status": overall_status,
                "study_type": study_type,
                "role": "sponsor",
            })
            entry["countries"].update(countries)

        # Industry collaborators — any trial type
        for c in collabs:
            name = (c.get("name") or "").strip()
            cclass = c.get("class", "")
            if not name or cclass != "INDUSTRY":
                continue
            key = name.lower()
            entry = platforms.setdefault(key, {
                "name": name,
                "role": "collaborator",
                "class": cclass,
                "evidence": [],
                "countries": set(),
            })
            entry["evidence"].append({
                "nct_id": nct,
                "title": title[:120],
                "n_enrolled": n,
                "status": overall_status,
                "study_type": study_type,
                "role": "collaborator",
            })
            entry["countries"].update(countries)

    out = []
    for k, v in platforms.items():
        v["countries"] = sorted(v["countries"])
        v["n_trials"] = len(v["evidence"])
        v["total_enrollment"] = sum(e["n_enrolled"] for e in v["evidence"])
        v["assay"] = assay
        out.append(v)
    out.sort(key=lambda x: (-x["n_trials"], -x["total_enrollment"]))
    return out


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    rows = []
    with open(CATALOG, encoding="utf-8") as f:
        rd = csv.DictReader(f, delimiter="\t")
        for r in rd:
            rows.append(r)

    print(f"Loaded {len(rows)} assays from catalog", file=sys.stderr)

    index = []
    seen_total = 0
    for i, r in enumerate(rows, 1):
        assay = r["specific_assay"]
        family = r["assay_family"]
        slug = slugify(assay)
        print(f"[{i}/{len(rows)}] {assay}", file=sys.stderr)

        # Try the formal name first, then aliases until we get hits
        queries = [assay] + ALIASES.get(assay, [])
        all_studies: list[dict] = []
        seen_ncts: set[str] = set()
        for q in queries:
            studies = fetch(q)
            for st in studies:
                nct = st.get("protocolSection", {}).get("identificationModule", {}).get("nctId", "")
                if nct and nct not in seen_ncts:
                    seen_ncts.add(nct)
                    all_studies.append(st)
            time.sleep(0.3)
            if len(all_studies) >= 50:
                break
        studies = all_studies
        platforms = extract_platforms(studies, assay)

        out_path = os.path.join(OUT_DIR, f"{slug}.jsonl")
        with open(out_path, "w", encoding="utf-8") as f:
            for p in platforms:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")

        index.append({
            "assay_family": family,
            "specific_assay": assay,
            "slug": slug,
            "n_trials_found": len(studies),
            "n_industry_platforms": len(platforms),
            "platforms_file": f"platforms/{slug}.jsonl",
            "top_platforms": [p["name"] for p in platforms[:5]],
        })
        seen_total += len(platforms)
        print(f"  → {len(studies)} trials, {len(platforms)} industry platforms", file=sys.stderr)

        # Be polite to CT.gov
        time.sleep(0.5)

    with open(os.path.join(OUT_DIR, "_index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)

    print(f"\nDone. {seen_total} platforms across {len(rows)} assays.", file=sys.stderr)
    print(f"Index: data/platforms/_index.json", file=sys.stderr)


if __name__ == "__main__":
    main()
