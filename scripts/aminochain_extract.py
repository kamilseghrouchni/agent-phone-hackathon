#!/usr/bin/env python3
"""
AminoChain Specimen Center — systematic API extraction.

Hits data-api.aminochain.io directly with session auth.
Phases: auth → discover → extract → organize.

Usage:
  python3 scripts/aminochain_extract.py auth          # extract JWT from live Playwright session
  python3 scripts/aminochain_extract.py discover       # build query manifest
  python3 scripts/aminochain_extract.py extract        # paginate and save specimens
  python3 scripts/aminochain_extract.py organize       # deduplicate, cross-ref, stats
  python3 scripts/aminochain_extract.py run            # discover + extract + organize
"""

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ── paths ──────────────────────────────────────────────────────────────────

BASE_DIR = Path("store/eval/aminochain")
AUTH_FILE = BASE_DIR / ".auth.json"
MANIFEST_FILE = BASE_DIR / "manifest.json"
CHECKPOINT_FILE = BASE_DIR / "checkpoint.json"
RAW_DIR = BASE_DIR / "raw"
ORG_DIR = BASE_DIR / "organized"

API_BASE = "https://data-api.aminochain.io"
CLERK_BASE = "https://clerk.aminochain.io/v1"

# ── user-agent rotation ───────────────────────────────────────────────────

_UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
]

_PLATFORMS = ['"macOS"', '"Windows"', '"Linux"']

# ── speed tiers ────────────────────────────────────────────────────────────

TIERS = {
    "cautious": (1.0, 3.0),
    "normal":   (0.3, 1.0),
    "aggressive": (0.1, 0.3),
}

# ── therapeutic area seed queries ──────────────────────────────────────────

SEED_DISEASES = {
    "oncology": [
        "Breast cancer", "Non-Small cell lung cancer (NSCLC)", "Lung cancer",
        "Bladder Cancer", "Colon cancer", "Stomach cancer",
        "Ovarian cancer", "Cervical cancer", "Pancreatic cancer",
        "Prostate cancer", "Liver cancer", "Uterine cancer",
        "Endometrial cancer", "Head and neck cancer", "Skin cancer",
        "Squamous cell cancer (SCC)", "Melanoma", "Renal cell carcinoma",
        "Colorectal cancer", "Esophageal cancer", "Thyroid cancer",
    ],
    "neuro": [
        "Alzheimer's disease (AD)", "Parkinson's disease (PD)",
        "Amyotrophic Lateral Sclerosis (ALS)", "Multiple Sclerosis (MS)",
        "Dementia", "Huntington's disease", "Encephalopathy",
        "Primary Lateral Sclerosis (PLS)", "Leukodystrophies",
        "Neurological condition",
    ],
    "immuno": [
        "Inflammatory bowel disease", "Crohn's disease", "Ulcerative colitis",
        "Rheumatoid arthritis", "Psoriasis", "Atopic dermatitis",
        "Lupus", "Ankylosing spondylitis", "Scleroderma",
    ],
    "metabolic": [
        "Diabetes", "Type 2 diabetes", "Obesity",
        "Non-alcoholic fatty liver disease", "Cardiovascular disease",
        "Hypertension", "Atherosclerosis", "Metabolic syndrome",
    ],
    "infectious": [
        "HIV/AIDS", "Hepatitis B", "Hepatitis C",
        "Coronavirus (Covid)", "Tuberculosis",
    ],
    "heme": [
        "Leukemia", "Lymphoma", "Multiple myeloma",
        "Hodgkin lymphoma", "Non-Hodgkin lymphoma",
        "Acute myeloid leukemia", "Chronic lymphocytic leukemia",
    ],
    "respiratory": [
        "Asthma", "Chronic Obstructive Pulmonary Disease (COPD)",
        "Idiopathic pulmonary fibrosis", "Cystic fibrosis",
    ],
    "rare": [
        "Sarcoma", "Glioblastoma", "Mesothelioma",
        "Cholangiocarcinoma", "Neuroendocrine tumor",
    ],
    "womens-health": [
        "Ovarian cancer", "Cervical cancer", "Endometrial cancer",
        "Uterine cancer", "Breast cancer", "Endometriosis",
    ],
}

