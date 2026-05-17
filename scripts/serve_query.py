#!/usr/bin/env python3
"""
serve_query.py — Lightweight HTTP server for testing vCRO agent endpoints.

Serves three endpoints:
  GET  /api/runs              — list available runs
  GET  /api/schema?run_id=X   — dynamic parameter schema for a run
  POST /api/query             — parameterized query over run artifacts

Usage:
  python3 scripts/serve_query.py [--port 8080] [--store store]

This is a throwaway test server. Replace with Next.js webapp in production.
"""

import json
import os
import sys
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

STORE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "store")


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def safe_run_id(run_id):
    """Prevent path traversal."""
    return re.sub(r"[^a-zA-Z0-9_-]", "", run_id)


def get_run_dir(run_id):
    safe = safe_run_id(run_id)
    d = os.path.join(STORE_DIR, "runs", safe)
    if not d.startswith(os.path.join(STORE_DIR, "runs")):
        return None
    if not os.path.isdir(d):
        return None
    return d


def derive_status(run_state):
    phases = run_state.get("phases", {})
    if phases.get("deliver", {}).get("status") == "completed":
        return "complete"
    for p in phases.values():
        if p.get("status") == "failed":
            return "failed"
        if p.get("status") == "running":
            return "in_progress"
    return "in_progress"


def list_runs(filters=None):
    runs_dir = os.path.join(STORE_DIR, "runs")
    if not os.path.isdir(runs_dir):
        return []
    results = []
    for entry in sorted(os.listdir(runs_dir), reverse=True):
        if entry.startswith("."):
            continue
        run_dir = os.path.join(runs_dir, entry)
        if not os.path.isdir(run_dir):
            continue
        state = read_json(os.path.join(run_dir, "run_state.json"))
        request = read_json(os.path.join(run_dir, "request.json"))
        if not state:
            continue
        status = derive_status(state)
        if filters and filters.get("status") and status != filters["status"]:
            continue
        results.append({
            "run_id": entry,
            "status": status,
            "indication": request.get("indication") if request else None,
            "use_case": request.get("use_case_type") if request else None,
            "created_at": state.get("created"),
            "one_liner": request.get("scope_notes", "")[:120] if request else None,
        })
    return results


def resolve_latest_run():
    for run in list_runs():
        if run["status"] == "complete":
            return run["run_id"]
    runs = list_runs()
    return runs[0]["run_id"] if runs else None


