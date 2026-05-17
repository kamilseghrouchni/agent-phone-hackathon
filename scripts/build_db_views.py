"""Build a side database with FTS5 + materialized views for fast search.

Output: data/enriched/views.db
- specimens_fts (FTS5 over unstructured fields + diagnoses)
- donor_longitudinal (donor_id, n_collections, n_distinct_years,
  has_blood, has_csf, has_tissue, has_plasma, has_pbmc, has_bmmc, indications_text)
- specimen_join_keys (specimen_id, donor_id, organization_id, specimen_type,
  preservation_category, age, sex, country, source_site, year)

We attach the source DB at runtime via ATTACH DATABASE rather than copying rows
where possible — these are derived views, not duplicates.
"""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "specimens.db"
OUT = ROOT / "data" / "enriched" / "views.db"

BLOOD_TYPES = (
    "Plasma", "Serum", "Whole blood",
    "Peripheral blood mononuclear cells (PBMCs)", "Buffy coat",
    "Red blood cell (RBC)/Buffy coat mixture",
)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    con = sqlite3.connect(OUT)
    con.execute(f"ATTACH DATABASE '{SRC}' AS src")

    print("Building specimen_join_keys ...")
    con.executescript("""
        CREATE TABLE specimen_join_keys AS
        SELECT
          specimen_id, donor_id, organization_id,
          specimen_type, preservation_category,
          age_at_collection AS age, sex, country_of_origin AS country,
          source_site, raw_anatomy,
          date_of_collection_year AS year,
          unstructured_pathology, unstructured_clinical_data,
          unstructured_treatments, donor_diagnoses, specimen_diagnoses,
          specimen_status
        FROM src.specimens;
        CREATE INDEX ix_sjk_specimen ON specimen_join_keys(specimen_id);
        CREATE INDEX ix_sjk_donor ON specimen_join_keys(donor_id);
        CREATE INDEX ix_sjk_org ON specimen_join_keys(organization_id);
        CREATE INDEX ix_sjk_type ON specimen_join_keys(specimen_type);
        CREATE INDEX ix_sjk_country ON specimen_join_keys(country);
        CREATE INDEX ix_sjk_year ON specimen_join_keys(year);
        -- Composite indexes for common filter combinations
        CREATE INDEX ix_sjk_org_type ON specimen_join_keys(organization_id, specimen_type);
        CREATE INDEX ix_sjk_type_country ON specimen_join_keys(specimen_type, country);
    """)

    print("Building specimens_fts ...")
    con.executescript("""
        CREATE VIRTUAL TABLE specimens_fts USING fts5(
          specimen_id UNINDEXED,
          haystack,
          tokenize = 'porter unicode61 remove_diacritics 2'
        );
    """)
    con.execute("""
        INSERT INTO specimens_fts (specimen_id, haystack)
        SELECT
          specimen_id,
          COALESCE(unstructured_pathology,'') || ' ' ||
          COALESCE(unstructured_clinical_data,'') || ' ' ||
          COALESCE(unstructured_treatments,'') || ' ' ||
          COALESCE(donor_diagnoses,'') || ' ' ||
          COALESCE(specimen_diagnoses,'') || ' ' ||
          COALESCE(raw_anatomy,'') || ' ' ||
          COALESCE(source_site,'')
        FROM specimen_join_keys
    """)
    con.commit()

    print("Building donor_longitudinal ...")
    blood_in = ",".join(f"'{t}'" for t in BLOOD_TYPES)
    con.executescript(f"""
        CREATE TABLE donor_longitudinal AS
        SELECT
          donor_id,
          COUNT(*) AS n_collections,
          COUNT(DISTINCT year) AS n_distinct_years,
          MAX(CASE WHEN specimen_type = 'Whole blood' THEN 1 ELSE 0 END) AS has_blood,
          MAX(CASE WHEN specimen_type = 'Cerebrospinal fluid (CSF)' THEN 1 ELSE 0 END) AS has_csf,
          MAX(CASE WHEN specimen_type = 'Tissue' THEN 1 ELSE 0 END) AS has_tissue,
          MAX(CASE WHEN specimen_type = 'Plasma' THEN 1 ELSE 0 END) AS has_plasma,
          MAX(CASE WHEN specimen_type = 'Serum' THEN 1 ELSE 0 END) AS has_serum,
          MAX(CASE WHEN specimen_type = 'Peripheral blood mononuclear cells (PBMCs)' THEN 1 ELSE 0 END) AS has_pbmc,
          MAX(CASE WHEN specimen_type = 'Bone marrow mononuclear cells (BMMCs)' THEN 1 ELSE 0 END) AS has_bmmc,
          MAX(CASE WHEN specimen_type IN ({blood_in}) THEN 1 ELSE 0 END) AS has_any_blood
        FROM specimen_join_keys
        WHERE donor_id IS NOT NULL
        GROUP BY donor_id;
        CREATE INDEX ix_dl_donor ON donor_longitudinal(donor_id);
    """)
    con.commit()

    counts = {
        "specimen_join_keys": con.execute("SELECT COUNT(*) FROM specimen_join_keys").fetchone()[0],
        "specimens_fts": con.execute("SELECT COUNT(*) FROM specimens_fts").fetchone()[0],
        "donor_longitudinal": con.execute("SELECT COUNT(*) FROM donor_longitudinal").fetchone()[0],
        "longitudinal_donors_>=2_years":
            con.execute("SELECT COUNT(*) FROM donor_longitudinal WHERE n_distinct_years >= 2").fetchone()[0],
    }
    con.close()
    for k, v in counts.items():
        print(f"  {k}: {v:,}")


if __name__ == "__main__":
    main()
