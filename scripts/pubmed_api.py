#!/usr/bin/env python3
"""
vcro-cohort-map: PubMed adaptive search

Usage:
  python3 search_pubmed.py \
    --queries "query1" "query2" \
    --retmax 15 \
    [--date_filter 2024:2026] \
    [--cache_dir /path/to/vcro-store]

Output (stdout): JSON list of unique PMIDs with summary metadata.
If --cache_dir is provided, meta.json files are also written under:
  {cache_dir}/sources/pmc/PMC{pmc_id}/meta.json
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
HEADERS = {"User-Agent": "vcro-hunt/1.0"}


def search(query: str, retmax: int = 15, date_filter: str | None = None) -> list[str]:
    term = query
    if date_filter:
        term += f" AND {date_filter}[pdat]"
    params = urllib.parse.urlencode(
        {
            "db": "pubmed",
            "term": term,
            "retmax": retmax,
            "retmode": "json",
            "sort": "relevance",
        }
    )
    req = urllib.request.Request(f"{BASE}/esearch.fcgi?{params}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read()).get("esearchresult", {}).get("idlist", [])


def fetch_summaries(pmids: list[str]) -> dict:
    if not pmids:
        return {}
    params = urllib.parse.urlencode(
        {"db": "pubmed", "id": ",".join(pmids[: 50]), "retmode": "json"}
    )
    req = urllib.request.Request(f"{BASE}/esummary.fcgi?{params}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("result", {})


def get_pmc_id(info: dict) -> str | None:
    for art_id in info.get("articleids", []):
        if art_id.get("idtype") == "pmc":
            return art_id.get("value", "").replace("PMC", "").strip()
    return None


def get_doi(info: dict) -> str | None:
    for art_id in info.get("articleids", []):
        if art_id.get("idtype") == "doi":
            return art_id.get("value", "")
    return None


def write_meta_cache(cache_dir: str, records: list[dict]) -> None:
    """Write meta.json files for any records with a PMC ID.

    Layout: {cache_dir}/sources/pmc/PMC{pmc_id}/meta.json
    """

    base = os.path.join(cache_dir, "sources", "pmc")
    for rec in records:
        pmc_id = rec.get("pmc_id")
        if not pmc_id:
            continue
        pmc_dir = os.path.join(base, f"PMC{pmc_id}")
        os.makedirs(pmc_dir, exist_ok=True)
        meta_path = os.path.join(pmc_dir, "meta.json")

        meta = {
            "pmid": rec.get("pmid"),
            "doi": rec.get("doi"),
            "title": rec.get("title"),
            "journal": rec.get("journal"),
            "year": rec.get("year"),
            "first_author": rec.get("first_author"),
            "pmc_id": rec.get("pmc_id"),
            "source": "pubmed",
        }

        # Do not overwrite existing meta if present; future sources (Europe PMC)
        # can complement it.
        if not os.path.exists(meta_path):
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queries", nargs="+", required=True)
    parser.add_argument("--retmax", type=int, default=15)
    parser.add_argument("--date_filter", default=None)
    parser.add_argument("--cache_dir", default=None)
    args = parser.parse_args()

    all_pmids: set[str] = set()
    for q in args.queries:
        pmids = search(q, args.retmax, args.date_filter)
        all_pmids.update(pmids)
        time.sleep(0.35)

    summaries = fetch_summaries(list(all_pmids))
    results: list[dict] = []
    for pmid in all_pmids:
        info = summaries.get(pmid, {})
        if not info or pmid == "uids":
            continue
        authors = info.get("authors", [])
        record = {
            "pmid": pmid,
            "title": info.get("title", ""),
            "first_author": authors[0].get("name", "") if authors else "",
            "year": info.get("pubdate", "")[:4],
            "journal": info.get("fulljournalname", info.get("source", "")),
            "pmc_id": get_pmc_id(info),
            "doi": get_doi(info),
            "source": "pubmed",
        }
        results.append(record)

    # Optional cache write
    if args.cache_dir:
        try:
            write_meta_cache(args.cache_dir, results)
        except Exception as e:  # cache errors should not break stdout behaviour
            print(f"WARNING: failed to write cache: {e}", file=sys.stderr)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
