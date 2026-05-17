#!/usr/bin/env python3
"""
vcro-cohort-map: ClinicalTrials.gov battery search

Usage:
  python3 search_clinicaltrials.py \
    --condition "Alzheimer disease" \
    --terms "metabolomics" "plasma biomarker" \
    [--top_n 10] \
    [--cache_dir /path/to/vcro-store]

Output (stdout): JSON list of top-scored observational studies with biospecimens.
If --cache_dir is provided, per-study meta and section text files are written
under:
  {cache_dir}/sources/clinicaltrials/NCTID/
"""

import argparse
import json
import os
import time
import urllib.parse
import urllib.request

BASE = "https://clinicaltrials.gov/api/v2/studies"
HEADERS = {"Accept": "application/json", "User-Agent": "vcro-hunt/1.0"}


def search(condition: str, term: str, page_size: int = 20) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "query.cond": condition,
            "query.term": term,
            "pageSize": page_size,
        }
    )
    req = urllib.request.Request(f"{BASE}?{params}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read()).get("studies", [])


def score_study(s: dict) -> tuple[int, int]:
    p = s.get("protocolSection", {})
    design = p.get("designModule", {})
    status = p.get("statusModule", {})
    sponsor = p.get("sponsorCollaboratorsModule", {})

    study_type = design.get("studyType", "")
    biospec = design.get("bioSpec", {})
    retention = biospec.get("retention", "")
    n = design.get("enrollmentInfo", {}).get("count", 0)
    try:
        n = int(n)
    except Exception:
        n = 0

    completion = status.get("completionDateStruct", {}).get("date", "")
    year = int(completion[:4]) if completion and len(completion) >= 4 else 0

    rp = sponsor.get("responsibleParty", {})
    pi = rp.get("investigatorFullName", "")
    collabs = sponsor.get("collaborators", [])

    score = 0
    if study_type == "OBSERVATIONAL":
        score += 4
    if retention and "NONE" not in retention:
        score += 3
    if n >= 100:
        score += 2
    if n >= 300:
        score += 3
    if year >= 2019:
        score += 2
    if year >= 2022:
        score += 1
    if pi:
        score += 1
    if len(collabs) >= 3:
        score += 1

    return score, n


def extract_study(s: dict) -> dict:
    p = s.get("protocolSection", {})
    ident = p.get("identificationModule", {})
    status = p.get("statusModule", {})
    design = p.get("designModule", {})
    outcomes = p.get("outcomesModule", {})
    contacts = p.get("contactsLocationsModule", {})
    sponsor = p.get("sponsorCollaboratorsModule", {})
    desc = p.get("descriptionModule", {})
    eligibility = p.get("eligibilityModule", {})

    biospec = design.get("bioSpec", {})
    rp = sponsor.get("responsibleParty", {})
    locs = contacts.get("locations", [])
    collabs = sponsor.get("collaborators", [])

    n = design.get("enrollmentInfo", {}).get("count", 0)
    try:
        n = int(n)
    except Exception:
        n = 0

    return {
        "nct_id": ident.get("nctId"),
        "title": ident.get("briefTitle", ""),
        "study_type": design.get("studyType", ""),
        "n_total": n,
        "completion_date": status.get("completionDateStruct", {}).get("date", ""),
        "biospecimen_retention": biospec.get("retention", ""),
        "biospecimen_description": biospec.get("description", "")[:200],
        "pi_name": rp.get("investigatorFullName", None),
        "pi_affiliation": rp.get("investigatorAffiliation", None),
        "lead_sponsor": sponsor.get("leadSponsor", {}).get("name", ""),
        "collaborators": [c.get("name", "") for c in collabs[:6]],
        "facilities": list(
            dict.fromkeys(
                [l.get("facility", "") for l in locs if l.get("facility")]
            )
        )[:6],
        "cities": list(
            dict.fromkeys([l.get("city", "") for l in locs if l.get("city")])
        )[:6],
        "countries": list(
            dict.fromkeys([l.get("country", "") for l in locs if l.get("country")])
        )[:4],
        "locations": [
            {"facility": l.get("facility", ""), "city": l.get("city", ""), "country": l.get("country", "")}
            for l in locs if l.get("facility")
        ][:10],
        "primary_outcomes": [
            o.get("measure", "") for o in outcomes.get("primaryOutcomes", [])[:4]
        ],
        "secondary_outcomes": [
            o.get("measure", "") for o in outcomes.get("secondaryOutcomes", [])[:4]
        ],
        "brief_summary": desc.get("briefSummary", "")[:400],
        "eligibility_criteria": eligibility.get("eligibilityCriteria", "")[:400],
        "source": "clinicaltrials",
    }


def write_meta_and_sections(cache_dir: str, studies: list[dict]) -> None:
    """Write meta.json and coarse section text files for each NCT.

    Layout:
      {cache_dir}/sources/clinicaltrials/NCTID/meta.json
      {cache_dir}/sources/clinicaltrials/NCTID/cohort.txt
      {cache_dir}/sources/clinicaltrials/NCTID/biospecimens.txt
      {cache_dir}/sources/clinicaltrials/NCTID/endpoints_and_modalities.txt
      {cache_dir}/sources/clinicaltrials/NCTID/access_and_ownership.txt
    """

    base = os.path.join(cache_dir, "sources", "clinicaltrials")
    os.makedirs(base, exist_ok=True)

    for study in studies:
        nct = study.get("nct_id")
        if not nct:
            continue
        sdir = os.path.join(base, nct)
        os.makedirs(sdir, exist_ok=True)

        # meta.json
        meta_path = os.path.join(sdir, "meta.json")
        if not os.path.exists(meta_path):
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(study, f, indent=2)

        # Simple text sections from available fields
        cohort_txt = []
        if study.get("brief_summary"):
            cohort_txt.append("BRIEF SUMMARY:\n" + study["brief_summary"])
        if study.get("eligibility_criteria"):
            cohort_txt.append("\nELIGIBILITY:\n" + study["eligibility_criteria"])
        if cohort_txt:
            with open(os.path.join(sdir, "cohort.txt"), "w", encoding="utf-8") as f:
                f.write("\n\n".join(cohort_txt))

        biospec_txt = []
        if study.get("biospecimen_retention") or study.get("biospecimen_description"):
            biospec_txt.append(
                f"RETENTION: {study.get('biospecimen_retention', '')}\n"
                f"DESCRIPTION: {study.get('biospecimen_description', '')}"
            )
        if biospec_txt:
            with open(
                os.path.join(sdir, "biospecimens.txt"), "w", encoding="utf-8"
            ) as f:
                f.write("\n".join(biospec_txt))

        endpoints_txt = []
        po = study.get("primary_outcomes", [])
        so = study.get("secondary_outcomes", [])
        if po or so:
            endpoints_txt.append("PRIMARY OUTCOMES:\n" + "; ".join(po))
            if so:
                endpoints_txt.append("\nSECONDARY OUTCOMES:\n" + "; ".join(so))
        if endpoints_txt:
            with open(
                os.path.join(sdir, "endpoints_and_modalities.txt"),
                "w",
                encoding="utf-8",
            ) as f:
                f.write("".join(endpoints_txt))

        access_txt = []
        if study.get("lead_sponsor"):
            access_txt.append(f"LEAD SPONSOR: {study['lead_sponsor']}")
        fac = study.get("facilities", [])
        if fac:
            access_txt.append("FACILITIES:\n" + "; ".join(fac))
        countries = study.get("countries", [])
        if countries:
            access_txt.append("COUNTRIES:\n" + ", ".join(countries))
        if access_txt:
            with open(
                os.path.join(sdir, "access_and_ownership.txt"),
                "w",
                encoding="utf-8",
            ) as f:
                f.write("\n".join(access_txt))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--condition", required=True)
    parser.add_argument("--terms", nargs="+", required=True)
    parser.add_argument("--top_n", type=int, default=10)
    parser.add_argument("--cache_dir", default=None)
    args = parser.parse_args()

    all_studies: dict[str, dict] = {}
    for term in args.terms:
        studies = search(args.condition, term)
        for s in studies:
            nct = (
                s.get("protocolSection", {})
                .get("identificationModule", {})
                .get("nctId")
            )
            if nct and nct not in all_studies:
                all_studies[nct] = s
        time.sleep(0.4)

    scored = [
        (score_study(s)[0], score_study(s)[1], nct, s)
        for nct, s in all_studies.items()
    ]
    scored.sort(key=lambda x: (-x[0], -x[1]))

    studies_structured = [extract_study(s) for _, _, _, s in scored[: args.top_n]]

    if args.cache_dir:
        try:
            write_meta_and_sections(args.cache_dir, studies_structured)
        except Exception as e:
            print(f"WARNING: failed to write ClinicalTrials cache: {e}", file=sys.stderr)

    print(json.dumps(studies_structured, indent=2))


if __name__ == "__main__":
    main()
