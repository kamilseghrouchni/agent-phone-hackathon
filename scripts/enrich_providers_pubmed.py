#!/usr/bin/env python3
"""
Enrich providers (CROs / platforms) with PubMed-derived facts.

Fans out PubMed affiliation searches in parallel, pulls metadata for the
top N papers per provider, and extracts a standardized record covering:
  - HQ address hints + corresponding-author emails
  - Sample types touched (with evidence PMIDs)
  - Indication areas (from MeSH)
  - Academic / industry partners (co-author orgs)
  - Top publications (PMID, DOI, year, journal, title)

Outputs:
  data/providers_enriched/raw/{slug}.json   raw PubMed payload (full abstracts)
  data/providers_enriched/{slug}.json       standardized facts
  data/providers_enriched/_index.json       slug -> summary

Usage:
  python3 scripts/enrich_providers_pubmed.py
  python3 scripts/enrich_providers_pubmed.py --names "Metabolon,Biognosys,GENEWIZ from Azenta"
  python3 scripts/enrich_providers_pubmed.py --max_pubs 30 --date_from 2020
  python3 scripts/enrich_providers_pubmed.py --platforms      # also include platforms/_all.jsonl
"""
import argparse
import concurrent.futures
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT_DIR = DATA / "providers_enriched"

PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
USER_AGENT = "vcro-enrichment/1.0 (mailto:kamil.seg@gmail.com)"

# NCBI: 3 req/sec without API key, 10/sec with. Stay safe.
class RateLimiter:
    def __init__(self, calls_per_sec: float):
        self.interval = 1.0 / calls_per_sec
        self.lock = threading.Lock()
        self.next_allowed = 0.0
    def wait(self):
        with self.lock:
            now = time.monotonic()
            wait = self.next_allowed - now
            if wait > 0:
                time.sleep(wait)
            self.next_allowed = max(now, self.next_allowed) + self.interval

LIMITER = RateLimiter(2.5)  # leave headroom under the 3/s cap


