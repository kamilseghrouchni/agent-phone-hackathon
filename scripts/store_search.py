#!/usr/bin/env python3
"""
store_search.py — Semantic search over vcro-store section files.

Usage:
  python3 store_search.py <query> [options]

Options:
  --store <path>      Store directory (default: vcro-store-test)
  --top <n>           Number of results (default: 5)
  --section <type>    Filter by section type (cohort, biospecimens, endpoints_and_modalities,
                      access_and_ownership, results_primary, limitations_and_conclusion)
  --source <type>     Filter by source type (pmc, clinicaltrials)

Uses OpenAI text-embedding-3-small if OPENAI_API_KEY is set.
Falls back to TF-IDF keyword matching if no API key (still useful, just not semantic).

Examples:
  python3 store_search.py "medication confounding statins"
  python3 store_search.py "longitudinal dropout attrition" --section cohort --top 3
  python3 store_search.py "commercial data access DUA" --section access_and_ownership
  python3 store_search.py "sample storage temperature fasting" --section biospecimens
"""

import json
import os
import sys
import math
import re
import urllib.request


def get_api_key():
    # Check env first, then file
    key = os.environ.get("OPENAI_API_KEY", "")
    if key:
        return key
    for path in [
        os.path.expanduser("~/.openclaw/workspace/.openai-key"),
        os.path.join(os.path.dirname(__file__), "../../../.openai-key"),
    ]:
        if os.path.exists(path):
            return open(path).read().strip()
    return ""


def embed_openai(texts, api_key):
    """Embed texts using OpenAI text-embedding-3-small."""
    url = "https://api.openai.com/v1/embeddings"
    body = json.dumps({
        "model": "text-embedding-3-small",
        "input": texts,
    }).encode()
    
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")
    
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read())
    
    return [item["embedding"] for item in data["data"]]