SPECIMEN_TYPES = [
    "Tissue", "Plasma", "Serum", "Whole blood",
    "Peripheral blood mononuclear cells (PBMCs)",
    "Cerebrospinal fluid (CSF)", "Urine", "DNA", "RNA",
    "Stool", "Buffy coat", "Saliva",
    "Bronchoalveolar lavage fluid", "Synovial fluid",
    "Red blood cell (RBC)/Buffy coat mixture",
]

PRESERVATION_CATS = ["Fixed", "Frozen", "Cryopreservation", "Unknown"]


# ── HTTP client ────────────────────────────────────────────────────────────

class AminoClient:
    """Direct API client with auth, rate-limit handling, and stealth."""

    def __init__(self, auth: dict, tier: str = "cautious", proxy: str | None = None):
        self.session_jwt = auth["session_jwt"]
        self.client_jwt = auth["client_jwt"]
        self.session_id = auth["session_id"]
        self.clerk_cookie = auth.get("clerk_cookie", "")
        self.tier = tier
        self.proxy = proxy
        self._req_count = 0
        self._consecutive_ok = 0
        self._consecutive_fail = 0
        self._last_req = 0.0

    def _headers(self) -> dict:
        ua = random.choice(_UAS)
        plat = random.choice(_PLATFORMS)
        ver = ua.split("Chrome/")[1].split(".")[0] if "Chrome/" in ua else "147"
        return {
            "User-Agent": ua,
            "Referer": "https://app.aminochain.io/",
            "Origin": "https://app.aminochain.io",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "sec-ch-ua": f'"Google Chrome";v="{ver}", "Not.A/Brand";v="8", "Chromium";v="{ver}"',
            "sec-ch-ua-platform": plat,
            "sec-ch-ua-mobile": "?0",
            "Cookie": f"__session={self.session_jwt}; __client_uat={int(time.time())}",
        }

    def _delay(self):
        lo, hi = TIERS[self.tier]
        # log-normal for human-like distribution
        mu = math.log((lo + hi) / 2)
        sigma = 0.4
        wait = min(max(random.lognormvariate(mu, sigma), lo), hi * 2)
        elapsed = time.time() - self._last_req
        if elapsed < wait:
            time.sleep(wait - elapsed)

    def _maybe_escalate(self):
        if self.tier == "cautious" and self._consecutive_ok >= 50:
            self.tier = "normal"
            print(f"  [tier] escalated to normal after {self._consecutive_ok} OK")
        elif self.tier == "normal" and self._consecutive_ok >= 200:
            self.tier = "aggressive"
            print(f"  [tier] escalated to aggressive after {self._consecutive_ok} OK")

    def _maybe_session_break(self):
        if self._req_count > 0 and self._req_count % random.randint(80, 150) == 0:
            pause = random.uniform(20, 60)
            print(f"  [break] session break #{self._req_count // 100}, pausing {pause:.0f}s")
            time.sleep(pause)

    def post(self, endpoint: str, body: dict, retries: int = 5) -> dict:
        url = f"{API_BASE}{endpoint}"
        data = json.dumps(body).encode("utf-8")
        backoff = 10.0

        for attempt in range(retries):
            self._delay()
            self._maybe_session_break()

            req = urllib.request.Request(url, data=data, headers=self._headers(), method="POST")

            if self.proxy:
                proxy_handler = urllib.request.ProxyHandler({"https": self.proxy, "http": self.proxy})
                opener = urllib.request.build_opener(proxy_handler)
            else:
                opener = urllib.request.build_opener()

            try:
                self._last_req = time.time()
                self._req_count += 1
                with opener.open(req, timeout=30) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                    self._consecutive_ok += 1
                    self._consecutive_fail = 0
                    self._maybe_escalate()
                    return result

            except urllib.error.HTTPError as e:
                self._consecutive_fail += 1
                self._consecutive_ok = 0
                code = e.code

                if code == 429:
                    wait = min(backoff, 120)
                    print(f"  [429] rate limited, waiting {wait:.0f}s (attempt {attempt+1}/{retries})")
                    time.sleep(wait)
                    backoff *= 2
                    # drop tier
                    if self.tier != "cautious":
                        self.tier = "cautious"
                        print("  [tier] dropped to cautious")
                    continue

                elif code == 401:
                    print("  [401] token expired, refreshing...")
                    if self._refresh_token():
                        continue
                    else:
                        raise RuntimeError("Token refresh failed. Re-run 'auth' command.")

                elif code >= 500:
                    print(f"  [{code}] server error, retrying in 5s...")
                    time.sleep(5)
                    continue
                else:
                    raise

            except Exception as e:
                self._consecutive_fail += 1
                if self._consecutive_fail >= 10:
                    raise RuntimeError(f"10 consecutive failures, aborting: {e}")
                print(f"  [err] {e}, retrying in 5s...")
                time.sleep(5)
                continue

        raise RuntimeError(f"Failed after {retries} retries for {endpoint}")

    def _refresh_token(self) -> bool:
        """Refresh the Clerk session JWT."""
        url = f"{CLERK_BASE}/client/sessions/{self.session_id}/tokens?__clerk_api_version=2025-11-10&_clerk_js_version=5.125.10"
        headers = {
            "User-Agent": random.choice(_UAS),
            "Referer": "https://app.aminochain.io/",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": f"__client={self.client_jwt}",
        }
        req = urllib.request.Request(url, data=b"organization_id=", headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if "jwt" in data:
                    self.session_jwt = data["jwt"]
                    # persist
                    auth = _load_auth()
                    auth["session_jwt"] = self.session_jwt
                    auth["refreshed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    _save_auth(auth)
                    print("  [auth] token refreshed OK")
                    return True
        except Exception as e:
            print(f"  [auth] refresh failed: {e}")
        return False


# ── auth helpers ───────────────────────────────────────────────────────────

def _load_auth() -> dict:
    if not AUTH_FILE.exists():
        sys.exit(f"No auth file at {AUTH_FILE}. Run 'auth' first.")
    with open(AUTH_FILE) as f:
        return json.load(f)


def _save_auth(auth: dict):
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(AUTH_FILE, "w") as f:
        json.dump(auth, f, indent=2)


# ── checkpoint ─────────────────────────────────────────────────────────────

def _load_checkpoint() -> dict:
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {}


def _save_checkpoint(cp: dict):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(cp, f, indent=2)


# ── phase 1: auth ─────────────────────────────────────────────────────────

def cmd_auth(args):
    """Extract auth from the live Playwright session (or manual paste)."""
    print("Paste the __session cookie value (JWT) from the browser:")
    session_jwt = input("__session JWT: ").strip()
    print("Paste the __client cookie value (JWT):")
    client_jwt = input("__client JWT: ").strip()

    session_id = "sess_3Clvta0SlpIObNlFZxVraObbtbn"  # from network logs
    sid = input(f"Session ID [{session_id}]: ").strip()
    if sid:
        session_id = sid

    auth = {
        "session_jwt": session_jwt,
        "client_jwt": client_jwt,
        "session_id": session_id,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    # test with a count call
    client = AminoClient(auth, tier="cautious")
    try:
        result = client.post("/specimen/count", {"filter_set": {"filters": []}})
        print(f"Auth OK — {result.get('total_count', '?')} total specimens visible")
    except Exception as e:
        print(f"Auth test FAILED: {e}")
        print("Saving anyway — you may need to re-auth.")

    _save_auth(auth)
    print(f"Saved to {AUTH_FILE}")


# ── phase 2: discover ─────────────────────────────────────────────────────

def cmd_discover(args):
    """Build query manifest by probing counts for disease × specimen type."""
    auth = _load_auth()
    client = AminoClient(auth, tier=args.tier)

    manifest = []
    seen_slugs = set()

    # First, discover valid diagnosis values via autocomplete
    all_diseases = set()
    for area, diseases in SEED_DISEASES.items():
        all_diseases.update(diseases)

    # Also probe autocomplete for additional terms
    autocomplete_seeds = [
        "cancer", "carcinoma", "disease", "syndrome", "disorder",
        "infection", "tumor", "leukemia", "lymphoma", "sclerosis",
    ]
    print(f"[discover] probing autocomplete with {len(autocomplete_seeds)} seeds...")
    for seed in autocomplete_seeds:
        try:
            result = client.post("/autocomplete", {"query": seed, "limit": 20})
            if isinstance(result, list):
                for item in result:
                    if isinstance(item, str):
                        all_diseases.add(item)
                    elif isinstance(item, dict) and "value" in item:
                        all_diseases.add(item["value"])
        except Exception as e:
            print(f"  [warn] autocomplete '{seed}' failed: {e}")

    print(f"[discover] {len(all_diseases)} unique disease terms found")

    # Map diseases to areas
    disease_area_map = {}
    for area, diseases in SEED_DISEASES.items():
        for d in diseases:
            disease_area_map[d] = area

    # Cross with specimen types — probe counts
    total_queries = len(all_diseases) * len(SPECIMEN_TYPES)
    print(f"[discover] probing {total_queries} disease × specimen combos...")

    i = 0
    for disease in sorted(all_diseases):
        for stype in SPECIMEN_TYPES:
            i += 1
            slug = _slugify(f"{disease}_{stype}")
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)

            filters = [
                {"key": "specimen_diagnoses", "value": disease, "operator": "equals", "negated": False},
                {"key": "specimen_type", "value": stype, "operator": "equals", "negated": False},
            ]

            try:
                result = client.post("/specimen/count", {"filter_set": {"filters": filters}})
                count = result.get("total_count", 0)
            except Exception as e:
                print(f"  [{i}/{total_queries}] {slug}: error {e}")
                count = -1

            if count > 0:
                area = disease_area_map.get(disease, "other")
                pages = _pages_for_count(count)
                entry = {
                    "slug": slug,
                    "area": area,
                    "disease": disease,
                    "specimen_type": stype,
                    "filters": filters,
                    "count": count,
                    "pages_to_fetch": pages,
                }
                manifest.append(entry)
                print(f"  [{i}] {slug}: {count} specimens → {len(pages)} pages")

            if i % 100 == 0:
                print(f"  ... {i}/{total_queries} probed, {len(manifest)} non-zero")

    # Also add FFPE-specific queries (preservation_category=Fixed for tissue)
    print(f"\n[discover] adding FFPE-specific queries...")
    for disease in sorted(all_diseases):
        slug = _slugify(f"{disease}_tissue-fixed")
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)

        filters = [
            {"key": "specimen_diagnoses", "value": disease, "operator": "equals", "negated": False},
            {"key": "specimen_type", "value": "Tissue", "operator": "equals", "negated": False},
            {"key": "preservation_category", "value": "Fixed", "operator": "equals", "negated": False},
        ]
        try:
            result = client.post("/specimen/count", {"filter_set": {"filters": filters}})
            count = result.get("total_count", 0)
        except Exception:
            count = -1

        if count > 0:
            area = disease_area_map.get(disease, "other")
            pages = _pages_for_count(count)
            manifest.append({
                "slug": slug, "area": area, "disease": disease,
                "specimen_type": "Tissue (Fixed/FFPE)", "filters": filters,
                "count": count, "pages_to_fetch": pages,
            })
            print(f"  {slug}: {count} → {len(pages)} pages")

    # Save manifest
    MANIFEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST_FILE, "w") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "total_queries": len(manifest),
                    "total_specimens": sum(q["count"] for q in manifest),
                    "queries": manifest}, f, indent=2)

    print(f"\n[discover] manifest saved: {len(manifest)} queries, "
          f"{sum(q['count'] for q in manifest)} total specimens")
    print(f"  → {MANIFEST_FILE}")


