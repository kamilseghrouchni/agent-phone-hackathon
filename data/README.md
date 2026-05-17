# AminoChain Biospecimen Database

Local copy of AminoChain's Specimen Center database — 486,754 biospecimen records from 18 biobank organizations, covering 161,374 unique donors across 8 countries. Collection dates range from 1999 to 2025.

## Quick Start

```bash
sqlite3 specimens.db
```

## Dataset Summary

| Metric | Value |
|--------|-------|
| Records | 486,754 |
| Unique donors | 161,374 |
| Biobank organizations | 18 |
| Countries | 8 (USA, UKR, CAN, NLD, TUR, FRA, IND, NGA) |
| Collection years | 1999–2025 |
| Specimen types | 22 (Tissue, Plasma, Serum, DNA, PBMCs, CSF, RNA, etc.) |
| Diagnoses coverage | 57% of records (163K mention cancer) |

## Schema

29 dedicated columns + full raw JSON per record:

```sql
specimens (
    document_id TEXT PRIMARY KEY,      -- AminoChain internal ID
    specimen_id TEXT NOT NULL,          -- hashed specimen identifier
    donor_id TEXT,                      -- hashed donor identifier
    organization_id TEXT,              -- biobank org UUID

    -- Demographics
    sex TEXT,                           -- Female | Male | Unknown
    age_at_collection INTEGER,
    country_of_origin TEXT,             -- ISO 3-letter
    donor_race TEXT,                    -- ~20% populated

    -- Specimen classification
    specimen_type TEXT,                 -- 22 types
    specimen_category TEXT,             -- Tissue | Biofluid
    preservation_category TEXT,         -- 8 types (Frozen, FFPE, Cryo, etc.)
    source_site TEXT,                   -- anatomy (Breast, Prostate, Brain, etc.)
    specimen_status TEXT,               -- Pending | Available
    quantity INTEGER,

    -- Collection date
    date_of_collection_year INTEGER,
    date_of_collection_month INTEGER,
    date_of_collection_day INTEGER,

    -- External linkage
    external_donor_id TEXT,
    external_specimen_id TEXT,

    -- Unstructured text
    raw_anatomy TEXT,
    unstructured_preservation TEXT,
    unstructured_pathology TEXT,
    unstructured_clinical_data TEXT,
    unstructured_treatments TEXT,

    -- Diagnoses & treatments (JSON arrays as TEXT)
    specimen_diagnoses TEXT,
    donor_diagnoses TEXT,
    specimen_treatments TEXT,
    donor_treatments TEXT,

    -- Full record
    raw_json TEXT NOT NULL
)
```

**Indexes:** `specimen_id`, `donor_id`, `specimen_type`, `country_of_origin`

### Fields in `raw_json` only

Queryable via `json_extract(raw_json, '$.path')`:

- `structured_measurements` — 13 keys: T, N, M, stage, grade (cancer staging), area, volume, mass, post-mortem interval, tumor/necrosis/viable tissue percentages
- `donor_tas` / `specimen_tas` — 13 therapeutic area float scores (Oncological, Neurological, Cardiovascular, etc.)
- `unstructured_measurements` — array of `{"measurement": "HIV", "value": "negative"}` objects

## Data Profile

### By specimen type
| Type | Count |
|------|-------|
| Tissue | 142,525 |
| Plasma | 107,734 |
| Serum | 90,564 |
| Other | 35,974 |
| Urine | 32,365 |
| DNA | 22,694 |
| RBC/Buffy coat mixture | 19,033 |
| PBMCs | 15,053 |
| Buffy coat | 8,131 |
| RNA | 4,006 |
| CSF | 2,783 |
| Whole blood | 1,957 |
| iPSCs | 953 |
| *+ 9 rarer types* | *2,982* |

### By country
| Country | Count |
|---------|-------|
| USA | 226,888 |
| UKR | 110,092 |
| CAN | 75,047 |
| NLD | 44,015 |
| TUR | 17,440 |
| FRA | 11,877 |
| IND | 1,112 |
| NGA | 283 |

### By preservation
| Method | Count |
|--------|-------|
| Frozen | 196,441 |
| Fixed (FFPE) | 124,163 |
| Unknown | 83,161 |
| Cryopreservation | 62,770 |
| RNA-stabilizing | 10,768 |
| Fresh | 8,884 |
| Suspended in Media | 554 |

### Diagnosis coverage
- 279,602 records (57%) have `donor_diagnoses`
- 163,887 mention cancer
- Includes: breast, prostate, lung, colorectal, pancreatic, testicular, uterine, ovarian cancers; Parkinson's; Multiple Sclerosis; CHF; various rare diseases

### Demographics
- Female: ~50%, Male: ~47%, Unknown: ~3%
- Age range: 0–100+ (full lifespan coverage)
- Collection years: 1999–2025

## Common Queries

```sql
-- All prostate cancer tissue from USA
SELECT * FROM specimens
WHERE country_of_origin = 'USA'
  AND specimen_type = 'Tissue'
  AND donor_diagnoses LIKE '%Prostate cancer%';

-- Count by diagnosis keyword
SELECT donor_diagnoses, COUNT(*) as n
FROM specimens
WHERE donor_diagnoses IS NOT NULL
GROUP BY donor_diagnoses ORDER BY n DESC LIMIT 20;

-- Find donors with both tissue and plasma samples
SELECT donor_id, GROUP_CONCAT(DISTINCT specimen_type) as types, COUNT(*) as n
FROM specimens
GROUP BY donor_id
HAVING COUNT(DISTINCT specimen_type) > 1
LIMIT 20;

-- Cancer staging data (from raw_json)
SELECT specimen_id,
  json_extract(raw_json, '$.structured_measurements.T') as T,
  json_extract(raw_json, '$.structured_measurements.N') as N,
  json_extract(raw_json, '$.structured_measurements.M') as M,
  json_extract(raw_json, '$.structured_measurements.stage') as stage
FROM specimens
WHERE json_extract(raw_json, '$.structured_measurements.T') IS NOT NULL;

-- Therapeutic area scores
SELECT specimen_id,
  json_extract(raw_json, '$.donor_tas.Oncological') as onco_score,
  json_extract(raw_json, '$.donor_tas.Neurological') as neuro_score
FROM specimens
WHERE json_extract(raw_json, '$.donor_tas.Oncological') IS NOT NULL
LIMIT 20;

-- Organization breakdown
SELECT organization_id, COUNT(*) as n,
  COUNT(DISTINCT donor_id) as donors
FROM specimens
GROUP BY organization_id ORDER BY n DESC;
```

## Re-extraction

The extraction script (`scripts/exfiltrate.py`) is idempotent and resumable:

```bash
cd scripts
python3 exfiltrate.py              # full run, resume from checkpoint
python3 exfiltrate.py --dry-run    # probe without downloading
```

Source API: `POST https://data-api.aminochain.io/specimen/get-by-filter`
Count API: `POST https://data-api.aminochain.io/specimen/count`

## File Layout

```
aminochain-specimens/
  specimens.db              # 2.0 GB SQLite
  README.md                 # this file
  scripts/
    exfiltrate.py           # original extraction script
    partitions.json         # filter partition definitions
    partitions_v2.json      # extended partitions
```
