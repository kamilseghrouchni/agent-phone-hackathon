"""Enrich org metadata: join org_profiles.json against DB org UUIDs.

Output: data/enriched/orgs.json keyed by organization_id.
"""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "specimens.db"
PROFILES = ROOT / "data" / "subset" / "org_profiles.json"
OUT = ROOT / "data" / "enriched" / "orgs.json"


def main():
    profiles = json.loads(PROFILES.read_text())["organizations"]
    by_id = {o["id"]: o for o in profiles}

    con = sqlite3.connect(DB)
    db_org_ids = {row[0] for row in con.execute(
        "SELECT DISTINCT organization_id FROM specimens WHERE organization_id IS NOT NULL"
    )}

    # Per-org counts for sanity badges later
    counts = {row[0]: row[1] for row in con.execute(
        "SELECT organization_id, COUNT(*) FROM specimens "
        "WHERE organization_id IS NOT NULL GROUP BY organization_id"
    )}
    con.close()

    out = {}
    for org_id in db_org_ids:
        p = by_id.get(org_id)
        out[org_id] = {
            "organization_id": org_id,
            "name": p["name"] if p else f"Unknown ({org_id[:8]})",
            "contact_email": (p or {}).get("contactEmail") or None,
            "website": (p or {}).get("websiteUrl") or None,
            "address": (p or {}).get("address") or None,
            "description": (p or {}).get("description") or None,
            "specimen_count": counts.get(org_id, 0),
            "in_profiles": p is not None,
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))

    matched = sum(1 for v in out.values() if v["in_profiles"])
    print(f"orgs.json: {len(out)} DB orgs, {matched} matched in profiles, "
          f"{len(out) - matched} unknown")


if __name__ == "__main__":
    main()
