#!/usr/bin/env python3
"""
Post-process data/platforms/*.jsonl: tag each entry as
  analytical_platform | pharma_sponsor | unknown

Pharma-sponsor heuristic combines:
  - membership in a known big-pharma set
  - name patterns ("Pharmaceuticals", "Pharma Inc")
  - role=collaborator on INTERVENTIONAL drug trials with no obs sponsorship

Writes:
  data/platforms/_all.jsonl       — all entries with `category` tag
  data/platforms/_summary.md      — analytical platforms only, grouped by assay
"""
import json
import os
import re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATFORM_DIR = os.path.join(ROOT, "data", "platforms")

# Well-known pharma / biotech drug developers (lowercase substring match)
BIG_PHARMA = {
    "merck sharp", "msd", "glaxosmithkline", "gsk", "pfizer", "wyeth",
    "novartis", "hoffmann-la roche", "roche pharmaceuticals", "genentech",
    "bristol-myers squibb", "astrazeneca", "sanofi", "boehringer ingelheim",
    "eli lilly", "lilly", "gilead", "regeneron", "amgen", "abbvie",
    "takeda", "biogen", "celgene", "vertex pharmaceuticals", "alexion",
    "astellas", "viiv healthcare", "tesaro", "otsuka", "alfasigma",
    "daiichi sankyo", "merck kgaa", "merck serono", "incyte",
    "bayer", "johnson & johnson", "janssen", "moderna", "biontech",
    "innovive pharmaceuticals", "comed", "a2 biotherapeutics",
    "shanghai unicar", "national cattlemen's beef",
    "independent research fund denmark", "aspen rhoads research foundation",
    "novo nordisk", "baxter", "zimmer biomet", "icell gene therapeutics",
    "xcovery holdings", "pdc biotech",
}

# Known analytical platforms / diagnostic services not captured by the regex.
KNOWN_PLATFORMS = {
    "adaptive biotechnologies", "sequenom", "caredx", "chronix biomedical",
    "inflammatix", "c2i genomics", "amwise diagnostics", "cota",
    "jaxbio", "sepul bio", "radialis",
}

# Hint that something is an analytical platform / diagnostic / lab service
PLATFORM_HINTS = re.compile(
    r"\b(genomics|diagnostics|genetics|biosciences|biotech|sequencing|"
    r"molecular|labs?|laboratory|technologies|sciences inc|biomed|"
    r"epigenetics|proteomics|metabolomics|nanostring|olink|tempus|"
    r"adaptive bio|guardant|veracyte|foundation medicine|caris|natera|"
    r"singlera|anchordx|burning rock|geneplus|geneseeq|origimed|"
    r"genecast|10x|illumina|standard biotools|fluidigm|akoya|lumiradx|"
    r"atlas biomed|pathoquest|onegevity|nimble science|nonagen|"
    r"rontis|molecular biometrics|hkgepitherapeutics|seqker|inti labs|"
    r"omicsway)\b",
    re.I,
)


def classify(name: str) -> str:
    n = name.strip().lower()
    if any(p in n for p in BIG_PHARMA):
        return "pharma_sponsor"
    if "pharmaceutical" in n or "pharma " in n or n.endswith(" pharma"):
        return "pharma_sponsor"
    if any(p in n for p in KNOWN_PLATFORMS):
        return "analytical_platform"
    if PLATFORM_HINTS.search(name):
        return "analytical_platform"
    return "unknown"


def main() -> None:
    all_path = os.path.join(PLATFORM_DIR, "_all.jsonl")
    summary_path = os.path.join(PLATFORM_DIR, "_summary.md")

    by_assay: dict[str, list[dict]] = defaultdict(list)
    counts = {"analytical_platform": 0, "pharma_sponsor": 0, "unknown": 0}

    with open(all_path, "w", encoding="utf-8") as out:
        for fn in sorted(os.listdir(PLATFORM_DIR)):
            if not fn.endswith(".jsonl") or fn.startswith("_"):
                continue
            with open(os.path.join(PLATFORM_DIR, fn), encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    rec = json.loads(line)
                    rec["category"] = classify(rec["name"])
                    counts[rec["category"]] += 1
                    by_assay[rec["assay"]].append(rec)
                    out.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # Markdown summary: analytical platforms only, grouped by assay
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("# Analytical Platforms by Assay\n\n")
        f.write("Discovered via ClinicalTrials.gov sponsor + collaborator analysis. "
                "Pharma drug sponsors filtered out.\n\n")
        f.write(f"**Totals across 30 assays:** "
                f"{counts['analytical_platform']} analytical platforms, "
                f"{counts['pharma_sponsor']} pharma sponsors (filtered), "
                f"{counts['unknown']} unclassified.\n\n")

        for assay in sorted(by_assay.keys()):
            recs = [r for r in by_assay[assay] if r["category"] == "analytical_platform"]
            recs.sort(key=lambda r: (-r["n_trials"], -r["total_enrollment"]))
            if not recs:
                continue
            f.write(f"## {assay}\n\n")
            f.write("| Platform | Country | Trials | Total N | Top trial |\n")
            f.write("|---|---|---:|---:|---|\n")
            for r in recs[:10]:
                country = ", ".join(r["countries"][:2]) or "—"
                top = max(r["evidence"], key=lambda e: e["n_enrolled"])
                f.write(f"| **{r['name']}** | {country} | "
                        f"{r['n_trials']} | {r['total_enrollment']} | "
                        f"{top['nct_id']} (n={top['n_enrolled']}) |\n")
            f.write("\n")

    print(f"Wrote {all_path}")
    print(f"Wrote {summary_path}")
    print(f"Categories: {counts}")


if __name__ == "__main__":
    main()
