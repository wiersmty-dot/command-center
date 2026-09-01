#!/usr/bin/env python3
"""Project the venture workspace into Postgres.

The markdown files stay the source of truth. This reads them and upserts a
projection so the studio can be read from somewhere that is not this laptop.
Nothing here is authoritative and nothing reads back into the workspace --
inbound approvals arrive as `intents` rows and are applied by the server,
through the same code the outbox uses, so the records keep one writer.

    mirror.py --print          parse only, emit the payload as JSON
    mirror.py                  parse and push

⚠️ Two failure modes are treated as errors rather than as empty results:

  * macOS intermittently refuses this process permission to ENUMERATE
    ~/Documents while still allowing it to open files. A directory walk then
    returns nothing, and mirroring that would wipe good rows with an empty
    projection. `--min-records` refuses any push that collapses the record
    count.
  * The Supabase project can pause on inactivity. A failed push is reported,
    never swallowed, or the mirror silently goes stale -- the same class of bug
    that had the ID allocator offering LED-001 over a directory of eighteen.
"""

import argparse
import json
import os
import re
import sys
import time
import ssl
import urllib.error
import urllib.parse
import urllib.request

# ⚠️ Not every python3 on this Mac has a CA bundle. The python.org framework
# build ships none and has no certifi, so every HTTPS call fails
# CERTIFICATE_VERIFY_FAILED while the CommandLineTools build (the one launchd
# uses for the other jobs) works fine. Prefer certifi, fall back to the default
# context, so the script behaves the same whichever interpreter starts it.
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = ssl.create_default_context()

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = json.load(open(os.path.join(BASE, "config.json"), encoding="utf-8"))
WORKSPACE = os.path.expanduser(CONFIG.get("venture_workspace", ""))
SUPA = CONFIG.get("supabase", {})

RECORD_DIRS = {"leads": "lead", "records": "evidence", "theses": "thesis"}
# templates/ holds the blank carrying the marker; agents/ holds the charter that
# mandates it. Neither is a record.

HEADER = re.compile(r"^\*\*([^*]+?):\*\*\s*(.+?)\s*$", re.M)
TITLE = re.compile(r"^#\s+(.+?)\s*$", re.M)
ID_IN_NAME = re.compile(r"\b(OPP|EVD|LED|EXP|PRT|DEC)-(\d+)")
PIPE_ROW = re.compile(
    r"^\|\s*\[(OPP-\d+)\]\(([^)]*)\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|",
    re.M)
DEC_ROW = re.compile(r"^\|\s*(DEC-\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|", re.M)


def log(msg):
    print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)


def ws(*parts):
    return os.path.join(WORKSPACE, *parts)


def headers_of(body):
    return {k.strip().lower(): v.strip() for k, v in HEADER.findall(body)}


def a_date(v):
    """The first YYYY-MM-DD in a header value, or None. These fields carry prose."""
    m = re.search(r"\d{4}-\d{2}-\d{2}", v or "")
    return m.group(0) if m else None


def parse_opportunities():
    txt = open(ws("records", "opportunity-pipeline.md"), encoding="utf-8").read()
    out = []
    for m in PIPE_ROW.finditer(txt):
        out.append({
            "id": m.group(1),
            "record_path": m.group(2).strip(),
            "name": m.group(3).strip(),
            "stage": m.group(4).strip(),
            "next_proof": m.group(5).strip(),
            "owner": m.group(6).strip(),
            "due": a_date(m.group(7)),
            "approval": m.group(8).strip(),
        })
    return out


def parse_decisions():
    txt = open(ws("records", "decision-log.md"), encoding="utf-8").read()
    out = []
    for m in DEC_ROW.finditer(txt):
        out.append({
            "id": m.group(1),
            "decided_on": a_date(m.group(2)),
            "opportunity": m.group(3).strip(),
            "decision": m.group(4).strip(),
            "scope": m.group(5).strip(),
            "owner": m.group(6).strip(),
            "evidence": m.group(7).strip(),
        })
    return out


# The two ledgers are already their own tables; they are not records.
LEDGERS = {"records/decision-log.md", "records/opportunity-pipeline.md"}
# Prefixes that mean the file IS that record. OPP-### in leads/ or records/
# names the opportunity a brief is ABOUT, which is not the same thing -- five
# files derive "OPP-001" and only the thesis is it.
SELF_ID = ("LED", "EVD", "PRT", "EXP")


def parse_records():
    out = []
    for sub, kind in RECORD_DIRS.items():
        root = ws(sub)
        names = sorted(os.listdir(root))          # raises if enumeration is denied
        for name in names:
            if not name.endswith(".md"):
                continue
            path = os.path.join(root, name)
            body = open(path, encoding="utf-8").read()
            st = os.stat(path)
            rel = f"{sub}/{name}"
            if rel in LEDGERS:
                continue
            h = headers_of(body)
            title = TITLE.search(body)
            ident = ID_IN_NAME.search(name)
            status = h.get("status", "")

            record_id = None
            if ident:
                pref, num = ident.group(1), f"{ident.group(1)}-{ident.group(2)}"
                if pref in SELF_ID or kind == "thesis":
                    record_id = num          # the file is that record
            # the opportunity comes from the header, falling back to the name
            opp = re.search(r"OPP-\d+", h.get("opportunity", ""))
            opp = opp.group(0) if opp else (
                ident.group(0) if ident and ident.group(1) == "OPP" else None)

            out.append({
                "rel": rel,
                "record_id": record_id,
                "kind": kind,
                "opportunity": opp,
                "status": status or None,
                "awaiting": status.lower().startswith("draft"),
                "subject": h.get("subject"),
                "source_checked": a_date(h.get("source checked date", "")),
                "owner": h.get("owner"),
                "title": title.group(1) if title else name[:-3],
                "body": body,
                "bytes": st.st_size,
                "modified": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(st.st_mtime)),
            })
    return out