def _pages_for_count(count: int) -> list[int]:
    """Determine which pages to fetch based on total count."""
    if count <= 0:
        return []
    total_pages = math.ceil(count / 20)
    if count <= 200:
        return list(range(1, total_pages + 1))
    elif count <= 1000:
        return list(range(1, min(11, total_pages + 1)))
    elif count <= 5000:
        candidates = [1, 3, 7, 15, 25, 40, 60, 80, 100, 150]
        return [p for p in candidates if p <= total_pages]
    else:
        candidates = [1, 5, 10, 25, 50, 75, 100, 150, 200, 250]
        base = [p for p in candidates if p <= total_pages]
        # add 5 random pages
        randoms = random.sample(range(1, total_pages + 1), min(5, total_pages))
        return sorted(set(base + randoms))


def _slugify(s: str) -> str:
    return (s.lower()
            .replace("(", "").replace(")", "").replace("/", "-")
            .replace("'", "").replace(",", "").replace(".", "")
            .replace("  ", " ").replace(" ", "-").strip("-"))


# ── phase 3: extract ──────────────────────────────────────────────────────

def cmd_extract(args):
    """Paginate through each manifest query, save JSONL."""
    auth = _load_auth()
    client = AminoClient(auth, tier=args.tier, proxy=os.environ.get("AMINOCHAIN_PROXY"))

    with open(MANIFEST_FILE) as f:
        manifest = json.load(f)

    queries = manifest["queries"]
    checkpoint = _load_checkpoint()

    # Shuffle for stealth
    random.shuffle(queries)

    if args.max_queries:
        queries = queries[:args.max_queries]

    print(f"[extract] {len(queries)} queries to process")

    for qi, query in enumerate(queries):
        slug = query["slug"]
        area = query["area"]
        pages = query["pages_to_fetch"]

        # Check checkpoint
        done_pages = checkpoint.get(slug, {}).get("pages_done", [])
        remaining = [p for p in pages if p not in done_pages]

        if not remaining:
            continue

        # Ensure output dir
        out_dir = RAW_DIR / area
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{slug}.jsonl"

        print(f"\n[{qi+1}/{len(queries)}] {slug} — {query['count']} specimens, "
              f"{len(remaining)} pages remaining")

        for page_num in remaining:
            body = {
                "filter_set": {"filters": query["filters"]},
                "page_size": 20,
                "sort": {"by": "specimen_id", "order": "asc"},
                "page": page_num,
            }

            try:
                result = client.post("/specimen/get-by-filter", body)
                specimens = result.get("specimens", [])

                # Append to JSONL
                with open(out_file, "a") as f:
                    for spec in specimens:
                        f.write(json.dumps(spec) + "\n")

                # Update checkpoint
                if slug not in checkpoint:
                    checkpoint[slug] = {"pages_done": [], "complete": False}
                checkpoint[slug]["pages_done"].append(page_num)
                if set(checkpoint[slug]["pages_done"]) >= set(pages):
                    checkpoint[slug]["complete"] = True
                _save_checkpoint(checkpoint)

                print(f"  page {page_num}: {len(specimens)} specimens "
                      f"({client._req_count} total reqs, tier={client.tier})")

            except Exception as e:
                print(f"  page {page_num}: FAILED — {e}")
                # Continue to next page / query
                continue

        # Inter-query delay
        if qi < len(queries) - 1:
            wait = random.uniform(3.0, 8.0)
            time.sleep(wait)

    print(f"\n[extract] done — {client._req_count} total API calls")