def slugify(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def clean_provider_name(raw: str) -> str:
    """Strip a trailing '(parent)' suffix.  'Q² Solutions (IQVIA Labs)' -> 'Q² Solutions'."""
    return re.sub(r'\s*\([^)]*\)\s*$', '', raw).strip()


def alias_queries(raw: str) -> list[str]:
    """
    Generate the affiliation strings to try.
    'Q² Solutions (IQVIA Labs)' -> ['Q² Solutions', 'IQVIA Labs']
    'GENEWIZ from Azenta'       -> ['GENEWIZ from Azenta', 'GENEWIZ', 'Azenta']
    'Eurofins Genomics + Biopharma' -> ['Eurofins Genomics + Biopharma', 'Eurofins Genomics', 'Eurofins']
    """
    out: list[str] = []
    base = raw.strip()
    out.append(base)
    # Parenthesized parent
    m = re.match(r'^(.+?)\s*\(([^)]+)\)\s*$', base)
    if m:
        out = [m.group(1).strip(), m.group(2).strip()]
    # 'X from Y' pattern
    m = re.match(r'^(.+?)\s+from\s+(.+)$', out[0], re.IGNORECASE)
    if m:
        out += [m.group(1).strip(), m.group(2).strip()]
    # Plus / and patterns
    if "+" in out[0]:
        out += [s.strip() for s in out[0].split("+") if s.strip()]
    # Dedupe, preserve order
    seen, deduped = set(), []
    for n in out:
        if n and n.lower() not in seen:
            seen.add(n.lower())
            deduped.append(n)
    return deduped


def http_json(url: str, retries: int = 3) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for i in range(retries):
        try:
            LIMITER.wait()
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(0.5 * (2 ** i))
    return {}


def http_text(url: str, retries: int = 3) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for i in range(retries):
        try:
            LIMITER.wait()
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(0.5 * (2 ** i))
    return ""


def pubmed_search(affiliation: str, max_results: int, date_from: str) -> dict:
    q = f'"{affiliation}"[Affiliation]'
    if date_from:
        q = f"{q} AND {date_from}:3000[pdat]"
    params = {
        "db": "pubmed", "term": q, "retmax": str(max_results),
        "retmode": "json", "sort": "pub_date",
    }
    url = f"{PUBMED_BASE}/esearch.fcgi?{urllib.parse.urlencode(params)}"
    j = http_json(url)
    res = j.get("esearchresult", {})
    return {
        "pmids": res.get("idlist", []),
        "total_count": int(res.get("count", 0)),
        "query": q,
    }


def pubmed_fetch_xml(pmids: list[str]) -> str:
    if not pmids:
        return ""
    params = {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"}
    url = f"{PUBMED_BASE}/efetch.fcgi?{urllib.parse.urlencode(params)}"
    return http_text(url)


def parse_pubmed_xml(xml: str) -> list[dict]:
    if not xml.strip():
        return []
    root = ET.fromstring(xml)
    out = []
    for art in root.findall(".//PubmedArticle"):
        rec: dict = {}
        rec["pmid"] = (art.findtext(".//PMID") or "").strip()
        for aid in art.findall(".//ArticleId"):
            t = aid.get("IdType")
            if t == "doi":
                rec["doi"] = (aid.text or "").strip()
            elif t == "pmc":
                rec["pmc"] = (aid.text or "").strip()
        rec["title"] = (art.findtext(".//ArticleTitle") or "").strip()
        abs_parts = [a.text or "" for a in art.findall(".//Abstract/AbstractText")]
        rec["abstract"] = " ".join(p.strip() for p in abs_parts if p)
        rec["journal"] = (art.findtext(".//Journal/ISOAbbreviation")
                          or art.findtext(".//Journal/Title") or "").strip()
        year_text = art.findtext(".//PubDate/Year") or art.findtext(".//PubDate/MedlineDate") or ""
        m = re.search(r"\d{4}", year_text)
        rec["year"] = int(m.group(0)) if m else None
        authors = []
        for au in art.findall(".//Author"):
            authors.append({
                "last_name": au.findtext("LastName") or "",
                "fore_name": au.findtext("ForeName") or "",
                "affiliations": [a.text or "" for a in au.findall(".//AffiliationInfo/Affiliation")],
            })
        rec["authors"] = authors
        rec["mesh_terms"] = [m.findtext("DescriptorName") or "" for m in art.findall(".//MeshHeading")]
        rec["keywords"] = [k.text or "" for k in art.findall(".//KeywordList/Keyword")]
        out.append(rec)
    return out


def fetch_one_provider(name: str, max_pubs: int, date_from: str) -> dict:
    """
    Try aliases in order; merge results from any alias that returns hits.
    Each alias is a separate PubMed search; PMIDs are deduplicated.
    """
    aliases = alias_queries(name)
    seen_pmids: set[str] = set()
    merged_pmids: list[str] = []
    queries_used: list[str] = []
    total_estimate = 0
    for alias in aliases:
        s = pubmed_search(alias, max_pubs, date_from)
        queries_used.append(s["query"])
        if not s["pmids"]:
            continue
        total_estimate = max(total_estimate, s["total_count"])
        for pmid in s["pmids"]:
            if pmid not in seen_pmids:
                seen_pmids.add(pmid)
                merged_pmids.append(pmid)
        if len(merged_pmids) >= max_pubs:
            break
    merged_pmids = merged_pmids[:max_pubs]
    articles = parse_pubmed_xml(pubmed_fetch_xml(merged_pmids)) if merged_pmids else []
    return {
        "name": name,
        "cleaned_name": clean_provider_name(name),
        "aliases_tried": aliases,
        "publication_total": total_estimate,
        "search_queries": queries_used,
        "publications": articles,
    }


# ----------------------------- standardization -----------------------------

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

# Tokens that indicate the segment IS the parent institution
PARENT_TOKENS = re.compile(
    r"\b(University|Universit[äà]t|Universidad|Universidade|Universit[ée]|"
    r"Institute|Institut|Hospital|H[oô]pital|Centre|Center|"
    r"School|College|Foundation|Clinic|Klinik|"
    r"Laborator(y|io|ies)|Research|"
    r"Inc\b|LLC\b|Corp\b|Co\b\.?|AG\b|GmbH|Ltd\b|S\.A\.|SAS|Pty|Pharma|"
    r"NIH\b|FDA\b|CDC\b|EMBL|MRC\b|CNRS\b|INSERM|Max Planck)",
    re.IGNORECASE,
)
# Junk segments that are NEVER a useful partner name
JUNK_SEGMENT = re.compile(
    r"^(the |a |an |Department|Division|Section|Unit|Lab|Laboratory|"
    r"Group|Programme|Program|Chair|Service|Branch|Office|Box|Room|Suite|Building|Floor|"
    r"\d|Email|Electronic address|For correspondence|MPH|MD|PhD)",
    re.IGNORECASE,
)


def extract_parent_org(affiliation: str) -> str | None:
    """
    From 'Department of Pediatrics, Stanford University, Palo Alto, CA, USA',
    return 'Stanford University'.
    Heuristic: split by comma, return the first segment that looks like a
    parent institution; fall back to the first non-junk segment.
    """
    if not affiliation:
        return None
    parts = [p.strip() for p in affiliation.split(",") if p.strip()]
    # Drop trailing parts that are obviously address tail (postal codes, country)
    # by stopping at the first segment that contains a parent token.
    for p in parts:
        if PARENT_TOKENS.search(p):
            # Trim a trailing postal code if present (e.g. "Stanford University 94305")
            return re.sub(r"\s+\d{4,6}.*$", "", p).strip()
    # No parent token found — fall back to first non-junk segment
    for p in parts:
        if not JUNK_SEGMENT.match(p):
            return p
    return None

SAMPLE_PATTERNS = [
    ("plasma",            r"\bplasma\b"),
    ("serum",             r"\bserum\b"),
    ("urine",             r"\burin(e|ary)\b"),
    ("CSF",               r"\b(CSF|cerebrospinal fluid)\b"),
    ("FFPE",              r"\bFFPE\b|formalin.?fixed"),
    ("frozen tissue",     r"\bfrozen (tumou?r )?tissue\b|fresh.?frozen"),
    ("whole blood",       r"\bwhole blood\b"),
    ("PBMCs",             r"\bPBMC|peripheral blood mononuclear"),
    ("saliva",            r"\bsaliva\b"),
    ("stool/feces",       r"\bstool\b|\bfecal\b|\bfaecal\b|\bfeces\b"),
    ("buccal",            r"\bbuccal\b"),
    ("BAL",               r"\bbronchoalveolar|BAL fluid\b"),
    ("synovial fluid",    r"\bsynovial fluid\b"),
    ("breast milk",       r"\b(breast |human )milk\b"),
    ("exosomes",          r"\bexosom"),
    ("biopsy",            r"\b(needle |core )?biopsy\b"),
    ("tumor tissue",      r"\btumou?r tissue\b"),
    ("cell lines",        r"\bcell lines?\b"),
    ("organoids",         r"\borganoid"),
    ("PDX",               r"\b(PDX|patient.?derived xenograft)\b"),
    ("brain tissue",      r"\bbrain tissue\b"),
    ("bone marrow",       r"\bbone marrow\b"),
]

# MeSH terms that look like a disease/area
INDICATION_HINT = re.compile(
    r"(neoplasm|cancer|tumou?r|carcinoma|leukemia|leukaemia|lymphoma|melanoma|sarcoma|"
    r"diabetes|alzheimer|parkinson|amyotrophic|multiple sclerosis|huntington|dementia|"
    r"cardio|stroke|myocardial|hypertension|heart failure|"
    r"infect|hepatit|covid|HIV|tuberculosis|"
    r"renal|kidney|pulmonary|asthma|COPD|"
    r"arthrit|inflamm|lupus|crohn|ulcerative|psoriasis|"
    r"depress|psychiatr|schizophren|autism|bipolar|"
    r"aging|senescence|nutrition|obesity|"
    r"pregnan|maternal|fetal|preterm|"
    r"vaccin|immunology)",
    re.IGNORECASE,
)


def standardize_facts(raw: dict) -> dict:
    pubs = raw.get("publications", [])
    cleaned = (raw.get("cleaned_name") or raw.get("name", "")).lower()
    # All names that count as "self" for filtering self-references in partners.
    self_tokens = {a.lower() for a in raw.get("aliases_tried", []) if a}
    self_tokens.add(cleaned)
    self_tokens = {t for t in self_tokens if len(t) >= 4}

    # 1. Address hints + emails: only from affiliations that mention the provider
    address_lines: dict[str, int] = {}
    emails: set[str] = set()
    for art in pubs:
        for au in art.get("authors", []):
            for aff in au.get("affiliations", []):
                if not aff or cleaned not in aff.lower():
                    continue
                for m in EMAIL_RE.finditer(aff):
                    emails.add(m.group(0).rstrip(".,;"))
                clean_aff = re.sub(r"\bElectronic address:\s*\S+@\S+", "", aff)
                clean_aff = EMAIL_RE.sub("", clean_aff).strip().rstrip(".,;")
                if clean_aff:
                    address_lines[clean_aff] = address_lines.get(clean_aff, 0) + 1
    top_addresses = [a for a, _ in sorted(address_lines.items(), key=lambda x: -x[1])[:5]]

    # 2. Academic / industry partners: co-author parent orgs (filtered to real institutions)
    partners: dict[str, int] = {}
    for art in pubs:
        seen_in_art: set[str] = set()
        for au in art.get("authors", []):
            for aff in au.get("affiliations", []):
                if not aff:
                    continue
                aff_l = aff.lower()
                if any(tok in aff_l for tok in self_tokens):
                    continue  # skip self-affiliations (any alias)
                org = extract_parent_org(aff)
                if not org or len(org) < 5:
                    continue
                org_l = org.lower()
                if any(tok in org_l for tok in self_tokens):
                    continue
                seen_in_art.add(org)
        for org in seen_in_art:
            partners[org] = partners.get(org, 0) + 1
    top_partners = [{"name": p, "co_pubs": n}
                    for p, n in sorted(partners.items(), key=lambda x: -x[1])[:15]]

    # 3. Sample types from abstracts + MeSH
    sample_hits: dict[str, list[str]] = {}
    for art in pubs:
        text = (art.get("abstract") or "") + " " + " ".join(art.get("mesh_terms") or [])
        for label, pat in SAMPLE_PATTERNS:
            if re.search(pat, text, re.IGNORECASE):
                sample_hits.setdefault(label, []).append(art["pmid"])
    sample_types = [
        {"type": k, "n_papers": len(v), "evidence_pmids": v[:3]}
        for k, v in sorted(sample_hits.items(), key=lambda x: -len(x[1]))
    ]

    # 4. Indication areas from MeSH
    indication: dict[str, int] = {}
    for art in pubs:
        for m in art.get("mesh_terms") or []:
            if INDICATION_HINT.search(m):
                indication[m] = indication.get(m, 0) + 1
    indication_areas = [
        {"area": k, "n_papers": v}
        for k, v in sorted(indication.items(), key=lambda x: -x[1])[:15]
    ]

    # 5. Top publications (slim view)
    top_pubs = [{
        "pmid": p["pmid"],
        "doi": p.get("doi"),
        "pmc": p.get("pmc"),
        "year": p.get("year"),
        "journal": p.get("journal"),
        "title": p.get("title"),
    } for p in pubs[:10]]

    return {
        "id": slugify(raw.get("cleaned_name") or raw["name"]),
        "name": raw["name"],
        "source": "pubmed",
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "aliases_tried": raw.get("aliases_tried", []),
        "search_queries": raw.get("search_queries", []),
        "publication_total": raw["publication_total"],
        "publications_indexed": len(pubs),
        "address_hints": top_addresses,
        "contact_emails": sorted(emails),
        "sample_types": sample_types,
        "indication_areas": indication_areas,
        "academic_partners": top_partners,
        "top_publications": top_pubs,
    }


# ----------------------------- runner -----------------------------

def load_cro_names() -> list[str]:
    path = DATA / "cro_catalog.tsv"
    rows = path.read_text().splitlines()
    headers = rows[0].split("\t")
    idx = headers.index("cro_name")
    return [r.split("\t")[idx] for r in rows[1:] if r.strip()]


def load_platform_names() -> list[str]:
    path = DATA / "platforms" / "_all.jsonl"
    if not path.exists():
        return []
    seen = set()
    out = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        n = rec.get("name", "").strip()
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--names", help="Comma-separated provider names; default = all CROs")
    ap.add_argument("--max_pubs", type=int, default=20)
    ap.add_argument("--date_from", default="2022")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--platforms", action="store_true", help="Also include CT.gov-derived platforms")
    ap.add_argument("--out_dir", default=str(OUT_DIR))
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    raw_dir = out_dir / "raw"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    if args.names:
        names = [n.strip() for n in args.names.split(",") if n.strip()]
    else:
        names = load_cro_names()
        if args.platforms:
            names += load_platform_names()

    print(f"Enriching {len(names)} providers (max {args.max_pubs} pubs, {args.workers} workers)...",
          file=sys.stderr)

    results: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        future_to_name = {
            ex.submit(fetch_one_provider, n, args.max_pubs, args.date_from): n
            for n in names
        }
        for fut in concurrent.futures.as_completed(future_to_name):
            name = future_to_name[fut]
            try:
                raw = fut.result()
                slug = slugify(clean_provider_name(name))
                (raw_dir / f"{slug}.json").write_text(json.dumps(raw, indent=2))
                facts = standardize_facts(raw)
                (out_dir / f"{slug}.json").write_text(json.dumps(facts, indent=2))
                results[slug] = {
                    "name": name,
                    "publication_total": raw["publication_total"],
                    "publications_indexed": len(raw["publications"]),
                    "n_sample_types": len(facts["sample_types"]),
                    "n_partners": len(facts["academic_partners"]),
                    "n_emails": len(facts["contact_emails"]),
                }
                pt = raw["publication_total"]
                print(f"  ✓ {name}: {pt} papers, "
                      f"{len(facts['sample_types'])} sample types, "
                      f"{len(facts['academic_partners'])} partners, "
                      f"{len(facts['contact_emails'])} emails",
                      file=sys.stderr)
            except Exception as e:
                print(f"  ✗ {name}: {e}", file=sys.stderr)

    (out_dir / "_index.json").write_text(json.dumps(results, indent=2))
    print(f"\nDone. {len(results)} providers enriched -> {out_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