def execute_query(params):
    run_id = params.get("run_id") or resolve_latest_run()
    if not run_id:
        return {"error": "No runs found"}, 404

    run_dir = get_run_dir(run_id)
    if not run_dir:
        return {"error": f"Run not found: {run_id}"}, 404

    state = read_json(os.path.join(run_dir, "run_state.json"))
    request = read_json(os.path.join(run_dir, "request.json"))
    status = derive_status(state) if state else "unknown"

    # Deep dive mode
    cohort_id = params.get("cohort_id")
    if cohort_id:
        cohorts = read_json(os.path.join(run_dir, "extracted_cohorts.json")) or []
        match = [c for c in cohorts if c.get("id") == cohort_id]
        if not match:
            return {"error": f"Cohort not found: {cohort_id}"}, 404
        return {"run_id": run_id, "status": status, "cohort": match[0]}, 200

    # Load schema for resolution
    schema = read_json(os.path.join(run_dir, "endpoint_schema.json"))

    # Load available artifacts
    include = params.get("include", ["recommendations", "signal"])
    fmt = params.get("format", "full")
    top_k = params.get("top_k", 5)

    response = {
        "run_id": run_id,
        "status": status,
        "query": params,
    }

    # Load cohorts and apply decision-axis filtering
    cohorts = read_json(os.path.join(run_dir, "extracted_cohorts.json")) or []
    ranking_raw = read_json(os.path.join(run_dir, "ranking.json"))
    ranking = None
    if isinstance(ranking_raw, list):
        ranking = ranking_raw
    elif isinstance(ranking_raw, dict):
        ranking = ranking_raw.get("ranked_cohorts", ranking_raw.get("recommendations", []))

    # Apply decision-axis filtering using typed resolution rules
    if schema:
        top_resolution = schema.get("resolution", {})
        axis_resolution = {}
        for ax in schema.get("decision_axes", []):
            if "resolution" in ax:
                axis_resolution[ax["param"]] = ax["resolution"]

        for axis in schema.get("decision_axes", []):
            value = params.get(axis["param"])
            if not value:
                continue

            # Pick the rule that has actual usable data:
            # 1. Top-level with type field (new format) — best
            # 2. Axis-level with value keys (old format) — fallback
            # 3. Top-level without type (meta-description) — skip
            top_rule = top_resolution.get(axis["param"], {})
            axis_rule = axis_resolution.get(axis["param"], {})

            if top_rule.get("type"):
                rule = top_rule  # new typed format
            elif axis_rule and value in axis_rule:
                rule = axis_rule  # old format with actual values
            elif axis_rule:
                rule = axis_rule
            else:
                rule = top_rule
            rule_type = rule.get("type", "")

            # Type 1: field_match — filter by structural field on cohort
            if rule_type == "field_match":
                field = rule.get("field", "")
                cohorts = [
                    c for c in cohorts
                    if (isinstance(c.get(field), list) and value in c[field])
                    or c.get(field) == value
                ]

            # Type 2: artifact_redirect — change which sections to include
            elif rule_type == "artifact_redirect":
                redirect = rule.get("values", {}).get(value, {})
                if redirect.get("include"):
                    include = redirect["include"]

            # Type 3: text_search — fuzzy search in intelligence facts
            elif rule_type == "text_search":
                val_lower = value.lower()
                cohorts = [
                    c for c in cohorts
                    if any(
                        val_lower in i.get("fact", "").lower()
                        or val_lower in i.get("implication", "").lower()
                        for i in c.get("intelligence", [])
                    )
                ]

            # Legacy fallback: handle old schemas without type field
            else:
                value_rule = rule.get(value)
                if isinstance(value_rule, str) and "PMC" in value_rule:
                    pmc_ids = re.findall(r"PMC\d+", value_rule)
                    if pmc_ids:
                        cohorts = [c for c in cohorts if c.get("id") in pmc_ids]
                elif isinstance(value_rule, dict) and "cohorts" in value_rule:
                    cohorts = [c for c in cohorts if c.get("id") in value_rule["cohorts"]]
                    if value_rule.get("include"):
                        include = value_rule["include"]
                elif isinstance(value_rule, dict) and "include" in value_rule:
                    include = value_rule["include"]

    # Apply ranking order to filtered cohorts, then slice
    if ranking and cohorts:
        ranked_ids = [r.get("id") for r in ranking]
        # Sort filtered cohorts by their ranking position
        id_to_rank = {r.get("id"): i for i, r in enumerate(ranking)}
        cohorts.sort(key=lambda c: id_to_rank.get(c.get("id"), 9999))
    cohorts = cohorts[:top_k]

    # Format
    if fmt == "summary":
        response["recommendations"] = [
            {
                "cohort_name": ", ".join(c.get("cohorts_named", [])),
                "source_id": c.get("id"),
                "first_author": c.get("first_author"),
            }
            for c in cohorts
        ]
    elif fmt == "actionable":
        response["recommendations"] = [
            {
                "cohort_name": ", ".join(c.get("cohorts_named", [])),
                "source_id": c.get("id"),
                "first_author": c.get("first_author"),
                "intelligence_count": len(c.get("intelligence", [])),
            }
            for c in cohorts
        ]
    else:
        response["recommendations"] = cohorts

    # Include requested sections
    artifact_map = {
        "signal": "signal_summary.json",
        "access": "access_summary.json",
        "contacts": "contacts.json",
        "provider": "provider_intelligence.json",
        "exclusion_log": "validation_results.json",
        "provenance": "run_state.json",
    }
    for section in include:
        if section == "recommendations":
            continue  # already included
        if section == "intelligence" and not cohort_id:
            continue  # only in deep dive
        artifact_file = artifact_map.get(section)
        if artifact_file:
            data = read_json(os.path.join(run_dir, artifact_file))
            if data:
                response[section] = data

    # available_actions
    response["available_actions"] = []
    if len(cohorts) > 0:
        response["available_actions"].append({
            "action": "deep_dive",
            "description": f"Get full intelligence for {', '.join(cohorts[0].get('cohorts_named', []))}",
            "endpoint": "POST /api/query",
            "body": {"run_id": run_id, "cohort_id": cohorts[0].get("id"), "include": ["intelligence"]},
        })
    if schema:
        for axis in schema.get("decision_axes", []):
            for val in axis.get("values", []):
                if params.get(axis["param"]) != val:
                    response["available_actions"].append({
                        "action": f"filter_{axis['param']}",
                        "description": f"Show {val} only — {axis['why'][:60]}",
                        "endpoint": "POST /api/query",
                        "body": {"run_id": run_id, axis["param"]: val},
                    })
                    break  # one alternative per axis

    # _endpoint block
    if schema:
        response["_endpoint"] = {
            "url": "POST /api/query",
            "this_run": run_id,
            "parameters": [
                {
                    "name": axis["param"],
                    "type": axis["type"],
                    "values": axis["values"],
                    "description": axis["why"],
                }
                for axis in schema.get("decision_axes", [])
            ] + [
                {"name": "top_k", "type": "int", "default": 5, "description": "Number of cohorts"},
                {"name": "cohort_id", "type": "string", "description": "Deep dive by PMC/NCT ID"},
                {"name": "format", "type": "string", "values": ["full", "summary", "actionable"], "default": "full"},
            ],
            "examples": schema.get("examples", []),
        }

    return response, 200


