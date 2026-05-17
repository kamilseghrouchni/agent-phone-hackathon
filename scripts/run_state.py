#!/usr/bin/env python3
"""
run_state.py — Track vCRO pipeline run state for crash recovery.

Usage:
  python3 run_state.py <run_dir> init <request_json_path>
  python3 run_state.py <run_dir> start <phase>
  python3 run_state.py <run_dir> complete <phase> [--artifact <path>]...
  python3 run_state.py <run_dir> fail <phase> [--reason <text>]
  python3 run_state.py <run_dir> skip <phase> [reason]
  python3 run_state.py <run_dir> set <key> <value>
  python3 run_state.py <run_dir> status
  python3 run_state.py <run_dir> next

Optional phases (can be skipped without blocking next()):
  notion_create, tangential, context_package

Phases (in order):
  understand, notion_create, search, validate, tangential,
  pmid_map, section_fetch, extract, signal, contacts,
  provider, access, rank, deliver, context_package

The state file is <run_dir>/run_state.json.

Examples:
  # Initialize a new run
  python3 run_state.py ./runs/20260329_test init ./runs/20260329_test/request.json

  # Mark search phase as started
  python3 run_state.py ./runs/20260329_test start search

  # Mark search as complete with artifact
  python3 run_state.py ./runs/20260329_test complete search --artifact pubmed_results.json

  # Check current status
  python3 run_state.py ./runs/20260329_test status

  # Get next phase to run
  python3 run_state.py ./runs/20260329_test next

  # Set a custom key (e.g. tangential decision)
  python3 run_state.py ./runs/20260329_test set tangential_decision "strict AD/ALS only"
"""

import json
import sys
import os
from datetime import datetime, timezone


PHASES = [
    "understand",
    "notion_create",
    "search",
    "validate",
    "tangential",
    "pmid_map",
    "section_fetch",
    "extract",
    "signal",
    "contacts",
    "provider",
    "access",
    "rank",
    "deliver",
    "context_package",
]

