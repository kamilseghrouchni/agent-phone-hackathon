#!/usr/bin/env python3
"""
progress_watch.py — Live progress viewer for vCRO pipeline runs.

Tails progress.jsonl and prints outcome-focused findings as they emerge.
Run in a separate terminal while the pipeline executes.

Usage:
  python3 scripts/progress_watch.py store/runs/{run_id}
  python3 scripts/progress_watch.py store/runs/{run_id} --poll 5

The pipeline subagents append lines to progress.jsonl as they discover
findings. This script reads them and formats for human consumption.
"""

import json
import os
import sys
import time
from datetime import datetime


ICONS = {
    "finding": "\U0001f4a1",   # 💡
    "progress": "\u2705",      # ✅
    "question": "\u2753",      # ❓
    "error": "\u274c",         # ❌
    "start": "\U0001f50d",     # 🔍
}


def format_time(ts_str, start_time=None):
    """Format timestamp as relative minutes or absolute time."""
    try:
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if start_time:
            delta = ts - start_time
            mins = int(delta.total_seconds() // 60)
            secs = int(delta.total_seconds() % 60)
            return f"[{mins:02d}:{secs:02d}]"
        return ts.strftime("[%H:%M]")
    except (ValueError, TypeError):
        return "[--:--]"


def print_entry(entry, start_time=None):
    """Print a single progress entry."""
    ts = format_time(entry.get("ts", ""), start_time)
    event = entry.get("event", "progress")
    icon = ICONS.get(event, "\u2022")
    phase = entry.get("phase", "")
    message = entry.get("message", "")

    # Color based on event type
    if event == "finding":
        print(f"  {ts} {icon} {message}")
    elif event == "question":
        print(f"  {ts} {icon} NEEDS INPUT: {message}")
    elif event == "error":
        print(f"  {ts} {icon} ERROR [{phase}]: {message}")
    else:
        print(f"  {ts} {icon} {message}")


def tail_progress(run_dir, poll_interval=2):
    """Tail progress.jsonl and print new entries."""
    progress_file = os.path.join(run_dir, "progress.jsonl")
    state_file = os.path.join(run_dir, "run_state.json")

    # Get run start time for relative timestamps
    start_time = None
    if os.path.exists(state_file):
        try:
            state = json.load(open(state_file))
            ts = state.get("created", "")
            start_time = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            run_id = state.get("run_id", os.path.basename(run_dir))
            print(f"  Watching: {run_id}")
            print(f"  Started:  {ts}")
            print()
        except (json.JSONDecodeError, ValueError):
            pass

    # Read existing entries
    lines_read = 0
    if os.path.exists(progress_file):
        with open(progress_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    print_entry(entry, start_time)
                    lines_read += 1
                except json.JSONDecodeError:
                    pass

    if lines_read > 0:
        print()

    # Tail for new entries
    print("  Watching for new findings... (Ctrl+C to stop)")
    print()

    last_size = os.path.getsize(progress_file) if os.path.exists(progress_file) else 0

    try:
        while True:
            time.sleep(poll_interval)

            if not os.path.exists(progress_file):
                continue

            current_size = os.path.getsize(progress_file)
            if current_size <= last_size:
                # Check if run is complete
                if os.path.exists(state_file):
                    try:
                        state = json.load(open(state_file))
                        deliver = state.get("phases", {}).get("deliver", {})
                        if deliver.get("status") == "completed":
                            print("  ✅ Run complete.")
                            break
                    except (json.JSONDecodeError, KeyError):
                        pass
                continue

            # Read new lines
            with open(progress_file) as f:
                all_lines = f.readlines()

            for line in all_lines[lines_read:]:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    print_entry(entry, start_time)
                    lines_read += 1
                except json.JSONDecodeError:
                    pass

            last_size = current_size

    except KeyboardInterrupt:
        print("\n  Stopped watching.")


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return

    run_dir = sys.argv[1]
    poll_interval = 2

    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--poll" and i + 1 < len(args):
            poll_interval = int(args[i + 1])
            i += 2
        else:
            i += 1

    if not os.path.isdir(run_dir):
        print(f"Error: {run_dir} is not a directory")
        sys.exit(1)

    tail_progress(run_dir, poll_interval)


if __name__ == "__main__":
    main()