# ------------------------------------------------------------------ push ----

def _creds():
    url = SUPA.get("url", "").rstrip("/")
    key = SUPA.get("service_key", "")
    if not url or not key:
        raise SystemExit(
            "No Supabase credentials. Add to config.json:\n"
            '  "supabase": { "url": "https://<ref>.supabase.co", "service_key": "<service_role key>" }\n'
            "The service_role key is in the Supabase dashboard under Project Settings > API Keys.\n"
            "It bypasses row-level security, so it belongs only in this file on this machine.")
    return url, key


def _call(method, path, body=None, prefer="return=minimal", timeout=60):
    """One PostgREST call. Raises on anything but success -- never returns a
    plausible empty result, because a swallowed failure here is exactly how a
    mirror goes stale while still looking current."""
    url, key = _creds()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        if r.status not in (200, 201, 204):
            raise RuntimeError(f"{method} {path}: HTTP {r.status}")
        raw = r.read()
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        return None


def push(table, rows, on_conflict="id"):
    # ⚠️ PostgREST only updates the columns present in the payload, so a
    # `mirrored_at default now()` never moves on an upsert -- the mirror could
    # not report its own freshness, which is the one thing a mirror must be
    # honest about. Stamp it explicitly.
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    rows = [dict(r, mirrored_at=stamp) for r in rows]
    _creds()                                   # fail loudly before any parsing work
    if not rows:
        return 0
    _call("POST", f"{table}?on_conflict={on_conflict}", rows,
          prefer="resolution=merge-duplicates,return=minimal")
    return len(rows)


# ----------------------------------------------------------------- intents ---
# The one inbound direction. A decision made away from the laptop lands here as
# a row; the server drains it and applies it through the SAME function the
# outbox page calls, so the markdown keeps exactly one writer. Nothing in this
# module ever touches a record file.

def fetch_intents(limit=50):
    """Intents not yet applied, oldest first. [] means none; an error raises."""
    rows = _call("GET", "intents?applied_at=is.null"
                        "&select=id,action,target_rel,note,requested_at,requested_by"
                        f"&order=requested_at.asc&limit={int(limit)}",
                 prefer=None)
    return rows or []


def recent_intents(limit=25):
    """Everything recent, applied or not -- for showing what arrived."""
    rows = _call("GET", "intents?select=id,action,target_rel,note,requested_at,"
                        "requested_by,applied_at,decision_id,error"
                        f"&order=requested_at.desc&limit={int(limit)}",
                 prefer=None)
    return rows or []


def resolve_intent(intent_id, decision_id=None, error=None):
    """Close out one intent. Always stamps applied_at, so a permanently bad
    intent is recorded as handled instead of being retried every minute."""
    _call("PATCH", f"intents?id=eq.{urllib.parse.quote(str(intent_id))}",
          {"applied_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "decision_id": decision_id,
           "error": error})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--print", dest="dump", action="store_true",
                    help="parse only; emit the payload as JSON")
    ap.add_argument("--min-records", type=int, default=20,
                    help="refuse to push fewer than this many records")
    args = ap.parse_args()

    if not WORKSPACE:
        raise SystemExit("No venture_workspace in config.json.")

    try:
        opportunities = parse_opportunities()
        decisions = parse_decisions()
        records = parse_records()
    except OSError as exc:
        raise SystemExit(f"Could not read the workspace: {exc}\n"
                         "If this is 'Operation not permitted', macOS has revoked directory "
                         "listing for this process again. Nothing was pushed.")

    if len(records) < args.min_records:
        raise SystemExit(
            f"Refusing to push: only {len(records)} records parsed, expected at least "
            f"{args.min_records}. An empty or short read is far more likely to be a denied "
            "directory listing than a real deletion, and mirroring it would overwrite good rows.")

    if args.dump:
        json.dump({"opportunities": opportunities, "decisions": decisions, "records": records},
                  sys.stdout, indent=1)
        return 0

    total = 0
    for table, rows in (("opportunities", opportunities),
                        ("decisions", decisions),
                        ("records", records)):
        try:
            n = push(table, rows, "rel" if table == "records" else "id")
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError) as exc:
            detail = ""
            if isinstance(exc, urllib.error.HTTPError):
                detail = f" -- {exc.read().decode('utf-8', 'replace')[:300]}"
            hint = "The mirror is now STALE."
            text = str(exc)
            if "CERTIFICATE_VERIFY_FAILED" in text:
                hint = ("This interpreter has no CA bundle -- it is a local trust problem, not "
                        "Supabase. Run it with /Library/Developer/CommandLineTools/usr/bin/python3, "
                        "which is what the launch agents use.")
            elif isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403):
                hint = "The service_key in config.json is missing, wrong, or revoked."
            elif isinstance(exc, urllib.error.URLError):
                hint = "Could not reach the project -- it may have paused. The mirror is now STALE."
            raise SystemExit(f"Push failed on {table}: {exc}{detail}\n{hint}")
        log(f"{table}: {n} rows")
        total += n
    log(f"mirrored {total} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
