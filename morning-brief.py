#!/usr/bin/env python3
"""Fire the morning brief on a schedule.

Started by com.tyler.morning-brief on weekday mornings. Reads the prompt from
skills.json so there is one source of truth: edit the button, the scheduled run
follows. Waits for the run to finish only so the outcome lands in the log —
Command Center archives the brief into the vault either way.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = json.load(open(os.path.join(BASE, "config.json"), encoding="utf-8"))
PORT = int(CONFIG.get("port", 7777))
ROOT = f"http://127.0.0.1:{PORT}"

SKILL = "morning"
CONNECT_TIMEOUT = 120   # the runner may still be starting at login
RUN_TIMEOUT = 900       # a brief takes ~3 min; well clear of that


def log(msg):
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}", flush=True)


def get(path):
    with urllib.request.urlopen(f"{ROOT}{path}", timeout=15) as r:
        return json.load(r)


def post(path, payload):
    req = urllib.request.Request(
        f"{ROOT}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def wait_for_runner():
    deadline = time.time() + CONNECT_TIMEOUT
    while time.time() < deadline:
        try:
            return get("/api/skills")
        except (urllib.error.URLError, OSError):
            time.sleep(5)
    return None


def main():
    catalog = wait_for_runner()
    if not catalog:
        log(f"FAILED — Command Center not reachable at {ROOT} after {CONNECT_TIMEOUT}s")
        return 1

    entry = next((s for s in catalog["skills"] if s["skill"] == SKILL), None)
    if not entry:
        log(f"FAILED — no '{SKILL}' entry in skills.json")
        return 1

    job = post("/api/run", {
        "skill": entry["skill"],
        "label": entry["label"],
        "prompt": entry["prompt"],
    })
    log(f"started {entry['label']} (job {job['id']})")

    deadline = time.time() + RUN_TIMEOUT
    while time.time() < deadline:
        time.sleep(10)
        try:
            state = get(f"/api/job/{job['id']}?offset=0")
        except (urllib.error.URLError, OSError) as exc:
            log(f"lost contact with the runner: {exc}")
            return 1
        if state["status"] != "running":
            note = state.get("note") or "(not archived)"
            log(f"{state['status']} in {state['elapsed']}s -> {note}")
            return 0 if state["status"] == "done" else 1

    log(f"FAILED — still running after {RUN_TIMEOUT}s; leaving it alone")
    return 1


if __name__ == "__main__":
    sys.exit(main())