# Phases that are optional and can be skipped without blocking next()
OPTIONAL_PHASES = {"notion_create", "tangential", "context_package"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_state(run_dir):
    path = os.path.join(run_dir, "run_state.json")
    if os.path.exists(path):
        return json.load(open(path))
    return None


def save_state(run_dir, state):
    path = os.path.join(run_dir, "run_state.json")
    os.makedirs(run_dir, exist_ok=True)
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def cmd_init(run_dir, request_path):
    state = {
        "run_id": os.path.basename(run_dir),
        "created": now_iso(),
        "updated": now_iso(),
        "request": request_path,
        "current_phase": None,
        "phases": {},
        "artifacts": {},
        "custom": {},
    }
    
    # Initialize all phases as pending
    for phase in PHASES:
        state["phases"][phase] = {
            "status": "pending",
            "started": None,
            "completed": None,
            "failed": None,
            "fail_reason": None,
        }
    
    save_state(run_dir, state)
    print(f"Initialized run state: {os.path.join(run_dir, 'run_state.json')}")
    print(f"Run ID: {state['run_id']}")
    print(f"Phases: {len(PHASES)} ({PHASES[0]} -> {PHASES[-1]})")


def cmd_start(run_dir, phase):
    state = load_state(run_dir)
    if not state:
        print("Error: no run_state.json found. Run 'init' first.")
        sys.exit(1)
    
    if phase not in state["phases"]:
        print(f"Error: unknown phase '{phase}'. Valid: {', '.join(PHASES)}")
        sys.exit(1)
    
    state["phases"][phase]["status"] = "running"
    state["phases"][phase]["started"] = now_iso()
    state["current_phase"] = phase
    state["updated"] = now_iso()
    
    save_state(run_dir, state)
    print(f"Phase '{phase}' started at {state['phases'][phase]['started']}")


def cmd_complete(run_dir, phase, artifacts=None):
    state = load_state(run_dir)
    if not state:
        print("Error: no run_state.json found.")
        sys.exit(1)
    
    state["phases"][phase]["status"] = "completed"
    state["phases"][phase]["completed"] = now_iso()
    state["updated"] = now_iso()
    
    if artifacts:
        for artifact in artifacts:
            state["artifacts"][artifact] = {
                "phase": phase,
                "created": now_iso(),
            }
    
    # Find next pending phase
    next_phase = None
    for p in PHASES:
        if state["phases"][p]["status"] == "pending":
            next_phase = p
            break
    
    state["current_phase"] = next_phase
    save_state(run_dir, state)
    
    started = state["phases"][phase].get("started")
    completed = state["phases"][phase]["completed"]
    
    artifact_str = f" | artifacts: {', '.join(artifacts)}" if artifacts else ""
    next_str = f" | next: {next_phase}" if next_phase else " | ALL PHASES COMPLETE"
    print(f"Phase '{phase}' completed{artifact_str}{next_str}")


def cmd_fail(run_dir, phase, reason=None):
    state = load_state(run_dir)
    if not state:
        print("Error: no run_state.json found.")
        sys.exit(1)
    
    state["phases"][phase]["status"] = "failed"
    state["phases"][phase]["failed"] = now_iso()
    state["phases"][phase]["fail_reason"] = reason
    state["updated"] = now_iso()
    
    save_state(run_dir, state)
    reason_str = f": {reason}" if reason else ""
    print(f"Phase '{phase}' FAILED{reason_str}")


def cmd_skip(run_dir, phase, reason=None):
    state = load_state(run_dir)
    if not state:
        print("Error: no run_state.json found.")
        sys.exit(1)

    if phase not in OPTIONAL_PHASES:
        print(f"Error: '{phase}' is not an optional phase. Cannot skip mandatory phases.")
        print(f"Optional phases: {', '.join(sorted(OPTIONAL_PHASES))}")
        sys.exit(1)

    state["phases"][phase]["status"] = "skipped"
    state["phases"][phase]["completed"] = now_iso()
    state["phases"][phase]["fail_reason"] = reason or "skipped by orchestrator"
    state["updated"] = now_iso()

    # Find next pending non-optional or non-skipped phase
    next_phase = None
    for p in PHASES:
        s = state["phases"][p]["status"]
        if s in ("pending", "failed"):
            if p in OPTIONAL_PHASES:
                continue
            next_phase = p
            break

    state["current_phase"] = next_phase
    save_state(run_dir, state)
    reason_str = f" ({reason})" if reason else ""
    next_str = f" | next: {next_phase}" if next_phase else " | ALL PHASES COMPLETE"
    print(f"Phase '{phase}' skipped{reason_str}{next_str}")


def cmd_set(run_dir, key, value):
    state = load_state(run_dir)
    if not state:
        print("Error: no run_state.json found.")
        sys.exit(1)
    
    state["custom"][key] = value
    state["updated"] = now_iso()
    save_state(run_dir, state)
    print(f"Set {key} = {value}")


def cmd_status(run_dir):
    state = load_state(run_dir)
    if not state:
        print("Error: no run_state.json found.")
        sys.exit(1)
    
    print(f"Run: {state['run_id']}")
    print(f"Created: {state['created']}")
    print(f"Updated: {state['updated']}")
    print(f"Current phase: {state.get('current_phase', 'none')}")
    print()
    
    for phase in PHASES:
        info = state["phases"][phase]
        status = info["status"]
        
        if status == "completed":
            marker = "✓"
        elif status == "running":
            marker = "▶"
        elif status == "failed":
            marker = "✗"
        elif status == "skipped":
            marker = "○"
        else:
            marker = "·"
        
        extra = ""
        if info.get("fail_reason"):
            extra = f" ({info['fail_reason']})"
        
        print(f"  {marker} {phase}: {status}{extra}")
    
    if state.get("artifacts"):
        print(f"\nArtifacts: {', '.join(state['artifacts'].keys())}")
    
    if state.get("custom"):
        print(f"\nCustom: {json.dumps(state['custom'])}")


def cmd_next(run_dir):
    state = load_state(run_dir)
    if not state:
        print("Error: no run_state.json found.")
        sys.exit(1)

    for phase in PHASES:
        if state["phases"][phase]["status"] in ("pending", "failed"):
            # Skip optional phases that were never started — don't block on them
            if phase in OPTIONAL_PHASES and state["phases"][phase]["status"] == "pending":
                continue
            print(phase)
            return

    print("ALL_COMPLETE")


def main():
    args = sys.argv[1:]
    
    if len(args) < 2 or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    
    run_dir = args[0]
    command = args[1]
    
    if command == "init":
        request_path = args[2] if len(args) > 2 else "request.json"
        cmd_init(run_dir, request_path)
    
    elif command == "start":
        if len(args) < 3:
            print("Error: phase name required")
            sys.exit(1)
        cmd_start(run_dir, args[2])
    
    elif command == "complete":
        if len(args) < 3:
            print("Error: phase name required")
            sys.exit(1)
        phase = args[2]
        artifacts = []
        i = 3
        while i < len(args):
            if args[i] == "--artifact" and i + 1 < len(args):
                artifacts.append(args[i + 1])
                i += 2
            else:
                i += 1
        cmd_complete(run_dir, phase, artifacts if artifacts else None)
    
    elif command == "fail":
        if len(args) < 3:
            print("Error: phase name required")
            sys.exit(1)
        phase = args[2]
        reason = None
        i = 3
        while i < len(args):
            if args[i] == "--reason" and i + 1 < len(args):
                reason = args[i + 1]
                i += 2
            else:
                i += 1
        cmd_fail(run_dir, phase, reason)

    elif command == "skip":
        if len(args) < 3:
            print("Error: phase name required")
            sys.exit(1)
        phase = args[2]
        reason = args[3] if len(args) > 3 else None
        cmd_skip(run_dir, phase, reason)
    
    elif command == "set":
        if len(args) < 4:
            print("Error: key and value required")
            sys.exit(1)
        cmd_set(run_dir, args[2], args[3])
    
    elif command == "status":
        cmd_status(run_dir)
    
    elif command == "next":
        cmd_next(run_dir)
    
    else:
        print(f"Error: unknown command '{command}'")
        print("Valid commands: init, start, complete, fail, set, status, next")
        sys.exit(1)


if __name__ == "__main__":
    main()