def cosine_sim(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0
    return dot / (norm_a * norm_b)


def tfidf_search(query, documents):
    """Simple TF-IDF fallback when no API key."""
    query_terms = set(re.findall(r'\w+', query.lower()))
    
    # Document frequency
    df = {}
    for doc_text in documents:
        doc_terms = set(re.findall(r'\w+', doc_text.lower()))
        for term in doc_terms:
            df[term] = df.get(term, 0) + 1
    
    n_docs = len(documents)
    scores = []
    
    for doc_text in documents:
        doc_lower = doc_text.lower()
        doc_terms = re.findall(r'\w+', doc_lower)
        doc_len = len(doc_terms) or 1
        
        score = 0
        for term in query_terms:
            tf = doc_terms.count(term) / doc_len
            idf = math.log((n_docs + 1) / (df.get(term, 0) + 1))
            score += tf * idf
        
        scores.append(score)
    
    return scores


def collect_sections(store_path, section_filter=None, source_filter=None):
    """Walk the store and collect section files with metadata."""
    sections = []
    
    sources_dir = os.path.join(store_path, "sources")
    if not os.path.exists(sources_dir):
        return sections
    
    for source_type in os.listdir(sources_dir):
        if source_filter and source_type != source_filter:
            continue
        
        source_dir = os.path.join(sources_dir, source_type)
        if not os.path.isdir(source_dir):
            continue
        
        for entry_id in os.listdir(source_dir):
            entry_dir = os.path.join(source_dir, entry_id)
            if not os.path.isdir(entry_dir):
                continue
            
            # Read meta if available
            meta = {}
            meta_path = os.path.join(entry_dir, "meta.json")
            if os.path.exists(meta_path):
                try:
                    meta = json.load(open(meta_path))
                except:
                    pass
            
            # Read section files
            for filename in os.listdir(entry_dir):
                if not filename.endswith(".txt"):
                    continue
                
                section_name = filename[:-4]  # remove .txt
                if section_filter and section_name != section_filter:
                    continue
                
                filepath = os.path.join(entry_dir, filename)
                try:
                    text = open(filepath).read()
                except:
                    continue
                
                if len(text.strip()) < 20:
                    continue
                
                sections.append({
                    "source_type": source_type,
                    "entry_id": entry_id,
                    "section": section_name,
                    "title": meta.get("title", ""),
                    "first_author": meta.get("first_author", ""),
                    "text": text,
                    "path": filepath,
                })
    
    return sections


def main():
    args = sys.argv[1:]
    
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    
    query = args[0]
    store_path = None
    top_n = 5
    section_filter = None
    source_filter = None
    
    i = 1
    while i < len(args):
        if args[i] == "--store" and i + 1 < len(args):
            store_path = args[i + 1]; i += 2
        elif args[i] == "--top" and i + 1 < len(args):
            top_n = int(args[i + 1]); i += 2
        elif args[i] == "--section" and i + 1 < len(args):
            section_filter = args[i + 1]; i += 2
        elif args[i] == "--source" and i + 1 < len(args):
            source_filter = args[i + 1]; i += 2
        else:
            i += 1
    
    # Default store path
    if not store_path:
        for candidate in [
            os.path.expanduser("~/.openclaw/workspace/vcro-store-test"),
            os.path.expanduser("~/.openclaw/workspace/vcro-store"),
        ]:
            if os.path.exists(candidate):
                store_path = candidate
                break
    
    if not store_path or not os.path.exists(store_path):
        print("Error: store not found. Use --store <path>")
        sys.exit(1)
    
    # Collect sections
    sections = collect_sections(store_path, section_filter, source_filter)
    
    if not sections:
        print("No sections found matching filters.")
        return
    
    # Truncate texts for embedding (max ~500 tokens per section)
    texts = [s["text"][:2000] for s in sections]
    
    api_key = get_api_key()
    
    if api_key:
        # Semantic search via OpenAI embeddings
        try:
            # Embed query + all texts in one batch
            all_texts = [query] + texts
            
            # Batch in groups of 100 (API limit is 2048)
            all_embeddings = []
            for batch_start in range(0, len(all_texts), 100):
                batch = all_texts[batch_start:batch_start + 100]
                batch_embeddings = embed_openai(batch, api_key)
                all_embeddings.extend(batch_embeddings)
            
            query_emb = all_embeddings[0]
            doc_embs = all_embeddings[1:]
            
            scores = [cosine_sim(query_emb, doc_emb) for doc_emb in doc_embs]
            method = "semantic (text-embedding-3-small)"
        except Exception as e:
            print(f"Warning: OpenAI embedding failed ({e}), falling back to TF-IDF")
            scores = tfidf_search(query, texts)
            method = "keyword (TF-IDF fallback)"
    else:
        scores = tfidf_search(query, texts)
        method = "keyword (TF-IDF, no API key)"
    
    # Rank by score
    ranked = sorted(range(len(sections)), key=lambda i: -scores[i])
    
    print(f"Query: \"{query}\"")
    print(f"Method: {method}")
    print(f"Searched: {len(sections)} sections in {store_path}")
    print()
    
    for rank, idx in enumerate(ranked[:top_n]):
        s = sections[idx]
        score = scores[idx]
        
        # Show snippet around best matching area
        text_lower = s["text"].lower()
        query_terms = query.lower().split()
        
        # Find first occurrence of any query term for snippet
        best_pos = 0
        for term in query_terms:
            pos = text_lower.find(term)
            if pos >= 0:
                best_pos = pos
                break
        
        start = max(0, best_pos - 100)
        end = min(len(s["text"]), best_pos + 300)
        snippet = s["text"][start:end].replace("\n", " ").strip()
        if start > 0:
            snippet = "..." + snippet
        if end < len(s["text"]):
            snippet = snippet + "..."
        
        title_str = f" | {s['title'][:60]}" if s["title"] else ""
        author_str = f" | {s['first_author']}" if s["first_author"] else ""
        
        print(f"  [{rank+1}] score={score:.3f} | {s['entry_id']}/{s['section']}{title_str}{author_str}")
        print(f"      {snippet[:250]}")
        print()


if __name__ == "__main__":
    main()
