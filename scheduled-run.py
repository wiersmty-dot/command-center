#!/usr/bin/env python3
"""Bridge a local launchd schedule into the Command Center's audited run API."""
import json
import sys
import urllib.request


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Expected the schedule spec path.")
    with open(sys.argv[1], encoding="utf-8") as fh:
        spec = json.load(fh)
    payload = json.dumps({
        "skill": "scheduled",
        "label": spec["title"],
        "prompt": spec["prompt"],
    }).encode("utf-8")
    request = urllib.request.Request(
        "http://127.0.0.1:7777/api/run", data=payload,
        headers={"Content-Type": "application/json", "Host": "127.0.0.1:7777"}, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        print(response.read().decode("utf-8"))


if __name__ == "__main__":
    main()