class Handler(BaseHTTPRequestHandler):
    def send_json(self, data, status=200):
        body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/api/runs":
            filters = {}
            if "status" in qs:
                filters["status"] = qs["status"][0]
            runs = list_runs(filters)
            self.send_json({"runs": runs})

        elif parsed.path.startswith("/api/runs/") and parsed.path.endswith("/progress"):
            # GET /api/runs/{run_id}/progress — return progress.jsonl entries
            parts = parsed.path.split("/")
            run_id = parts[3] if len(parts) >= 5 else None
            if not run_id:
                self.send_json({"error": "run_id required"}, 400)
                return
            run_dir = get_run_dir(run_id)
            if not run_dir:
                self.send_json({"error": f"Run not found: {run_id}"}, 404)
                return
            progress_file = os.path.join(run_dir, "progress.jsonl")
            entries = []
            if os.path.exists(progress_file):
                with open(progress_file) as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                entries.append(json.loads(line))
                            except json.JSONDecodeError:
                                pass
            # Include run status
            state = read_json(os.path.join(run_dir, "run_state.json"))
            self.send_json({
                "run_id": run_id,
                "status": derive_status(state) if state else "unknown",
                "entries": entries,
                "total": len(entries),
            })

        elif parsed.path.startswith("/api/runs/") and "/progress" not in parsed.path:
            # GET /api/runs/{run_id} — return run status + artifact list
            parts = parsed.path.split("/")
            run_id = parts[3] if len(parts) >= 4 else None
            if not run_id:
                self.send_json({"error": "run_id required"}, 400)
                return
            run_dir = get_run_dir(run_id)
            if not run_dir:
                self.send_json({"error": f"Run not found: {run_id}"}, 404)
                return
            state = read_json(os.path.join(run_dir, "run_state.json"))
            request = read_json(os.path.join(run_dir, "request.json"))
            artifacts = [f for f in os.listdir(run_dir) if f.endswith(".json") or f.endswith(".md")]
            self.send_json({
                "run_id": run_id,
                "status": derive_status(state) if state else "unknown",
                "phases": {p: v["status"] for p, v in state.get("phases", {}).items()} if state else {},
                "request": request,
                "artifacts": sorted(artifacts),
            })

        elif parsed.path == "/api/schema":
            run_id = qs.get("run_id", [None])[0] or resolve_latest_run()
            if not run_id:
                self.send_json({"error": "No runs found"}, 404)
                return
            run_dir = get_run_dir(run_id)
            if not run_dir:
                self.send_json({"error": f"Run not found: {run_id}"}, 404)
                return
            schema = read_json(os.path.join(run_dir, "endpoint_schema.json"))
            if not schema:
                # Fallback: return fixed params only
                schema = {
                    "run_id": run_id,
                    "one_liner": "No endpoint schema generated for this run",
                    "decision_axes": [],
                    "fixed_params": {
                        "run_id": {"type": "string", "default": run_id},
                        "top_k": {"type": "integer", "default": 5},
                        "cohort_id": {"type": "string"},
                        "format": {"type": "string", "default": "full", "enum": ["full", "summary", "actionable"]},
                    },
                }
            self.send_json(schema)

        else:
            self.send_json({"error": "Not found", "available": [
                "GET  /api/runs",
                "GET  /api/runs/{run_id}",
                "GET  /api/runs/{run_id}/progress",
                "GET  /api/schema?run_id=X",
                "POST /api/query",
            ]}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/query":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            result, status = execute_query(body)
            self.send_json(result, status)
        else:
            self.send_json({"error": "Not found. Use POST /api/query"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        sys.stderr.write(f"[serve_query] {args[0]}\n")


def main():
    global STORE_DIR
    port = 8080

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        elif args[i] == "--store" and i + 1 < len(args):
            STORE_DIR = os.path.abspath(args[i + 1])
            i += 2
        else:
            i += 1

    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"vCRO query server running on http://localhost:{port}")
    print(f"Store: {STORE_DIR}")
    print()
    print(f"  GET  http://localhost:{port}/api/runs")
    print(f"  GET  http://localhost:{port}/api/runs/{{run_id}}")
    print(f"  GET  http://localhost:{port}/api/runs/{{run_id}}/progress")
    print(f"  GET  http://localhost:{port}/api/schema")
    print(f"  POST http://localhost:{port}/api/query")
    print()
    print("Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
