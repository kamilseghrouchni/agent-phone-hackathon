"""Flatten the 23 bundles' academic_ground_truth.json into a single
publication corpus tagged for fuzzy lookup.

Output: data/enriched/publications.json
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLES = ROOT / "data" / "bundles"
OUT = ROOT / "data" / "enriched" / "publications.json"


def tags_from_query(parsed: dict) -> dict:
    return {
        "indication": [s.lower() for s in (parsed.get("indication") or [])],
        "specimen_types": [s.lower() for s in (parsed.get("specimen_types") or [])],
        "preservation": (parsed.get("preservation") or "").lower(),
        "matched_pairs": bool(parsed.get("matched_pairs")),
    }


def main():
    pubs = []
    for agt_path in BUNDLES.rglob("academic_ground_truth.json"):
        bundle_dir = agt_path.parent
        query_path = bundle_dir / "query.json"
        if not query_path.exists():
            continue
        query = json.loads(query_path.read_text())
        agt = json.loads(agt_path.read_text())
        tags = tags_from_query(query.get("parsed", {}))

        for paper in agt.get("papers", []):
            pubs.append({
                "pmid": paper.get("pmid"),
                "pmc_id": paper.get("pmc_id"),
                "doi": paper.get("doi"),
                "title": paper.get("title"),
                "year": paper.get("year"),
                "journal": paper.get("journal"),
                "institution": paper.get("institution"),
                "institution_type": paper.get("institution_type"),
                "specimens_described": paper.get("specimens_described"),
                "access_route": paper.get("access_route"),
                "contact_extractable": paper.get("contact_extractable"),
                "depth_confidence": paper.get("depth_confidence"),
                "notes": paper.get("notes"),
                "_bundle_id": query.get("bundle_id"),
                "_tags": tags,
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(pubs, indent=2))
    print(f"publications.json: {len(pubs)} papers across "
          f"{len({p['_bundle_id'] for p in pubs})} bundles")


if __name__ == "__main__":
    main()
