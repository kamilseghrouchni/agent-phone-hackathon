#!/usr/bin/env python3
"""
Map PMIDs to PMC IDs via NCBI elink API.

Usage:
  python3 pmid_to_pmc.py --pmids 36031893 38067107 40244264
  python3 pmid_to_pmc.py --pmids_file /path/to/pmids.txt

Output (stdout): JSON object mapping PMID -> PMCID or null
  {"36031893": "PMC9969834", "38067107": "PMC10705731", "40244264": null}
"""

import argparse
import json
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ELINK_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi"
BATCH_SIZE = 50  # NCBI recommends max 200, we stay conservative


def elink_batch(pmids: list[str]) -> dict[str, str | None]:
    """Call elink for a batch of PMIDs, return {pmid: pmcid_or_none}."""
    params = "&".join(
        ["dbfrom=pubmed", "db=pmc", "retmode=xml"]
        + [f"id={p}" for p in pmids]
    )
    url = f"{ELINK_URL}?{params}"
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "vcro-pipeline/1.0")

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()

    root = ET.fromstring(data)
    result = {p: None for p in pmids}

    for link_set in root.findall(".//LinkSet"):
        id_el = link_set.find("IdList/Id")
        if id_el is None:
            continue
        pmid = id_el.text.strip()

        for link in link_set.findall(".//LinkSetDb/Link/Id"):
            pmc_num = link.text.strip()
            result[pmid] = f"PMC{pmc_num}"
            break  # take first match

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pmids", nargs="+", default=[])
    parser.add_argument("--pmids_file", default=None,
                        help="File with one PMID per line")
    args = parser.parse_args()

    pmids = list(args.pmids)
    if args.pmids_file:
        with open(args.pmids_file) as f:
            for line in f:
                line = line.strip()
                if line and line.isdigit():
                    pmids.append(line)

    if not pmids:
        print("{}")
        return

    # Deduplicate
    pmids = list(dict.fromkeys(pmids))

    mapping = {}
    for i in range(0, len(pmids), BATCH_SIZE):
        batch = pmids[i:i + BATCH_SIZE]
        batch_result = elink_batch(batch)
        mapping.update(batch_result)
        if i + BATCH_SIZE < len(pmids):
            time.sleep(0.5)

    print(json.dumps(mapping, indent=2))


if __name__ == "__main__":
    main()
