#!/usr/bin/env python3
"""
vcro-cohort-map: Europe PMC parallel search (indexes preprints)

Usage:
  python3 search_europepmc.py \
    --queries "query1" "query2" \
    [--page_size 15] \
    [--cache_dir /path/to/vcro-store]

CRITICAL: queries must be plain space-separated strings — NO AND/OR/field tags.

Output (stdout): JSON list of results including preprints.
If --cache_dir is provided, meta.json files are written for any items with a
PMCID that do not already have meta from PubMed under:
  {cache_dir}/sources/pmc/PMC{pmcid}/meta.json
"""

import argparse
import json
import os
import time
import urllib.parse
import urllib.request

BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest"
HEADERS = {"User-Agent": "vcro-hunt/1.0"}


def search(query: str, page_size: int = 15) -> list[dict]:
    params = urllib.parse.urlencode({"query": query, "format": "json", "pageSize": page_size})
    url = f"{BASE}/search?{params}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    return data.get("resultList", {}).get("result", [])


def write_meta_cache(cache_dir: str, records: list[dict]) -> None:
    """Write meta.json files for any records with a PMCID, without overwriting.

    Layout: {cache_dir}/sources/pmc/PMC{pmcid}/meta.json
    """

    base = os.path.join(cache_dir, "sources", "pmc")
    for rec in records:
        pmcid = rec.get("pmcid")
        if not pmcid:
            continue
        pmc_dir = os.path.join(base, pmcid)
        os.makedirs(pmc_dir, exist_ok=True)
        meta_path = os.path.join(pmc_dir, "meta.json")
        if os.path.exists(meta_path):
            continue
        meta = {
            "pmid": rec.get("pmid"),
            "doi": rec.get("doi"),
            "title": rec.get("title"),
            "journal": rec.get("journal"),
            "year": rec.get("year"),
            "first_author": rec.get("first_author"),
            "author_string": rec.get("author_string"),
            "pmc_id": pmcid.replace("PMC", ""),
            "source": "europepmc",
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queries", nargs="+", required=True)
    parser.add_argument("--page_size", type=int, default=15)
    parser.add_argument("--cache_dir", default=None)
    args = parser.parse_args()

    seen_ids: set[str] = set()
    results: list[dict] = []

    for q in args.queries:
        items = search(q, args.page_size)
        for item in items:
            source = item.get("source", "")
            if source in ("PAT", "CTX"):
                continue
            pmid = item.get("pmid", "")
            doi = item.get("doi", "")
            uid = pmid or doi
            if uid and uid in seen_ids:
                continue
            if uid:
                seen_ids.add(uid)
            # Extract first author from authorString ("Smith J, Doe A, ...")
            author_string = item.get("authorString", "")
            first_author = None
            if author_string:
                first_part = author_string.split(",")[0].strip().rstrip(".")
                if first_part:
                    first_author = first_part

            results.append(
                {
                    "pmid": pmid or None,
                    "doi": doi,
                    "title": item.get("title", ""),
                    "year": item.get("pubYear", ""),
                    "journal": item.get("journalTitle", ""),
                    "cited_by": item.get("citedByCount", 0),
                    "is_preprint": source == "PPR",
                    "has_fulltext": item.get("inEPMC", "N") == "Y",
                    "pmcid": item.get("pmcid", ""),
                    "first_author": first_author,
                    "author_string": author_string,
                    "source": "europepmc",
                }
            )
        time.sleep(0.3)

    if args.cache_dir:
        try:
            write_meta_cache(args.cache_dir, results)
        except Exception as e:
            # Cache errors should not change stdout behaviour
            print(f"WARNING: failed to write Europe PMC cache: {e}", file=sys.stderr)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
