#!/usr/bin/env python3
"""
store_query.py — Query JSON files in the vcro store.

Usage:
  python3 store_query.py <file> [options]

Options:
  --field <path>          Dot-separated field path to filter on (e.g. "intelligence.dimension")
  --contains <text>       Text search (case-insensitive) within the field value
  --gt <number>           Numeric greater-than filter on field
  --lt <number>           Numeric less-than filter on field
  --eq <value>            Exact match on field value
  --exists <path>         Only return entries where this field path exists and is non-empty
  --select <fields>       Comma-separated fields to output (e.g. "id,cohorts_named,n_total")
  --count                 Just return the count of matching entries
  --limit <n>             Max entries to return (default: all)
  --search <text>         Full-text search across ALL fields (case-insensitive)
  --format json|text      Output format (default: text for readability)

Examples:
  # Find cohorts mentioning "statin" anywhere
  python3 store_query.py extracted_cohorts.json --search statin

  # Find cohorts with AUC > 0.8 in intelligence
  python3 store_query.py extracted_cohorts.json --field intelligence.fact --contains "AUC" --contains "0.9"

  # Count cohorts with longitudinal structure dimension
  python3 store_query.py extracted_cohorts.json --field intelligence.dimension --eq longitudinal_structure --count

  # Get IDs and names of cohorts with >5 intelligence dimensions
  python3 store_query.py extracted_cohorts.json --select id,cohorts_named --field intelligence --gt 5

  # Search contacts for a PI name
  python3 store_query.py contacts.json --search "Feldman"

  # Find all access statements mentioning "commercial"
  python3 store_query.py extracted_cohorts.json --field intelligence.dimension --eq access_and_consent --field intelligence.fact --contains commercial
"""

import json
import sys
import os


def get_nested(obj, path):
    """Get value at a dot-separated path. Returns list if traversing arrays."""
    parts = path.split(".")
    current = [obj]
    
    for part in parts:
        next_level = []
        for item in current:
            if isinstance(item, dict):
                val = item.get(part)
                if val is not None:
                    if isinstance(val, list):
                        next_level.extend(val)
                    else:
                        next_level.append(val)
            elif isinstance(item, list):
                for sub in item:
                    if isinstance(sub, dict):
                        val = sub.get(part)
                        if val is not None:
                            if isinstance(val, list):
                                next_level.extend(val)
                            else:
                                next_level.append(val)
        current = next_level
    
    return current


def text_repr(obj):
    """Recursively convert object to searchable text."""
    if isinstance(obj, str):
        return obj
    elif isinstance(obj, (int, float)):
        return str(obj)
    elif isinstance(obj, list):
        return " ".join(text_repr(x) for x in obj)
    elif isinstance(obj, dict):
        return " ".join(text_repr(v) for v in obj.values())
    return ""


def matches_filter(entry, field_path, contains=None, gt=None, lt=None, eq=None):
    """Check if entry matches the filter criteria."""
    values = get_nested(entry, field_path)
    
    if not values:
        return False
    
    # For --gt on a list field (like intelligence), compare length
    if gt is not None and field_path.count(".") == 0:
        if isinstance(entry.get(field_path), list):
            return len(entry[field_path]) > gt
    
    for val in values:
        if contains is not None:
            text = text_repr(val).lower()
            if contains.lower() in text:
                return True
        
        if eq is not None:
            if str(val).lower() == str(eq).lower():
                return True
        
        if gt is not None:
            try:
                if float(val) > float(gt):
                    return True
            except (ValueError, TypeError):
                pass
        
        if lt is not None:
            try:
                if float(val) < float(lt):
                    return True
            except (ValueError, TypeError):
                pass
    
    if contains is None and eq is None and gt is None and lt is None:
        return True  # field exists and has values
    
    return False