# ── phase 4: organize ─────────────────────────────────────────────────────

def cmd_organize(args):
    """Read all JSONL, deduplicate, compute stats."""
    ORG_DIR.mkdir(parents=True, exist_ok=True)

    all_specimens = {}  # specimen_id → specimen
    donors = {}  # donor_id → {specimen_type: [specimen_ids]}
    by_area = {}  # area → [specimen_ids]
    biomarker_stats = {}  # disease → {her2: n, er: n, ...}

    # Read all JSONL files
    jsonl_files = list(RAW_DIR.rglob("*.jsonl"))
    print(f"[organize] reading {len(jsonl_files)} JSONL files...")

    for jf in jsonl_files:
        area = jf.parent.name
        with open(jf) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                spec = json.loads(line)
                sid = spec.get("specimen_id", "")
                if sid in all_specimens:
                    continue  # deduplicate

                all_specimens[sid] = spec

                # Area tracking
                by_area.setdefault(area, []).append(sid)

                # Donor cross-ref
                did = spec.get("donor_id", "")
                stype = spec.get("specimen_type", "Unknown")
                donors.setdefault(did, {}).setdefault(stype, []).append(sid)

                # Biomarker stats
                for diag in spec.get("specimen_diagnoses", []):
                    stats = biomarker_stats.setdefault(diag, {
                        "total": 0, "her2": 0, "er": 0, "pr": 0,
                        "ki67": 0, "pdl1": 0, "tnm": 0,
                    })
                    stats["total"] += 1
                    for m in spec.get("unstructured_measurements", []):
                        mname = (m.get("measurement") or "").lower()
                        if "her2" in mname:
                            stats["her2"] += 1
                        if mname in ("er", "estrogen receptor"):
                            stats["er"] += 1
                        if mname in ("pr", "progesterone receptor"):
                            stats["pr"] += 1
                        if "ki67" in mname or "ki-67" in mname:
                            stats["ki67"] += 1
                        if "pd-l1" in mname or "pdl1" in mname:
                            stats["pdl1"] += 1
                    sm = spec.get("structured_measurements") or {}
                    if sm.get("T") is not None:
                        stats["tnm"] += 1

    # Find matched pairs (donors with multiple specimen types)
    matched = {}
    for did, types in donors.items():
        if len(types) > 1:
            matched[did] = {t: sids for t, sids in types.items()}

    # Write outputs
    print(f"[organize] {len(all_specimens)} unique specimens, "
          f"{len(matched)} donors with matched pairs")

    # all_specimens.jsonl
    with open(ORG_DIR / "all_specimens.jsonl", "w") as f:
        for spec in all_specimens.values():
            f.write(json.dumps(spec) + "\n")

    # by_therapeutic_area.json
    area_summary = {a: {"count": len(sids), "specimen_ids": sids[:10]}
                    for a, sids in by_area.items()}
    with open(ORG_DIR / "by_therapeutic_area.json", "w") as f:
        json.dump(area_summary, f, indent=2)

    # matched_pairs.json
    with open(ORG_DIR / "matched_pairs.json", "w") as f:
        json.dump({"total_matched_donors": len(matched),
                    "pairs": dict(list(matched.items())[:500])}, f, indent=2)

    # biomarker_coverage.json
    with open(ORG_DIR / "biomarker_coverage.json", "w") as f:
        json.dump(biomarker_stats, f, indent=2)

    # summary.json
    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_specimens": len(all_specimens),
        "total_donors": len(donors),
        "matched_pair_donors": len(matched),
        "jsonl_files": len(jsonl_files),
        "areas": {a: len(sids) for a, sids in by_area.items()},
        "top_diseases": sorted(
            ((d, s["total"]) for d, s in biomarker_stats.items()),
            key=lambda x: -x[1]
        )[:30],
    }
    with open(ORG_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"[organize] outputs saved to {ORG_DIR}/")
    print(f"  all_specimens.jsonl: {len(all_specimens)} records")
    print(f"  matched_pairs.json: {len(matched)} donors")
    print(f"  biomarker_coverage.json: {len(biomarker_stats)} diseases")


# ── run (all phases) ──────────────────────────────────────────────────────

def cmd_run(args):
    cmd_discover(args)
    cmd_extract(args)
    cmd_organize(args)


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AminoChain specimen extraction")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("auth", help="Extract auth from browser session")

    p_disc = sub.add_parser("discover", help="Build query manifest")
    p_disc.add_argument("--tier", default="cautious", choices=TIERS.keys())

    p_ext = sub.add_parser("extract", help="Extract specimens per manifest")
    p_ext.add_argument("--tier", default="cautious", choices=TIERS.keys())
    p_ext.add_argument("--max-queries", type=int, default=None)

    sub.add_parser("organize", help="Deduplicate and compute stats")

    p_run = sub.add_parser("run", help="Discover + extract + organize")
    p_run.add_argument("--tier", default="cautious", choices=TIERS.keys())
    p_run.add_argument("--max-queries", type=int, default=None)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return

    {"auth": cmd_auth, "discover": cmd_discover, "extract": cmd_extract,
     "organize": cmd_organize, "run": cmd_run}[args.command](args)


if __name__ == "__main__":
    main()