def format_entry(entry, select_fields=None):
    """Format an entry for text output."""
    if select_fields:
        parts = []
        for field in select_fields:
            vals = get_nested(entry, field)
            if vals:
                val_str = ", ".join(str(v)[:100] for v in vals[:3])
                parts.append(f"{field}: {val_str}")
            else:
                parts.append(f"{field}: -")
        return " | ".join(parts)
    else:
        # Default: show id + first few key fields
        eid = entry.get("id", entry.get("name", entry.get("nct_id", "?")))
        lines = [f"--- {eid} ---"]
        for key, val in entry.items():
            if key == "intelligence":
                lines.append(f"  intelligence: {len(val)} dimensions")
                for dim in val[:3]:
                    d = dim.get("dimension", "?")
                    f = dim.get("fact", "")[:120]
                    lines.append(f"    [{d}] {f}")
                if len(val) > 3:
                    lines.append(f"    ... +{len(val)-3} more")
            elif isinstance(val, str) and len(val) > 200:
                lines.append(f"  {key}: {val[:200]}...")
            elif isinstance(val, list) and len(val) > 5:
                lines.append(f"  {key}: [{len(val)} items]")
            else:
                lines.append(f"  {key}: {val}")
        return "\n".join(lines)


def main():
    args = sys.argv[1:]
    
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    
    filepath = args[0]
    if not os.path.isabs(filepath):
        # Try common locations
        for prefix in ["", os.getcwd() + "/"]:
            candidate = prefix + filepath
            if os.path.exists(candidate):
                filepath = candidate
                break
    
    if not os.path.exists(filepath):
        print(f"Error: file not found: {filepath}")
        sys.exit(1)
    
    # Parse options
    field_path = None
    contains_list = []
    gt = None
    lt = None
    eq = None
    exists_path = None
    select_fields = None
    count_only = False
    limit = None
    search_text = None
    output_format = "text"
    
    i = 1
    while i < len(args):
        arg = args[i]
        if arg == "--field" and i + 1 < len(args):
            field_path = args[i + 1]; i += 2
        elif arg == "--contains" and i + 1 < len(args):
            contains_list.append(args[i + 1]); i += 2
        elif arg == "--gt" and i + 1 < len(args):
            gt = float(args[i + 1]); i += 2
        elif arg == "--lt" and i + 1 < len(args):
            lt = float(args[i + 1]); i += 2
        elif arg == "--eq" and i + 1 < len(args):
            eq = args[i + 1]; i += 2
        elif arg == "--exists" and i + 1 < len(args):
            exists_path = args[i + 1]; i += 2
        elif arg == "--select" and i + 1 < len(args):
            select_fields = args[i + 1].split(","); i += 2
        elif arg == "--count":
            count_only = True; i += 1
        elif arg == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1]); i += 2
        elif arg == "--search" and i + 1 < len(args):
            search_text = args[i + 1]; i += 2
        elif arg == "--format" and i + 1 < len(args):
            output_format = args[i + 1]; i += 2
        else:
            i += 1
    
    # Load data
    with open(filepath) as f:
        data = json.load(f)
    
    # Ensure we have a list
    if isinstance(data, dict):
        # Try to find the main list in common structures
        if "results" in data:
            entries = data["results"]
        elif "cohorts" in data:
            entries = data["cohorts"]
        elif "contacts" in data:
            entries = data["contacts"]
        else:
            entries = [data]
    elif isinstance(data, list):
        entries = data
    else:
        print(f"Error: unexpected data type: {type(data)}")
        sys.exit(1)
    
    # Filter
    results = []
    for entry in entries:
        match = True
        
        # Full-text search
        if search_text:
            full_text = text_repr(entry).lower()
            if search_text.lower() not in full_text:
                match = False
        
        # Field-based filters
        if match and field_path:
            for ct in (contains_list if contains_list else [None]):
                if not matches_filter(entry, field_path, contains=ct, gt=gt, lt=lt, eq=eq):
                    match = False
                    break
        
        if match and exists_path:
            vals = get_nested(entry, exists_path)
            if not vals:
                match = False
        
        if match:
            results.append(entry)
    
    # Output
    if count_only:
        print(f"{len(results)} matches (of {len(entries)} total)")
        return
    
    if limit:
        results = results[:limit]
    
    if output_format == "json":
        print(json.dumps(results, indent=2)[:50000])
    else:
        print(f"{len(results)} matches (of {len(entries)} total)\n")
        for entry in results:
            print(format_entry(entry, select_fields))
            print()


if __name__ == "__main__":
    main()
