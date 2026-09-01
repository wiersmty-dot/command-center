#!/usr/bin/env python3
"""
Command Center — a local dashboard for firing Claude Code skill runs.

Binds to 127.0.0.1 only. No dependencies beyond the Python standard library.
Start it with:  python3 server.py
Then open:      http://127.0.0.1:7777
"""

import base64
import glob
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, time as clock_time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))


def load_json(name, fallback):
    path = os.path.join(BASE, name)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        print(f"[command-center] could not read {name}: {exc}")
        return fallback


def save_json(name, payload):
    path = os.path.join(BASE, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)


CONFIG = load_json("config.json", {})
CLAUDE_BIN = CONFIG.get("claude_bin", "claude")
CLAUDE_ARGS = CONFIG.get("claude_args", [])
WORKDIR = os.path.expanduser(CONFIG.get("workdir", "~"))
PORT = int(CONFIG.get("port", 7777))
MAX_HISTORY = int(CONFIG.get("max_history", 25))
# Runs are real `claude -p` subprocesses on this laptop, so "parallel" needs a
# ceiling. The cap lives here rather than in the page because /api/run is a plain
# endpoint -- a UI-only limit is a suggestion, not a limit.
MAX_CONCURRENT_RUNS = int(CONFIG.get("max_concurrent_runs", 4))
ARCHIVE = bool(CONFIG.get("archive", True))
ARCHIVE_DIR = CONFIG.get("archive_dir", "40 Daily/Runs")
ATTACH_DIR = CONFIG.get("attachments_dir", "99 Assets/Attachments")
MAX_ATTACH_BYTES = int(CONFIG.get("max_attachment_bytes", 10 * 1024 * 1024))
VENTURE_FILE = "venture-state.json"
VENTURE_WORKSPACE = os.path.expanduser(CONFIG.get("venture_workspace", ""))
WORKSPACE_FILE = "workspace-state.json"
VENTURE_STAGES = ["Candidate", "Qualified thesis", "Validated", "Pilot committed"]
SCHEDULE_DIR = os.path.join(BASE, "schedules")
LAUNCH_AGENTS_DIR = os.path.expanduser("~/Library/LaunchAgents")
SCHEDULE_PREFIX = "com.tyler.nova-schedule."

JOBS = {}
ORDER = []
LOCK = threading.Lock()
ORCHESTRATION_FILE = "orchestrations.json"
ORCHESTRATION_LOCK = threading.Lock()
ORCHESTRATIONS = load_json(ORCHESTRATION_FILE, {"items": []}).get("items", [])
SPEECH_LOCK = threading.Lock()
SPEECH_PROCESS = None


def local_speech(text):
    """Read a bounded Nova delivery through the local Mac voice.

    This is deliberately localhost-only and never transmits the delivery. It
    accepts plain text as an argument list rather than a shell command, and
    replaces any previous reading so a new Chief response does not pile up.
    """
    global SPEECH_PROCESS
    clean = " ".join(str(text or "").split())[:6000]
    if not clean:
        return {"error": "Nothing to read aloud."}, 400
    say_bin = shutil.which("say")
    if not say_bin:
        return {"error": "Local Mac speech is not available on this host."}, 501
    try:
        with SPEECH_LOCK:
            if SPEECH_PROCESS and SPEECH_PROCESS.poll() is None:
                SPEECH_PROCESS.terminate()
            SPEECH_PROCESS = subprocess.Popen(
                [say_bin, "-r", "195", clean],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        return {"spoken": True, "engine": "macos-say"}, 202
    except OSError as exc:
        return {"error": f"Could not start local speech: {exc}"}, 500


def stop_local_speech():
    global SPEECH_PROCESS
    with SPEECH_LOCK:
        if SPEECH_PROCESS and SPEECH_PROCESS.poll() is None:
            SPEECH_PROCESS.terminate()
        SPEECH_PROCESS = None
    return {"stopped": True}, 200


def workspace_state():
    """Local operator workspace data, intentionally separate from the vault.

    Venture state remains the source of truth for Board decisions. This file only
    holds the operator-facing connections around a project: manual tasks, plan
    links, notifications, and external-action drafts. Keeping it beside the
    runner means reviewing work never mutates an Obsidian note by surprise.
    """
    state = load_json(WORKSPACE_FILE, {})
    state.setdefault("tasks", [])
    state.setdefault("planLinks", {})
    state.setdefault("notifications", [])
    state.setdefault("externalDrafts", [])
    return state


def persist_workspace(state):
    save_json(WORKSPACE_FILE, state)


def workspace_notification(state, kind, title, detail="", project_id=None):
    state.setdefault("notifications", []).insert(0, {
        "id": uuid.uuid4().hex[:12], "kind": kind, "title": title,
        "detail": detail, "projectId": project_id, "created": time.time(),
        "read": False,
    })
    # The feed is intentionally bounded: it is an operator inbox, not an archive.
    state["notifications"] = state["notifications"][:120]


def persist_orchestrations():
    """Keep the Chief-of-Staff work graph across runner restarts."""
    with ORCHESTRATION_LOCK:
        save_json(ORCHESTRATION_FILE, {"items": ORCHESTRATIONS[-40:]})


def orchestration_view(item):
    """Return a JSON-safe, UI-ready record without live process objects."""
    return json.loads(json.dumps(item))


def recall_memory(query, limit=6):
    """Small, evidence-first recall over durable run notes.

    This intentionally uses transparent keyword ranking rather than pretending
    a vector database exists. Every returned memory carries its source note so
    a later agent and the operator can inspect the evidence.
    """
    terms = [w.lower() for w in re.findall(r"[a-zA-Z0-9]{4,}", query)]
    if not terms:
        return []
    notes, error = vault_notes(limit=200)
    if error:
        return []
    ranked = []
    for note in notes:
        body = vault_note(note["name"])
        if not body:
            continue
        lowered = body.lower()
        score = sum(lowered.count(term) for term in terms)
        if not score:
            continue
        positions = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
        start = max(0, min(positions) - 180) if positions else 0
        snippet = " ".join(body[start:start + 520].split())
        ranked.append({"name": note["name"], "score": score, "snippet": snippet})
    ranked.sort(key=lambda row: (-row["score"], row["name"]), reverse=False)
    return ranked[:limit]


def prompt_for(skill, instruction, question, context):
    """Build a bounded local-agent prompt, including inspectable memory."""
    memories = "\n".join(
        f"- {m['name']}: {m['snippet']}" for m in context.get("memory", []))
    upstream = context.get("upstream", "")
    return (
        f"Use the {skill} skill.\n\n"
        f"Role for this orchestration stage: {instruction}\n\n"
        f"Operator question:\n{question}\n\n"
        "Durable-memory recall (inspect the source records; do not treat this as undisputed fact):\n"
        f"{memories or '- No matching archived records were found.'}\n\n"
        f"Prior stage output:\n{upstream or '- This is the first stage.'}\n\n"
        "Work locally and produce a decision-ready written result. Do not send outreach, "
        "incur spend, make commitments, change external systems, or provide legal conclusions."
    )


def run_orchestration(item):
    """Run the fixed, auditable Venture Chief pipeline sequentially.

    The fixed sequence is deliberate: it makes each handoff visible and keeps
    the Chief from silently inventing a new capability or acting outside the
    approved local, read-only boundary.
    """
    context = {"memory": item.get("memory", []), "upstream": ""}
    instructions = [
        ("venture-chief-of-staff", "Plan the decision: restate the question, identify the next proof, constraints, and what must remain founder-approved."),
        ("venture-thesis-scout", "Research the operational workflow, buyer, trigger, alternatives, and cheapest disconfirming evidence needed."),
        ("venture-diligence-economics", "Verify the economics, practical workflow, alternatives, regulatory boundaries, assumptions, and proof plan."),
        ("venture-chief-of-staff", "Verify and synthesize the prior work into advance, hold, or kill recommendations with evidence, unknowns, and explicit founder decisions."),
    ]
    try:
        for index, (skill, instruction) in enumerate(instructions):
            stage = item["stages"][index]
            stage["status"] = "running"
            item["status"] = "running"
            item["updated"] = time.time()
            persist_orchestrations()
            job = new_job(skill, f"{item['label']} · {stage['name']}",
                          prompt_for(skill, instruction, item["question"], context))
            stage["jobId"] = job["id"]
            persist_orchestrations()
            while job["status"] == "running":
                time.sleep(0.75)
            stage["status"] = job["status"]
            stage["ended"] = job.get("ended")
            stage["note"] = job.get("note")
            output = "".join(job.get("lines", []))
            stage["result"] = output[-6000:]
            if job["status"] != "done":
                item["status"] = "fault"
                item["ended"] = time.time()
                item["updated"] = item["ended"]
                persist_orchestrations()
                return
            context["upstream"] = output[-6000:]
            item["updated"] = time.time()
            persist_orchestrations()
        item["status"] = "done"
        item["ended"] = time.time()
        item["updated"] = item["ended"]
        persist_orchestrations()
        workspace = workspace_state()
        workspace_notification(workspace, "run", "Chief task is ready for review", item.get("question", "Completed local task"), item.get("sourceOpportunity"))
        persist_workspace(workspace)
    except Exception as exc:
        item["status"] = "fault"
        item["error"] = str(exc)
        item["ended"] = time.time()
        item["updated"] = item["ended"]
        persist_orchestrations()


def create_orchestration(data):
    question = (data.get("question") or "").strip()
    source_opportunity = (data.get("sourceOpportunity") or "").strip()
    origin = (data.get("origin") or "").strip()
    if len(question) < 8:
        return {"error": "Give the Chief of Staff a specific question (at least 8 characters)."}, 400
    if source_opportunity:
        venture = load_json(VENTURE_FILE, {"opportunities": []})
        if not any(row.get("id") == source_opportunity for row in venture.get("opportunities", [])):
            return {"error": "The linked Board project no longer exists."}, 404
    item = {
        "id": uuid.uuid4().hex[:12],
        "label": "Chief of Staff orchestration",
        "question": question,
        "status": "queued",
        "started": time.time(),
        "updated": time.time(),
        "ended": None,
        "memory": recall_memory(question),
        "sourceOpportunity": source_opportunity or None,
        "origin": origin or "chief-question",
        "stages": [
            {"name": "Chief plan", "skill": "venture-chief-of-staff", "status": "queued"},
            {"name": "Workflow research", "skill": "venture-thesis-scout", "status": "queued"},
            {"name": "Economics diligence", "skill": "venture-diligence-economics", "status": "queued"},
            {"name": "Chief verification", "skill": "venture-chief-of-staff", "status": "queued"},
        ],
    }
    with ORCHESTRATION_LOCK:
        ORCHESTRATIONS.append(item)
    persist_orchestrations()
    if source_opportunity:
        venture = load_json(VENTURE_FILE, {"opportunities": [], "decisionLog": []})
        now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        venture["updatedAt"] = now
        venture.setdefault("decisionLog", []).insert(0, {
            "at": now,
            "opportunity": source_opportunity,
            "decision": "revised_task_started",
            "label": "Requested revised local evidence task",
            "orchestration": item["id"],
        })
        save_json(VENTURE_FILE, venture)
    threading.Thread(target=run_orchestration, args=(item,), daemon=True).start()
    return orchestration_view(item), 202


def orchestration_history(limit=30):
    with ORCHESTRATION_LOCK:
        rows = [orchestration_view(item) for item in ORCHESTRATIONS]
    rows.sort(key=lambda item: item.get("started", 0), reverse=True)
    return rows[:limit]


def review_orchestration(orchestration_id, data):
    """Record the founder's local review or start a deliberately re-scoped run.

    An approval here only accepts a recommendation into the local operating
    record. It does not authorize messaging, spending, commits, or any other
    external action. Re-scoping is explicit and creates a new, linked run so
    the original evidence is never overwritten.
    """
    decision = (data.get("decision") or "").strip().lower()
    with ORCHESTRATION_LOCK:
        item = next((row for row in ORCHESTRATIONS
                     if row.get("id") == orchestration_id), None)
        if not item:
            return {"error": "Unknown orchestration."}, 404
        if item.get("status") not in ("done", "fault"):
            return {"error": "This task is still running; review it once it returns."}, 409
        if decision == "approve":
            item["review"] = {
                "status": "approved",
                "reviewed": time.time(),
                "note": "Founder accepted this local recommendation for manual follow-through.",
            }
            item["updated"] = time.time()
            approved = orchestration_view(item)
        else:
            approved = None
    if approved:
        persist_orchestrations()
        return approved, 200
    with ORCHESTRATION_LOCK:
        item = next((row for row in ORCHESTRATIONS
                     if row.get("id") == orchestration_id), None)
        if not item:
            return {"error": "Unknown orchestration."}, 404
        if decision != "rescope":
            return {"error": "Use approve or rescope."}, 400
        scope = (data.get("scope") or "").strip()
        if len(scope) < 8:
            return {"error": "Describe the revised agent scope (at least 8 characters)."}, 400
        item["review"] = {
            "status": "rescope_requested",
            "reviewed": time.time(),
            "note": scope,
        }
        item["updated"] = time.time()
        original_question = item.get("question", "")
    persist_orchestrations()
    follow_up, code = create_orchestration({
        "question": f"Follow-up to task {orchestration_id}. Original question: {original_question}\n\nRevised agent scope: {scope}",
    })
    if code >= 400:
        return follow_up, code
    with ORCHESTRATION_LOCK:
        item["review"]["followUpId"] = follow_up["id"]
    persist_orchestrations()
    return {"reviewed": orchestration_view(item), "followUp": follow_up}, 202


def new_job(skill, label, prompt):
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "skill": skill,
        "label": label,
        "prompt": prompt,
        "status": "running",
        "lines": [],
        "started": time.time(),
        "ended": None,
        "code": None,
        "proc": None,
    }
    with LOCK:
        JOBS[job_id] = job
        ORDER.append(job_id)
        while len(ORDER) > MAX_HISTORY:
            stale = ORDER.pop(0)
            JOBS.pop(stale, None)
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return job


def append(job, text):
    with LOCK:
        job["lines"].append(text)


def run_job(job):
    if not os.path.isdir(WORKDIR):
        append(job, f"Working folder not found: {WORKDIR}\n")
        append(job, "Fix the workdir path in config.json, then run this again.\n")
        job["status"] = "fault"
        job["ended"] = time.time()
        return

    cmd = [CLAUDE_BIN, "-p", job["prompt"]] + CLAUDE_ARGS
    append(job, f"$ cd {WORKDIR}\n")
    append(job, f"$ {CLAUDE_BIN} -p \"{job['prompt'][:120]}\"\n\n")

    env = os.environ.copy()
    extra_path = CONFIG.get("extra_path", [])
    if extra_path:
        env["PATH"] = ":".join(extra_path) + ":" + env.get("PATH", "")

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=WORKDIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
    except FileNotFoundError:
        append(job, f"Could not find the '{CLAUDE_BIN}' command.\n")
        append(job, "Run `which claude` in Terminal and put that full path in config.json.\n")
        job["status"] = "fault"
        job["ended"] = time.time()
        return
    except Exception as exc:
        append(job, f"Could not start the run: {exc}\n")
        job["status"] = "fault"
        job["ended"] = time.time()
        return

    job["proc"] = proc
    for line in proc.stdout:
        append(job, line)
    proc.wait()

    job["code"] = proc.returncode
    job["ended"] = time.time()
    if job["status"] == "stopped":
        append(job, "\n-- stopped --\n")
    elif proc.returncode == 0:
        job["status"] = "done"
        append(job, f"\n-- finished in {int(job['ended'] - job['started'])}s --\n")
    else:
        job["status"] = "fault"
        append(job, f"\n-- exited with code {proc.returncode} --\n")

    archive_job(job)


# --- vault archive ---------------------------------------------------------
# Every completed run is written into the vault as a markdown note so results
# survive a restart, and so any file a skill produced (the morning brief's HTML,
# for instance) is copied out of its temp dir before it is garbage collected.

FILE_RE = re.compile(r"(/[^\s\"'`<>()\[\]]+\.(?:html|pdf|png|jpg|jpeg|svg|csv|md|json))")


def slugify(text):
    keep = "".join(c if (c.isalnum() or c in " -_") else " " for c in text)
    return " ".join(keep.split())[:60] or "run"


def harvest_files(job, note_stamp):
    """Copy files the run mentioned into the vault attachments folder."""
    body = "".join(job["lines"])
    seen, saved = set(), []
    dest_dir = os.path.join(WORKDIR, ATTACH_DIR)

    for path in FILE_RE.findall(body):
        path = path.rstrip(".,;:")
        if path in seen:
            continue
        seen.add(path)
        try:
            if not os.path.isfile(path):
                continue
            # already in the vault, or too big to be worth copying
            if os.path.abspath(path).startswith(os.path.abspath(WORKDIR)):
                continue
            if os.path.getsize(path) > MAX_ATTACH_BYTES:
                continue
            os.makedirs(dest_dir, exist_ok=True)
            base = os.path.basename(path)
            name = f"{note_stamp} {base}"
            shutil.copy2(path, os.path.join(dest_dir, name))
            saved.append(name)
        except Exception as exc:
            print(f"[command-center] could not copy {path}: {exc}")
    return saved


FENCE_RE = re.compile(r"```html\s*\n(.*?)```", re.DOTALL)

# Fonts the runner substitutes into a delivered page. A model transcribing 24k
# characters of base64 by hand gets some of them wrong — a measured 2 bad bytes
# in 18,096 was enough to corrupt the Brotli stream — so the page carries a
# placeholder and Python swaps in bytes read straight from disk.
# Resolved against BASE (the runner's own folder), not the vault: under launchd
# this process has no TCC access to ~/Documents and reading from there fails
# with EPERM, even though it can write run notes.
FONT_PLACEHOLDERS = {
    "__FRAUNCES_WOFF2__": os.path.join("assets", "fonts", "fraunces-latin-600-normal.woff2"),
}


def inject_fonts(html):
    for token, rel in FONT_PLACEHOLDERS.items():
        if token not in html:
            continue
        path = os.path.join(BASE, rel)
        try:
            with open(path, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("ascii")
            html = html.replace(token, f"data:font/woff2;base64,{b64}")
            print(f"[command-center] injected {os.path.basename(rel)}")
        except Exception as exc:
            print(f"[command-center] could not inject {rel}: {exc}")
    return html


def harvest_fenced_html(job, note_stamp):
    """Save any ```html block the run emitted.

    Headless runs cannot write files — the vault is outside the writable set and
    the session scratch dir is not reliably located. So a skill that builds a
    page emits it inline instead, and we write it here where permissions are not
    in question.
    """
    body = "".join(job["lines"])
    saved = []
    dest_dir = os.path.join(WORKDIR, ATTACH_DIR)
    for i, html in enumerate(FENCE_RE.findall(body), start=1):
        html = html.strip()
        if len(html) < 200 or "<" not in html:
            continue  # a snippet being discussed, not a page
        html = inject_fonts(html)
        try:
            os.makedirs(dest_dir, exist_ok=True)
            suffix = "" if i == 1 else f"-{i}"
            name = f"{note_stamp} {slugify(job['label'])}{suffix}.html"
            with open(os.path.join(dest_dir, name), "w", encoding="utf-8") as fh:
                fh.write(html)
            saved.append(name)
        except Exception as exc:
            print(f"[command-center] could not save inline html: {exc}")
    return saved


# --- orbit state -----------------------------------------------------------
# The panels on /orbit that are not Command Center's own data (decisions, the
# email signal) come from the morning brief, which emits a ```json block
# alongside its page. We store the parsed block next to the runner rather than
# in the vault: under launchd this process can write to ~/Documents but cannot
# read back from it (TCC), so the vault is write-only from here.

STATE_FILE = os.path.join(BASE, "orbit-state.json")
JSON_FENCE_RE = re.compile(r"```json\s*\n(.*?)```", re.DOTALL)


def capture_state(job):
    """Persist the structured block a brief emitted, if it emitted one."""
    body = "".join(job["lines"])
    for raw in JSON_FENCE_RE.findall(body):
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(data, dict):
            continue
        data["_source"] = job["label"]
        data["_at"] = job["started"]
        try:
            with open(STATE_FILE, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2)
            print(f"[command-center] orbit state updated from {job['label']}")
        except Exception as exc:
            print(f"[command-center] could not write orbit state: {exc}")
        return


RUNLOG = os.path.join(BASE, "runs.jsonl")


# --- the venture workspace, which is the source of truth ---------------------
# The board used to keep its own copy of every gate in venture-state.json while
# the agents read and wrote records/opportunity-pipeline.md. Nothing synced
# them, so the two drifted until the board claimed a thesis was at the final
# gate while the pipeline still had it at the first. The markdown is the record
# the agents actually cite; the board now reads and writes it.

def _ws(*parts):
    return os.path.join(VENTURE_WORKSPACE, *parts)


PIPELINE = ("records", "opportunity-pipeline.md")
DECISION_LOG = ("records", "decision-log.md")

# a row in the Active portfolio table: | [OPP-001](../theses/..) | thesis | Gate | ...
PIPE_ROW = re.compile(r"^\|\s*\[(OPP-\d+)\][^|]*\|([^|]*)\|([^|]*)\|", re.M)


def pipeline_gates():
    """{'OPP-001': 'Candidate', ...} as recorded in the workspace, or None.

    ⚠️ Returns {} both when the file has no rows and when it cannot be read, and
    the caller treats {} as "no overlay" — which silently falls back to the
    board's own stale copy. That is how a thesis the record calls a Candidate
    reappears on screen at "Pilot committed". Log the read failure so the cause
    is visible instead of being absorbed.
    """
    try:
        txt = open(_ws(*PIPELINE), encoding="utf-8").read()
    except OSError as exc:
        print(f"[command-center] cannot read the pipeline: {exc}")
        return None
    return {m.group(1): m.group(3).strip() for m in PIPE_ROW.finditer(txt)}


def set_pipeline_gate(opp_id, gate):
    """Rewrite just the Gate cell for one row, leaving the rest of the table."""
    path = _ws(*PIPELINE)
    try:
        txt = open(path, encoding="utf-8").read()
    except OSError as exc:
        return f"could not read the pipeline: {exc}"

    def swap(m):
        if m.group(1) != opp_id:
            return m.group(0)
        head = m.group(0)
        # replace the third cell only
        return f"|{head.split('|')[1]}|{m.group(2)}| {gate} |"

    new = PIPE_ROW.sub(swap, txt)
    if new == txt:
        return f"no pipeline row for {opp_id}"
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new)
    except OSError as exc:
        return f"could not write the pipeline: {exc}"
    return None


def next_decision_id():
    try:
        txt = open(_ws(*DECISION_LOG), encoding="utf-8").read()
    except OSError:
        return "DEC-001"
    seen = [int(n) for n in re.findall(r"DEC-(\d+)", txt)]
    return f"DEC-{max(seen) + 1:03d}" if seen else "DEC-001"


def append_decision(opp_id, decision, scope, evidence="Board decision"):
    """Add a row to the founder decision log the charter requires."""
    path = _ws(*DECISION_LOG)
    dec_id = next_decision_id()
    row = "| {} | {} | {} | {} | {} | Founder | {} |\n".format(
        dec_id, time.strftime("%Y-%m-%d"), opp_id, decision, scope, evidence)
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(row)
    except OSError as exc:
        return None, f"could not append to the decision log: {exc}"
    return dec_id, None


# --- record IDs --------------------------------------------------------------
# Every record type carries an immutable ID, and nothing handed them out. Each
# agent started counting at 001, so two runs two minutes apart both allocated
# LED-001..007 to completely different companies. The scan below is the safety
# net (it sees files an agent wrote without asking); the high-water file is what
# stops two concurrent runs claiming the same range before either writes.

ID_PREFIXES = ("OPP", "EVD", "LED", "EXP", "PRT", "DEC")
ID_FILE = "record-ids.json"
ID_LOCK = threading.Lock()
ID_IN_NAME = re.compile(r"\b(" + "|".join(ID_PREFIXES) + r")-(\d+)")


def _raise_walk_error(exc):
    raise exc


def scan_record_ids():
    """Highest ID per prefix actually present in the workspace.

    ⚠️ Raises when the workspace cannot be enumerated. An empty scan is
    indistinguishable from a denied one, and treating a denial as "nothing
    exists" makes the allocator hand out LED-001 over a directory that already
    holds eighteen — the precise collision it was built to stop.
    """
    high = {p: 0 for p in ID_PREFIXES}
    if not VENTURE_WORKSPACE:
        raise OSError("No venture workspace is configured.")
    seen_any = False
    for root, dirs, files in os.walk(VENTURE_WORKSPACE, onerror=_raise_walk_error):
        seen_any = True
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in files:
            for m in ID_IN_NAME.finditer(name):
                p, n = m.group(1), int(m.group(2))
                if n > high[p]:
                    high[p] = n
    # DEC ids live in the log body rather than a filename
    try:
        body = open(_ws(*DECISION_LOG), encoding="utf-8").read()
    except OSError:
        body = ""
    for m in re.finditer(r"\bDEC-(\d+)", body):
        high["DEC"] = max(high["DEC"], int(m.group(1)))
    if not seen_any:
        raise OSError(f"Could not enumerate {VENTURE_WORKSPACE}")
    return high


def allocate_ids(prefix, count=1):
    """Reserve `count` consecutive IDs and remember that they are taken."""
    prefix = (prefix or "").upper()
    if prefix not in ID_PREFIXES:
        return None, f"Unknown record prefix {prefix!r}."
    try:
        count = max(1, min(int(count), 50))
    except (TypeError, ValueError):
        return None, "count must be a number."

    with ID_LOCK:
        try:
            scanned = scan_record_ids().get(prefix, 0)
        except OSError as exc:
            # Better to hand out nothing than a number that collides.
            return None, (f"Cannot read the workspace, so the next {prefix} is unknown "
                          f"and issuing one risks reusing an existing record. {exc}")
        marks = load_json(ID_FILE, {})
        start = max(scanned, int(marks.get(prefix, 0))) + 1
        marks[prefix] = start + count - 1
        save_json(ID_FILE, marks)
    return [f"{prefix}-{n:03d}" for n in range(start, start + count)], None


# --- the outbox -------------------------------------------------------------
# Every lead and brief an agent writes is stamped "Draft-founder approval
# required", exactly as the charter demands. Nothing collected them, so the
# queue of things waiting on Tyler lived scattered across two dozen files and
# the only way to find it was to remember it existed.

OUTBOX_DIRS = ("leads", "records")
# templates/ holds the blank with the marker in it; agents/ holds the charter
# that mandates the marker. Neither is a draft.
STATUS_RE = re.compile(r"^\*\*Status:\*\*\s*(.+?)\s*$", re.M)
TITLE_RE = re.compile(r"^#\s+(.+?)\s*$", re.M)
OPP_RE = re.compile(r"^\*\*Opportunity:\*\*\s*\[?(OPP-\d+)", re.M)


def _is_draft(status):
    return status.lower().startswith("draft")


def _one_line(text, limit=240):
    """Flatten a founder note so it cannot break the ledger it lands in.

    The note is written into a `**Status:**` line and, as the scope, into a
    pipe-delimited decision-log row. A newline splits the status line in two and
    a pipe silently adds a column to the decision table -- corrupting the record
    that exists to be trustworthy. Flattening is not cosmetic here.
    """
    text = re.sub(r"[\r\n\t]+", " ", str(text or "")).replace("|", "/")
    return re.sub(r"\s{2,}", " ", text).strip()[:limit]


def outbox_items():
    """Everything in the workspace still waiting on a founder decision."""
    out, err = [], None
    if not VENTURE_WORKSPACE:
        return out, "No venture workspace is configured."
    for sub in OUTBOX_DIRS:
        root = _ws(sub)
        try:
            names = sorted(os.listdir(root))
        except OSError as exc:
            err = f"Could not read {sub}/: {exc}"
            continue
        for name in names:
            if not name.endswith(".md"):
                continue
            path = os.path.join(root, name)
            try:
                body = open(path, encoding="utf-8").read()
                st = os.stat(path)
            except OSError:
                continue
            m = STATUS_RE.search(body)
            if not m or not _is_draft(m.group(1)):
                continue
            title = TITLE_RE.search(body)
            opp = OPP_RE.search(body)
            out.append({
                "name": name,
                "dir": sub,
                "rel": os.path.join(sub, name),
                "title": (title.group(1) if title else name[:-3]),
                "opportunity": opp.group(1) if opp else None,
                "status": m.group(1),
                "modified": st.st_mtime,
                "bytes": st.st_size,
            })
    out.sort(key=lambda i: (i.get("opportunity") or "zzz", i["name"]))
    return out, err


def outbox_decide(data):
    """Approve or reject one draft: stamp the file, and log the decision."""
    name = (data.get("name") or "").strip()
    sub = (data.get("dir") or "").strip()
    decision = (data.get("decision") or "").strip().lower()
    note = _one_line(data.get("note"))

    if decision not in ("approve", "reject"):
        return {"error": "Decision must be approve or reject."}, 400
    if sub not in OUTBOX_DIRS or not name.endswith(".md") or "/" in name or "\\" in name:
        return {"error": "Unknown record."}, 400

    root = os.path.realpath(_ws(sub))
    path = os.path.realpath(os.path.join(root, name))
    if not path.startswith(root + os.sep):
        return {"error": "Unknown record."}, 400

    try:
        body = open(path, encoding="utf-8").read()
    except OSError as exc:
        return {"error": f"Could not read the record: {exc}"}, 404

    m = STATUS_RE.search(body)
    if not m:
        return {"error": "That record has no Status line to change."}, 409
    if not _is_draft(m.group(1)):
        return {"error": f"That record is already {m.group(1)}."}, 409

    stamp = time.strftime("%Y-%m-%d")
    verb = "Approved" if decision == "approve" else "Rejected"
    # Only the Status line is rewritten. Everything the agent wrote stays.
    new_status = f"**Status:** {verb} by founder {stamp}" + (f" - {note}" if note else "")
    updated = body[:m.start()] + new_status + body[m.end():]
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(updated)
    except OSError as exc:
        return {"error": f"Could not write the record: {exc}"}, 500

    rec = (TITLE_RE.search(body).group(1) if TITLE_RE.search(body) else name)
    opp = OPP_RE.search(body)
    dec_id, log_err = append_decision(
        opp.group(1) if opp else "Portfolio",
        f"{verb} {rec}",
        note or f"{verb} from the outbox. No outreach authorised by this alone.",
        evidence=os.path.join(sub, name),
    )
    return {"ok": True, "status": new_status.replace("**Status:** ", ""),
            "decision": dec_id, "logError": log_err}, 200


# --- the Postgres mirror ------------------------------------------------------
# Run from THIS process on purpose. A separate launch agent is a new TCC
# identity with no Documents grant, and its first run was refused
# ("Operation not permitted") while this server was reading the same files
# fine. Spawning the mirror as a child of the server inherits the access the
# server already has.

MIRROR_EVERY = int(CONFIG.get("mirror_interval_seconds", 1800))
MIRROR_MIN_RECORDS = int(CONFIG.get("mirror_min_records", 20))


def run_mirror(reason="timer"):
    """Push the workspace projection. Never raises into the caller.

    ⚠️ Runs IN THIS PROCESS, not as a subprocess. macOS grants Full Disk Access
    per executable identity and does not extend it to a spawned child: with the
    server reading the workspace fine, a `subprocess.run` of the same
    interpreter was still refused "Operation not permitted". Importing the
    parser keeps every read inside the process that holds the grant.
    """
    if not CONFIG.get("supabase", {}).get("service_key"):
        return
    try:
        import importlib
        import mirror as m
        importlib.reload(m)            # pick up a rotated key without a restart

        opportunities = m.parse_opportunities()
        decisions = m.parse_decisions()
        records = m.parse_records()

        if len(records) < MIRROR_MIN_RECORDS:
            print(f"[command-center] mirror ({reason}) DID NOT PUSH: only {len(records)} "
                  f"records parsed, expected at least {MIRROR_MIN_RECORDS}. A short read is "
                  "far more likely to be a denied listing than a real deletion.")
            return

        total = 0
        for table, rows, key in (("opportunities", opportunities, "id"),
                                 ("decisions", decisions, "id"),
                                 ("records", records, "rel")):
            total += m.push(table, rows, key)
        print(f"[command-center] mirror ({reason}): {total} rows")
    except OSError as exc:
        print(f"[command-center] mirror ({reason}) DID NOT PUSH: cannot read the workspace "
              f"({exc}). Nothing was pushed.")
    except BaseException as exc:      # push() raises SystemExit when unconfigured
        print(f"[command-center] mirror ({reason}) DID NOT PUSH: {exc}")


def mirror_loop():
    while True:
        time.sleep(MIRROR_EVERY)
        run_mirror("timer")


# --- inbound: approvals raised away from the laptop --------------------------
# The only direction that flows back. A decision made elsewhere arrives as an
# `intents` row and is applied HERE, through outbox_decide -- the same function
# the outbox page calls. That is deliberate: the markdown keeps exactly one
# writer, so the path validation, the containment check and the
# already-decided guard cannot be sidestepped by arriving through a different
# door. Nothing outside this process ever edits a record.

INTENT_EVERY = int(CONFIG.get("intent_interval_seconds", 60))
INTENT_MAX_PER_DRAIN = int(CONFIG.get("intent_max_per_drain", 25))
INTENT_ACTIONS = ("approve", "reject")


def _intent_target(rel):
    """Split `leads/LED-001-foo.md` into (dir, name). outbox_decide does the
    real validation; this only has to avoid handing it something absurd."""
    sub, _, name = str(rel or "").partition("/")
    return sub.strip(), name.strip()


def drain_intents(reason="timer"):
    """Apply pending intents. Returns how many records were stamped.

    ⚠️ A failure is classified before it is recorded. Marking an intent
    "applied, errored" is permanent, so it is only done when the intent itself
    is the problem (unknown action, unknown record, already decided). When the
    problem is this machine -- a denied read, a failed write -- the intent is
    LEFT PENDING and the drain stops. The alternative is a queue that quietly
    burns every phone approval during a permissions blip.
    """
    if not CONFIG.get("supabase", {}).get("service_key"):
        return 0
    try:
        import importlib
        import mirror as m
        importlib.reload(m)
        pending = m.fetch_intents(INTENT_MAX_PER_DRAIN)
    except BaseException as exc:
        print(f"[command-center] intents ({reason}): could not read the queue: {exc}")
        return 0

    if not pending:
        return 0

    # Probe the workspace once. If the directory cannot even be listed, every
    # open() below would fail as "not found" and each intent would be marked
    # permanently bad for what is really a TCC blip.
    try:
        os.listdir(_ws("leads"))
    except OSError as exc:
        print(f"[command-center] intents ({reason}): workspace unreadable ({exc}). "
              f"{len(pending)} intent(s) left pending, nothing applied.")
        return 0

    applied = 0
    for it in pending:
        action = str(it.get("action") or "").strip().lower()
        sub, name = _intent_target(it.get("target_rel"))
        note = _one_line(it.get("note"))
        who = _one_line(it.get("requested_by"), 60) or "remote"

        if action not in INTENT_ACTIONS:
            _close_intent(m, it, error=f"Unknown action {action!r}.", reason=reason)
            continue

        payload, code = outbox_decide({
            "name": name, "dir": sub, "decision": action,
            "note": note or f"Decided from {who}.",
        })

        if code == 200:
            if not _close_intent(m, it, decision_id=payload.get("decision"), reason=reason):
                # The record IS stamped but the queue was not updated. Stop, or
                # the next drain re-applies it -- outbox_decide would refuse the
                # second time, but it would then be recorded as an error, which
                # would be a lie about what happened.
                print(f"[command-center] intents ({reason}): STOPPING -- "
                      f"{it.get('target_rel')} was applied but could not be marked done.")
                break
            applied += 1
            continue

        # 500 is this machine failing, not a bad intent. So is a 404 for a file
        # that is plainly there -- that is a read denial wearing a 404.
        on_disk = bool(sub and name and os.path.exists(_ws(sub, name)))
        transient = code >= 500 or (code == 404 and on_disk)
        if transient:
            print(f"[command-center] intents ({reason}): {it.get('target_rel')} deferred -- "
                  f"{payload.get('error')}")
            break
        _close_intent(m, it, error=str(payload.get("error"))[:400], reason=reason)

    if applied:
        print(f"[command-center] intents ({reason}): applied {applied}")
        run_mirror("after intents")
    return applied


def _close_intent(m, intent, decision_id=None, error=None, reason="timer"):
    try:
        m.resolve_intent(intent.get("id"), decision_id=decision_id, error=error)
        if error:
            print(f"[command-center] intents ({reason}): refused "
                  f"{intent.get('target_rel')} -- {error}")
        return True
    except BaseException as exc:
        print(f"[command-center] intents ({reason}): could not close "
              f"{intent.get('id')}: {exc}")
        return False


def intent_loop():
    while True:
        time.sleep(INTENT_EVERY)
        try:
            drain_intents("timer")
        except BaseException as exc:          # a drain must never kill its thread
            print(f"[command-center] intents (timer) crashed: {exc}")


def venture_payload():
    """The venture board's local, auditable source of truth."""
    state = load_json(VENTURE_FILE, {"opportunities": [], "agents": [], "decisionLog": []})
    opportunities = state.get("opportunities", [])

    # Show the gate the written record supports, never the board's own copy.
    # When the record cannot be read at all, say so: falling back to the board's
    # stage is how OPP-001 reappears at "Pilot committed" with nobody contacted.
    recorded = pipeline_gates()
    if recorded is None:
        state["stale"] = True
        state["staleReason"] = ("The workspace could not be read, so these gates are the "
                                "board's own last copy and may be wrong. macOS is denying "
                                "this server access to the records.")
        for o in opportunities:
            o["stage"] = None
    else:
        state["stale"] = False
        for o in opportunities:
            if o.get("id") in recorded:
                o["stage"] = recorded[o["id"]]
    active = [o for o in opportunities if o.get("status") == "active"]
    state["metrics"] = {
        "active": len(active),
        "candidate": len([o for o in active if o.get("stage") == "Candidate"]),
        "approvals": len([o for o in active if o.get("approvalStatus") == "pending"]),
        "pilots": len([o for o in active if o.get("stage") == "Pilot committed"]),
    }
    return state


def create_venture_project(data):
    """Add a local, founder-owned project record without starting any work."""
    name = (data.get("name") or "").strip()
    summary = (data.get("summary") or "").strip()
    next_proof = (data.get("nextProof") or "").strip()
    next_action = (data.get("nextAction") or "").strip()
    if not 4 <= len(name) <= 120:
        return {"error": "Project name must be 4-120 characters."}, 400
    if not 12 <= len(summary) <= 1200:
        return {"error": "Add a concise project summary (12-1,200 characters)."}, 400
    if not 8 <= len(next_proof) <= 900 or not 8 <= len(next_action) <= 900:
        return {"error": "Define both the evidence to find and the next local action."}, 400
    state = load_json(VENTURE_FILE, {"opportunities": [], "decisionLog": []})
    numbers = []
    for row in state.get("opportunities", []):
        match = re.fullmatch(r"OPP-(\d+)", str(row.get("id", "")))
        if match:
            numbers.append(int(match.group(1)))
    project_id = f"OPP-{max(numbers, default=0) + 1:03d}"
    project = {
        "id": project_id,
        "name": name,
        "summary": summary,
        "stage": "Candidate",
        "status": "active",
        "approvalStatus": "pending",
        "nextProof": next_proof,
        "nextAction": next_action,
        "owner": "venture-diligence-economics",
        "brief": f"For {project_id} — {name}: {next_action}\n\nEvidence to establish: {next_proof}\n\nResearch and draft only. Do not contact anyone, spend money, or take external action.",
    }
    state.setdefault("opportunities", []).append(project)
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    state["updatedAt"] = now
    state.setdefault("decisionLog", []).insert(0, {
        "at": now,
        "opportunity": project_id,
        "decision": "created",
        "label": "Created a new local project for founder review",
    })
    save_json(VENTURE_FILE, state)
    workspace = workspace_state()
    workspace_notification(workspace, "project", f"{project_id} is ready for your review", "Define the next proof, then approve or redirect its local scope.", project_id)
    persist_workspace(workspace)
    return {"ok": True, "project": project}, 201


def update_venture_project(opportunity_id, data):
    """Edit the founder-owned fields of an existing Board project locally."""
    state = load_json(VENTURE_FILE, {"opportunities": [], "decisionLog": []})
    project = next((row for row in state.get("opportunities", []) if row.get("id") == opportunity_id), None)
    if not project:
        return {"error": "Unknown project."}, 404
    editable = ("name", "summary", "stage", "status", "approvalStatus", "nextProof", "nextAction", "owner")
    changed = []
    for field in editable:
        if field not in data:
            continue
        value = str(data.get(field) or "").strip()
        if not value:
            return {"error": f"{field} cannot be empty."}, 400
        if field == "stage" and value not in VENTURE_STAGES:
            return {"error": "Unknown project stage."}, 400
        if field == "status" and value not in {"active", "hold", "killed"}:
            return {"error": "Unknown project status."}, 400
        if field == "approvalStatus" and value not in {"pending", "approved"}:
            return {"error": "Unknown approval state."}, 400
        if project.get(field) != value:
            project[field] = value
            changed.append(field)
    if not changed:
        return {"ok": True, "project": project, "message": "No project fields changed."}, 200
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    state["updatedAt"] = now
    state.setdefault("decisionLog", []).insert(0, {
        "at": now, "opportunity": opportunity_id, "decision": "edited",
        "label": "Updated project fields: " + ", ".join(changed),
    })
    save_json(VENTURE_FILE, state)
    workspace = workspace_state()
    workspace_notification(workspace, "project", f"{opportunity_id} project details updated", "Review the changed scope and next action.", opportunity_id)
    persist_workspace(workspace)
    return {"ok": True, "project": project, "message": "Project updated locally."}, 200


def project_workspace_payload(opportunity_id):
    venture = venture_payload()
    project = next((row for row in venture.get("opportunities", []) if row.get("id") == opportunity_id), None)
    if not project:
        return {"error": "Unknown project."}, 404
    state = workspace_state()
    tasks = [row for row in state["tasks"] if row.get("projectId") == opportunity_id]
    links = state["planLinks"].get(opportunity_id, [])
    drafts = [row for row in state["externalDrafts"] if row.get("projectId") == opportunity_id]
    local_runs = [row for row in orchestration_history(100) if row.get("sourceOpportunity") == opportunity_id]
    return {
        "project": project, "tasks": tasks, "planLinks": links,
        "externalDrafts": drafts, "runs": local_runs,
        "history": [row for row in venture.get("decisionLog", []) if row.get("opportunity") == opportunity_id][:18],
    }, 200


def create_workspace_task(data):
    project_id = (data.get("projectId") or "").strip()
    title = (data.get("title") or "").strip()
    if not project_id or not any(row.get("id") == project_id for row in venture_payload().get("opportunities", [])):
        return {"error": "Choose a valid project."}, 400
    if not 3 <= len(title) <= 220:
        return {"error": "Task title must be 3-220 characters."}, 400
    due = (data.get("due") or "").strip()
    if due and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
        return {"error": "Due date must be YYYY-MM-DD."}, 400
    state = workspace_state()
    task = {"id": uuid.uuid4().hex[:12], "projectId": project_id, "title": title,
            "detail": (data.get("detail") or "").strip(), "due": due,
            "status": "open", "created": time.time(), "updated": time.time()}
    state["tasks"].insert(0, task)
    workspace_notification(state, "task", f"Task added: {title}", "Personal task awaiting your follow-through.", project_id)
    persist_workspace(state)
    return {"ok": True, "task": task}, 201


def update_workspace_task(task_id, data):
    state = workspace_state()
    task = next((row for row in state["tasks"] if row.get("id") == task_id), None)
    if not task:
        return {"error": "Unknown task."}, 404
    status = (data.get("status") or "").strip()
    if status not in {"open", "doing", "done", "blocked"}:
        return {"error": "Use open, doing, done, or blocked."}, 400
    task["status"] = status
    task["updated"] = time.time()
    if status == "done":
        workspace_notification(state, "task", f"Task completed: {task['title']}", "This result is ready to include in your next review.", task.get("projectId"))
    persist_workspace(state)
    return {"ok": True, "task": task}, 200


def link_project_plan(opportunity_id, data):
    path = (data.get("path") or "").strip()
    document, error = project_document(path)
    if error:
        return {"error": error}, 404
    if not any(row.get("id") == opportunity_id for row in venture_payload().get("opportunities", [])):
        return {"error": "Unknown project."}, 404
    state = workspace_state()
    links = state["planLinks"].setdefault(opportunity_id, [])
    if not any(row.get("path") == document["path"] for row in links):
        links.append({"path": document["path"], "name": document.get("name") or os.path.basename(document["path"]), "linked": time.time()})
        workspace_notification(state, "plan", f"Plan linked to {opportunity_id}", document["path"], opportunity_id)
        persist_workspace(state)
    return {"ok": True, "links": links}, 200


def create_external_draft(data):
    """Create a reviewable action package; never calls a write-capable connector."""
    project_id = (data.get("projectId") or "").strip()
    kind = (data.get("kind") or "").strip().lower()
    title = (data.get("title") or "").strip()
    body = (data.get("body") or "").strip()
    if kind not in {"email", "calendar"}:
        return {"error": "Use an email or calendar action draft."}, 400
    if not project_id or not any(row.get("id") == project_id for row in venture_payload().get("opportunities", [])):
        return {"error": "Choose a valid project."}, 400
    if not 3 <= len(title) <= 180 or not 8 <= len(body) <= 5000:
        return {"error": "Give the action a title and a useful draft body."}, 400
    state = workspace_state()
    item = {"id": uuid.uuid4().hex[:12], "projectId": project_id, "kind": kind,
            "title": title, "body": body, "status": "pending_approval", "created": time.time()}
    state["externalDrafts"].insert(0, item)
    workspace_notification(state, "approval", f"{kind.title()} draft needs approval", title, project_id)
    persist_workspace(state)
    return {"ok": True, "draft": item}, 201


def decide_external_draft(draft_id, data):
    action = (data.get("action") or "").strip().lower()
    if action not in {"approve", "reject"}:
        return {"error": "Use approve or reject."}, 400
    state = workspace_state()
    item = next((row for row in state["externalDrafts"] if row.get("id") == draft_id), None)
    if not item:
        return {"error": "Unknown external action draft."}, 404
    if item.get("status") != "pending_approval":
        return {"error": "This draft has already been decided."}, 409
    item["status"] = "approved_manual_handoff" if action == "approve" else "rejected"
    item["decided"] = time.time()
    detail = "Approved for manual handoff; connected services remain read-only." if action == "approve" else "Rejected; no external action was taken."
    workspace_notification(state, "approval", f"External draft {action}d", detail, item.get("projectId"))
    persist_workspace(state)
    return {"ok": True, "draft": item, "message": detail}, 200


def notifications_payload():
    state = workspace_state()
    rows = sorted(state["notifications"], key=lambda row: row.get("created", 0), reverse=True)
    return {"notifications": rows[:80], "unread": len([row for row in rows if not row.get("read")])}


def read_notification(notification_id):
    state = workspace_state()
    item = next((row for row in state["notifications"] if row.get("id") == notification_id), None)
    if not item:
        return {"error": "Unknown notification."}, 404
    item["read"] = True
    persist_workspace(state)
    return {"ok": True}, 200


def venture_decision(data):
    """Record a founder-controlled local board decision; never sends anything."""
    opportunity_id = (data.get("opportunity") or "").strip()
    decision = (data.get("decision") or "").strip().lower()
    # Approving is used for two different things: authorising the owning
    # specialist to start, and clearing the way to advance a gate. Only the
    # first should spend a run, so the caller says which it meant.
    dispatch = bool(data.get("dispatch"))
    if decision not in {"approve", "advance", "hold", "kill", "resume"}:
        return {"error": "Unknown board decision."}, 400

    state = load_json(VENTURE_FILE, {"opportunities": [], "decisionLog": []})
    opportunity = next((o for o in state.get("opportunities", []) if o.get("id") == opportunity_id), None)
    if not opportunity:
        return {"error": "Unknown opportunity."}, 404

    if decision == "approve":
        opportunity["approvalStatus"] = "approved"
        label = "Approved the current research or outreach scope"
    elif decision == "advance":
        if opportunity.get("approvalStatus") != "approved":
            return {"error": "Approve the current scope before advancing this thesis."}, 409

        # Advance from the gate the AGENTS recorded, not the board's own copy.
        # This used to increment a counter with nothing behind it, which is how
        # a thesis reached "Pilot committed" while every lead was still waiting
        # for approval to make first contact.
        gates = pipeline_gates()
        if gates is None:
            return {"error": "Refused: the workspace record cannot be read, so the gate this "
                             "thesis is actually at is unknown."}, 409
        recorded = gates.get(opportunity_id)
        current = recorded or opportunity.get("stage", VENTURE_STAGES[0])
        index = VENTURE_STAGES.index(current) if current in VENTURE_STAGES else 0
        if index >= len(VENTURE_STAGES) - 1:
            return {"error": "This opportunity is already at the final gate."}, 409

        target = VENTURE_STAGES[index + 1]
        proof = {
            "Qualified thesis": "an economic mechanism, alternatives, risks and a target-account definition",
            "Validated": "repeated customer evidence, a scoped paid-pilot offer and a measurement method",
            "Pilot committed": "a signed pilot, deposit, or explicit paid-pilot agreement",
        }.get(target, "the proof this gate requires")

        err = set_pipeline_gate(opportunity_id, target)
        if err:
            return {"error": f"Refused: the workspace record could not be updated ({err})."}, 409

        opportunity["stage"] = target
        opportunity["approvalStatus"] = "pending"
        label = f"Advanced from {current} to {target}"
        append_decision(opportunity_id, label,
                        f"Requires {proof}. Cite the supporting evidence IDs.")
    elif decision == "hold":
        opportunity["status"] = "hold"
        label = "Put the thesis on hold"
    elif decision == "kill":
        opportunity["status"] = "killed"
        label = "Killed the thesis"
    else:
        opportunity["status"] = "active"
        label = "Resumed the thesis"

    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    state["updatedAt"] = now
    state.setdefault("decisionLog", []).insert(0, {
        "at": now,
        "opportunity": opportunity_id,
        "decision": decision,
        "label": label,
    })
    if decision != "advance":      # advance wrote its own row above
        append_decision(opportunity_id, label,
                        "Recorded from the Command Center board.")

    save_json(VENTURE_FILE, state)
    workspace = workspace_state()
    workspace_notification(workspace, "decision", f"{opportunity_id}: {label}", "Board decision recorded locally.", opportunity_id)
    persist_workspace(workspace)
    result = {"ok": True, "opportunity": opportunity, "decision": label}

    # Hand the approved thesis straight to whoever owns it, so an approval
    # turns into work instead of a note that something is owed.
    if dispatch and decision == "approve":
        owner = (opportunity.get("owner") or "").strip()
        brief = (opportunity.get("brief") or "").strip()
        if owner and brief:
            job = new_job(owner, f"{opportunity_id} - {opportunity.get('name', '')}".strip(" -"), brief)
            result["job"] = {"id": job["id"], "skill": owner, "label": job["label"]}
        else:
            result["dispatchError"] = "This thesis has no owner and brief to hand it to."

    return result, 200


def log_run(job):
    """Append a finished run so counts survive a restart.

    /api/history only holds the last MAX_HISTORY runs in memory, which is fine
    for the strip on the dashboard but useless for "runs today".
    """
    try:
        with open(RUNLOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "id": job["id"], "skill": job["skill"], "label": job["label"],
                "status": job["status"], "started": job["started"],
                "elapsed": int((job["ended"] or time.time()) - job["started"]),
                # the archived note is the only copy of the transcript once the
                # process restarts, so the log has to carry the path
                "note": job.get("note"),
            }) + "\n")
    except Exception as exc:
        print(f"[command-center] could not append to the run log: {exc}")


def read_runlog(since=None):
    out = []
    try:
        with open(RUNLOG, encoding="utf-8") as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if since is None or r.get("started", 0) >= since:
                    out.append(r)
    except FileNotFoundError:
        pass
    return out


# --- run history -----------------------------------------------------------

def merged_history(limit=200):
    """Every run we know about: the run log on disk, plus anything still live.

    /api/history used to read only the in-memory table, so the RUNS view reset
    to empty every time the server restarted even though runs.jsonl had the
    whole record. Disk is the base; live jobs override by id so a job that is
    still running reports "running" rather than its last logged state.
    """
    rows = {}
    for r in read_runlog():
        if r.get("id"):
            rows[r["id"]] = dict(r, live=False)
    with LOCK:
        for jid in ORDER:
            j = JOBS.get(jid)
            if not j:
                continue
            rows[jid] = {
                "id": j["id"], "skill": j["skill"], "label": j["label"],
                "status": j["status"], "started": j["started"],
                "elapsed": int((j["ended"] or time.time()) - j["started"]),
                "note": j.get("note"), "live": True,
            }
    out = sorted(rows.values(), key=lambda r: r.get("started", 0), reverse=True)
    return out[:limit]


def run_stats(runs):
    day = time.time() - 86400
    week = time.time() - 7 * 86400
    done = [r for r in runs if r.get("status") == "done"]
    elapsed = [r.get("elapsed", 0) for r in done if r.get("elapsed")]
    by_skill = {}
    for r in runs:
        s = r.get("skill") or "ad-hoc"
        by_skill[s] = by_skill.get(s, 0) + 1
    return {
        "total": len(runs),
        "today": len([r for r in runs if r.get("started", 0) >= day]),
        "week": len([r for r in runs if r.get("started", 0) >= week]),
        "faults": len([r for r in runs if r.get("status") == "fault"]),
        "avgSeconds": int(sum(elapsed) / len(elapsed)) if elapsed else 0,
        "topSkills": sorted(by_skill.items(), key=lambda kv: -kv[1])[:8],
    }


# --- vault archive ---------------------------------------------------------

def vault_notes(limit=200):
    """The archived run notes sitting in the vault, newest first.

    Returns (notes, error). An empty list on its own is ambiguous — it reads on
    the page as "nothing archived yet" when the real cause may be that macOS is
    refusing this process access to the folder. The caller passes the reason
    through so the page can say which.
    """
    out = []
    root = os.path.join(WORKDIR, ARCHIVE_DIR)
    try:
        names = os.listdir(root)
    except PermissionError as exc:
        print(f"[command-center] cannot list {root}: {exc}")
        return out, (
            "macOS is denying this server access to the archive folder. "
            "Grant Full Disk Access to the interpreter the launch agent runs "
            f"({sys.executable}) in System Settings \u2192 Privacy & Security, "
            "then restart the agent.")
    except OSError as exc:
        print(f"[command-center] cannot list {root}: {exc}")
        return out, f"Could not read {root}: {exc}"
    for name in names:
        if not name.endswith(".md"):
            continue
        path = os.path.join(root, name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        out.append({
            "name": name,
            "rel": os.path.join(ARCHIVE_DIR, name),
            "bytes": st.st_size,
            "modified": st.st_mtime,
        })
    out.sort(key=lambda n: n["modified"], reverse=True)
    return out[:limit], None


def vault_note(name):
    """Read one archived note. Refuses anything that escapes the archive dir."""
    if not name or "/" in name or "\\" in name or not name.endswith(".md"):
        return None
    root = os.path.realpath(os.path.join(WORKDIR, ARCHIVE_DIR))
    path = os.path.realpath(os.path.join(root, name))
    if not path.startswith(root + os.sep):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


# --- canonical Obsidian project documents ---------------------------------
# Project plans stay in the vault. Nova never writes a plan directly from an
# agent response: it first saves a draft containing the original and proposed
# text, and a founder must approve that exact draft before a write occurs.

PROJECTS_DIR = "10 Projects"
PROJECT_DRAFT_FILE = "project-drafts.json"
PROJECT_DRAFT_LOCK = threading.Lock()
PROJECT_DRAFTS = load_json(PROJECT_DRAFT_FILE, {"items": []}).get("items", [])


def project_document_path(rel):
    """Resolve only Markdown beneath 10 Projects; reject traversal and files elsewhere."""
    if not isinstance(rel, str) or not rel.endswith(".md"):
        return None
    rel = rel.replace("\\", "/").lstrip("/")
    prefix = PROJECTS_DIR + "/"
    if not rel.startswith(prefix):
        return None
    root = os.path.realpath(os.path.join(WORKDIR, PROJECTS_DIR))
    path = os.path.realpath(os.path.join(WORKDIR, rel))
    if not path.startswith(root + os.sep):
        return None
    return path


def project_documents(limit=240):
    root = os.path.join(WORKDIR, PROJECTS_DIR)
    try:
        found = []
        for base, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in files:
                if not name.endswith(".md"):
                    continue
                path = os.path.join(base, name)
                try:
                    st = os.stat(path)
                except OSError:
                    continue
                found.append({
                    "path": os.path.relpath(path, WORKDIR).replace(os.sep, "/"),
                    "name": name[:-3],
                    "modified": st.st_mtime,
                    "bytes": st.st_size,
                })
        found.sort(key=lambda row: row["modified"], reverse=True)
        return found[:limit], None
    except PermissionError:
        return [], ("macOS is denying this server access to the project vault. "
                    f"Grant Full Disk Access to {sys.executable}, then restart the agent.")
    except OSError as exc:
        return [], f"Could not read project vault: {exc}"


def project_document(rel):
    path = project_document_path(rel)
    if not path:
        return None, "Only Markdown under 10 Projects can be opened."
    try:
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        return {"path": rel, "body": body, "modified": os.path.getmtime(path)}, None
    except PermissionError:
        return None, ("macOS is denying this server access to the project vault. "
                      f"Grant Full Disk Access to {sys.executable}, then restart the agent.")
    except OSError as exc:
        return None, f"Could not read project document: {exc}"


def persist_project_drafts():
    with PROJECT_DRAFT_LOCK:
        save_json(PROJECT_DRAFT_FILE, {"items": PROJECT_DRAFTS[-80:]})


def project_draft_view(item):
    return json.loads(json.dumps(item))


def create_project_draft(data):
    rel = (data.get("path") or "").strip()
    proposed = data.get("proposed")
    if not isinstance(proposed, str):
        return {"error": "A draft needs proposed Markdown content."}, 400
    current, error = project_document(rel)
    if error:
        return {"error": error}, 400
    item = {
        "id": uuid.uuid4().hex[:12],
        "path": rel,
        "original": current["body"],
        "proposed": proposed,
        "instruction": (data.get("instruction") or "").strip(),
        "status": "pending_approval",
        "created": time.time(),
        "approved": None,
    }
    with PROJECT_DRAFT_LOCK:
        PROJECT_DRAFTS.append(item)
    persist_project_drafts()
    return project_draft_view(item), 201


def project_draft_action(draft_id, action):
    with PROJECT_DRAFT_LOCK:
        item = next((row for row in PROJECT_DRAFTS if row.get("id") == draft_id), None)
        if not item:
            return {"error": "Unknown project draft."}, 404
        if item.get("status") != "pending_approval":
            return {"error": "This draft has already been decided."}, 409
        if action == "reject":
            item["status"] = "rejected"
            item["approved"] = time.time()
            result = project_draft_view(item)
        elif action == "approve":
            current, error = project_document(item["path"])
            if error:
                return {"error": error}, 400
            if current["body"] != item["original"]:
                return {"error": "The source changed after this draft was created. Open it again and make a fresh draft."}, 409
            path = project_document_path(item["path"])
            try:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(item["proposed"])
            except OSError as exc:
                return {"error": f"Could not write approved draft: {exc}"}, 500
            item["status"] = "approved_written"
            item["approved"] = time.time()
            result = project_draft_view(item)
        else:
            return {"error": "Use approve or reject."}, 400
    persist_project_drafts()
    return result, 200


# --- editable orbit state --------------------------------------------------

STATE_LISTS = ("decisions", "needs")


def state_write(data):
    """Add, close, or reorder a decision / needs-Tyler item.

    The morning brief still overwrites this file wholesale when it emits a
    json fence; these edits are what happens between briefs.
    """
    action = (data.get("action") or "").strip().lower()
    bucket = (data.get("list") or "").strip().lower()
    if bucket not in STATE_LISTS:
        return {"error": "Unknown list."}, 400

    state = load_json(os.path.basename(STATE_FILE), {})
    items = list(state.get(bucket, []))

    if action == "add":
        title = (data.get("title") or "").strip()
        if not title:
            return {"error": "An item needs a title."}, 400
        items.insert(0, {"title": title, "meta": (data.get("meta") or "").strip()})
    elif action == "close":
        i = data.get("index")
        if not isinstance(i, int) or not 0 <= i < len(items):
            return {"error": "No such item."}, 404
        items.pop(i)
    elif action == "move":
        i, j = data.get("index"), data.get("to")
        if not isinstance(i, int) or not isinstance(j, int):
            return {"error": "Bad move."}, 400
        if not (0 <= i < len(items) and 0 <= j < len(items)):
            return {"error": "No such item."}, 404
        items.insert(j, items.pop(i))
    else:
        return {"error": "Unknown action."}, 400

    state[bucket] = items
    state["_editedAt"] = time.time()
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2)
    except Exception as exc:
        return {"error": f"Could not save: {exc}"}, 500
    return {"ok": True, bucket: items}, 200


SKILLS_DIR = os.path.expanduser("~/.claude/skills")
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,39}$")


def agents_payload():
    """Every agent, its group, its wiring, and whether a skill file backs it."""
    skills = load_json("skills.json", [])
    runs = read_runlog()
    stats = {}
    for r in runs:
        st = stats.setdefault(r["skill"], {"runs": 0, "last": 0, "secs": 0, "fault": 0})
        st["runs"] += 1
        st["secs"] += r.get("elapsed", 0)
        st["last"] = max(st["last"], r.get("started", 0))
        if r["status"] == "fault":
            st["fault"] += 1

    agents = []
    for sk in skills:
        st = stats.get(sk["skill"], {"runs": 0, "last": 0, "secs": 0, "fault": 0})
        skill_md = os.path.join(SKILLS_DIR, sk["skill"], "SKILL.md")
        agents.append({
            "skill": sk["skill"],
            "label": sk["label"],
            "group": sk.get("group", "Ungrouped"),
            "ask": bool(sk.get("ask")),
            "placeholder": sk.get("placeholder", ""),
            "prompt": sk.get("prompt", ""),
            "hasFile": os.path.exists(skill_md),
            "runs": st["runs"],
            "faults": st["fault"],
            "avg": int(st["secs"] / st["runs"]) if st["runs"] else 0,
            "last": st["last"],
        })

    groups = {}
    for a in agents:
        groups.setdefault(a["group"], []).append(a["skill"])

    tools = [a for a in CONFIG.get("claude_args", []) if a.startswith("mcp__")]
    structure = [
        {"layer": "Surface", "name": "Command Center", "detail": f"127.0.0.1:{PORT} · launchd"},
        {"layer": "Runtime", "name": os.path.basename(CLAUDE_BIN), "detail": "claude -p, one process per run"},
        {"layer": "Context", "name": "Working folder", "detail": WORKDIR},
        {"layer": "Context", "name": "Instructions", "detail": "CLAUDE.md, loaded every run"},
        {"layer": "Tools", "name": "Read-only connectors", "detail": f"{len(tools)} tools · calendar + mail"},
        {"layer": "Memory", "name": "Vault archive", "detail": ARCHIVE_DIR},
        {"layer": "Memory", "name": "Run log", "detail": f"{len(runs)} runs recorded"},
        {"layer": "Schedule", "name": "launchd routines", "detail": f"{len(read_routines())} scheduled"},
    ]
    return {
        "agents": agents,
        "groups": [{"name": g, "skills": v} for g, v in groups.items()],
        "structure": structure,
        "skillsDir": SKILLS_DIR,
        "withFile": len([a for a in agents if a["hasFile"]]),
    }


def integrations_payload():
    """Expose only connector capability and safety scope, never credentials."""
    tools = [item for item in CONFIG.get("claude_args", []) if isinstance(item, str) and item.startswith("mcp__")]
    vault_rows, vault_error = vault_notes(limit=1)
    calendar_tools = [item for item in tools if "Google_Calendar" in item]
    gmail_tools = [item for item in tools if "Gmail" in item]
    return {"integrations": [
        {"id": "claude", "name": "Claude runtime", "status": "configured" if CLAUDE_BIN else "missing", "scope": "Local Claude runner · one process per task", "actions": "Runs bounded local work"},
        {"id": "calendar", "name": "Google Calendar", "status": "configured" if calendar_tools else "not_connected", "scope": "Read-only · calendars, events, search, suggestions", "actions": "Cannot create or change calendar events"},
        {"id": "gmail", "name": "Gmail", "status": "configured" if gmail_tools else "not_connected", "scope": "Read-only · threads, messages, labels, drafts", "actions": "Cannot send or modify email"},
        {"id": "vault", "name": "Obsidian Vault", "status": "configured" if not vault_error else "needs_attention", "scope": "Local Markdown + run archive", "actions": "Writes require explicit draft approval"},
        {"id": "crm", "name": "CRM", "status": "not_connected", "scope": "No CRM connector configured", "actions": "Choose a CRM before Nova can read it"},
    ], "toolCount": len(tools)}


def create_agent(data):
    """Register a new agent: a skill file on disk plus a button in skills.json."""
    name = (data.get("name") or "").strip().lower()
    label = (data.get("label") or "").strip()
    group = (data.get("group") or "").strip() or "Ungrouped"
    purpose = (data.get("purpose") or "").strip()
    instructions = (data.get("instructions") or "").strip()
    ask = bool(data.get("ask", True))
    placeholder = (data.get("placeholder") or "").strip()

    if not SLUG_RE.match(name):
        return {"error": "Name must be lower-case letters, digits and dashes (2-40 chars)."}, 400
    if not label:
        return {"error": "Give the button a label."}, 400
    if not purpose:
        return {"error": "Describe when this agent should be used."}, 400

    skills = load_json("skills.json", [])
    if any(s["skill"] == name for s in skills):
        return {"error": f"An agent named {name} already exists."}, 409

    skill_dir = os.path.join(SKILLS_DIR, name)
    skill_md = os.path.join(skill_dir, "SKILL.md")
    created_file = False
    if not os.path.exists(skill_md):
        try:
            os.makedirs(skill_dir, exist_ok=True)
            body = instructions or ("Describe the steps this agent should follow.\n\n"
                                    "Written from Command Center — edit this file to give it real behaviour.")
            with open(skill_md, "w", encoding="utf-8") as fh:
                fh.write(f"---\nname: {name}\ndescription: {purpose}\n---\n\n"
                         f"# {label}\n\n{body}\n")
            created_file = True
        except Exception as exc:
            return {"error": f"Could not write the skill file: {exc}"}, 500

    entry = {"group": group, "label": label, "skill": name,
             "prompt": f"Use the {name} skill.", "ask": ask}
    if placeholder:
        entry["placeholder"] = placeholder
    skills.append(entry)
    try:
        with open(os.path.join(BASE, "skills.json"), "w", encoding="utf-8") as fh:
            json.dump(skills, fh, indent=2, ensure_ascii=False)
    except Exception as exc:
        return {"error": f"Could not update skills.json: {exc}"}, 500

    print(f"[command-center] created agent {name} (skill file: {created_file})")
    return {"ok": True, "skill": name, "createdFile": created_file, "path": skill_md}, 200


def console_payload():
    """Everything the agent console shows, from sources that actually exist."""
    skills = load_json("skills.json", [])
    midnight = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    today = read_runlog(midnight)
    finished = [r for r in today if r["status"] in ("done", "fault", "stopped")]
    done = [r for r in finished if r["status"] == "done"]

    with LOCK:
        live = [{"id": JOBS[j]["id"], "skill": JOBS[j]["skill"], "label": JOBS[j]["label"],
                 "status": JOBS[j]["status"],
                 "elapsed": int((JOBS[j]["ended"] or time.time()) - JOBS[j]["started"])}
                for j in reversed(ORDER)]
    running = [r for r in live if r["status"] == "running"]

    # per-skill volume, newest activity first
    by_skill = {}
    for r in read_runlog():
        b = by_skill.setdefault(r["skill"], {"skill": r["skill"], "runs": 0, "last": 0, "secs": 0})
        b["runs"] += 1
        b["secs"] += r.get("elapsed", 0)
        b["last"] = max(b["last"], r.get("started", 0))
    load_rows = sorted(by_skill.values(), key=lambda b: (-b["runs"], -b["last"]))[:7]
    for b in load_rows:
        entry = next((s for s in skills if s["skill"] == b["skill"]), None)
        b["name"] = entry["label"] if entry else b["skill"]
        b["avg"] = int(b["secs"] / b["runs"]) if b["runs"] else 0

    outcomes = {
        "done": len(done),
        "fault": len([r for r in finished if r["status"] == "fault"]),
        "stopped": len([r for r in finished if r["status"] == "stopped"]),
    }

    # capabilities: what this runner is actually allowed to do
    args = CONFIG.get("claude_args", [])
    tools = [a for a in args if a.startswith("mcp__")]
    caps = [
        {"name": f"{len(skills)} skills installed", "on": bool(skills)},
        {"name": "Google Calendar · read only",
         "on": any("Google_Calendar" in t for t in tools)},
        {"name": "Gmail · read only", "on": any("Gmail" in t for t in tools)},
        {"name": "Vault archive · every run", "on": ARCHIVE},
        {"name": "Sending mail or editing events", "on": False},
        {"name": "File writes", "on": False},
    ]

    yest_start = midnight - 86400
    yesterday = [r for r in read_runlog(yest_start) if r.get("started", 0) < midnight]
    all_runs = read_runlog()
    last = max(all_runs, key=lambda r: r.get("started", 0)) if all_runs else None
    routines = read_routines()
    return {
        "lastRun": last,
        "runsYesterday": len(yesterday),
        "skills": len(skills),
        "skillList": [{"skill": s_["skill"], "label": s_["label"], "group": s_.get("group", "")}
                      for s_ in skills],
        "runsToday": len(finished),
        "successRate": round(100 * len(done) / len(finished)) if finished else None,
        "avgSeconds": int(sum(r.get("elapsed", 0) for r in done) / len(done)) if done else None,
        "running": running,
        "recent": live[:8],
        "loadRows": load_rows,
        "outcomes": outcomes,
        "capabilities": caps,
        "routines": routines,
        "routinesFired": len([r for r in routines if r["status"] == "DONE"]),
        "workdir": WORKDIR,
    }


def read_routines():
    """Scheduled agents, read from launchd rather than a hand-kept list."""
    out = []
    now = time.localtime()
    for path in sorted(glob.glob(os.path.expanduser("~/Library/LaunchAgents/com.tyler.*.plist"))):
        try:
            with open(path, "rb") as fh:
                d = plistlib.load(fh)
        except Exception:
            continue
        cal = d.get("StartCalendarInterval")
        if not cal:
            continue  # a daemon (the runner itself), not a routine
        entries = cal if isinstance(cal, list) else [cal]
        first = entries[0]
        hour, minute = int(first.get("Hour", 0)), int(first.get("Minute", 0))
        weekdays = sorted({e["Weekday"] for e in entries if "Weekday" in e})
        label = d.get("Label", os.path.basename(path))
        name = d.get("NovaSchedule", {}).get("title") or label.replace("com.tyler.", "").replace("-", " ").title()

        # did it run today? the agent's own log is the only honest signal
        status, log = "WAITING", d.get("StandardOutPath")
        if d.get("Disabled"):
            status = "PAUSED"
        scheduled_today = (not weekdays) or (now.tm_wday + 1) % 7 + 1 in weekdays or (now.tm_wday + 1) in weekdays
        if status != "PAUSED" and not scheduled_today:
            status = "OFF TODAY"
        elif status != "PAUSED" and log and os.path.exists(log):
            fresh = time.localtime(os.path.getmtime(log))
            if (fresh.tm_year, fresh.tm_yday) == (now.tm_year, now.tm_yday):
                status = "DONE"
        if status == "WAITING" and (now.tm_hour, now.tm_min) < (hour, minute):
            status = "NEXT" if not out or all(o["status"] != "NEXT" for o in out) else "WAITING"
        out.append({
            "time": f"{hour:02d}:{minute:02d}",
            "name": name,
            "status": status,
            "weekdays": weekdays,
            "id": d.get("NovaSchedule", {}).get("id"),
            "managed": bool(d.get("NovaSchedule")),
            "prompt": d.get("NovaSchedule", {}).get("prompt", ""),
        })
    return sorted(out, key=lambda r: r["time"])


def agenda_payload(days=30):
    """Expose the schedules this local web app can actually read.

    Google Calendar is configured as a read-only tool for bounded Claude runs,
    but it is not a direct server-side event feed. This endpoint therefore
    returns every locally readable launchd occurrence and explicitly reports
    that limitation instead of implying that a personal calendar was synced.
    """
    now = datetime.now().astimezone()
    opportunities = venture_payload().get("opportunities", [])
    entries = []
    weekday_names = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
    for routine in read_routines():
        try:
            hour, minute = (int(part) for part in str(routine.get("time", "00:00")).split(":", 1))
        except (TypeError, ValueError):
            hour, minute = 0, 0
        body = f"{routine.get('name', '')}\n{routine.get('prompt', '')}"
        linked = next((item for item in opportunities if item.get("id") and re.search(rf"\b{re.escape(item['id'])}\b", body, re.I)), None)
        weekdays = {int(day) for day in routine.get("weekdays", []) if str(day).isdigit()}
        for offset in range(max(1, min(int(days or 30), 60))):
            run_day = (now + timedelta(days=offset)).date()
            if weekdays and run_day.isoweekday() not in weekdays:
                continue
            starts_at = datetime.combine(run_day, clock_time(hour, minute), tzinfo=now.tzinfo)
            occurrence_status = "PAUSED" if routine.get("status") == "PAUSED" else "DONE" if run_day == now.date() and routine.get("status") == "DONE" else "SCHEDULED"
            entries.append({
                "id": f"{routine.get('id') or routine.get('name', 'routine')}-{run_day.isoformat()}",
                "routineId": routine.get("id"),
                "title": routine.get("name") or "Scheduled local work",
                "date": run_day.isoformat(),
                "time": f"{hour:02d}:{minute:02d}",
                "timestamp": int(starts_at.timestamp()),
                "timezone": now.tzname() or "Local time",
                "source": "Local launchd routine",
                "status": occurrence_status,
                "recurrence": [weekday_names[day] for day in sorted(weekdays) if day in weekday_names],
                "project": {"id": linked.get("id"), "name": linked.get("name")} if linked else None,
            })
    entries.sort(key=lambda item: (item["timestamp"], item["title"].lower()))
    calendar_configured = any("Google_Calendar" in str(tool) for tool in CONFIG.get("claude_args", []))
    return {
        "timezone": now.tzname() or "Local time",
        "generatedAt": now.isoformat(),
        "items": entries,
        "sources": [
            {"id": "local_launchd", "name": "Local launchd routines", "status": "readable", "detail": f"{len(read_routines())} configured local routine{'s' if len(read_routines()) != 1 else ''}."},
            {"id": "google_calendar", "name": "Google Calendar", "status": "configured_not_direct" if calendar_configured else "not_configured", "detail": "Configured read-only for bounded Chief requests; no direct calendar event feed is available to this web app." if calendar_configured else "No calendar connector is configured."},
        ],
    }


def schedule_paths(schedule_id):
    return (
        os.path.join(LAUNCH_AGENTS_DIR, f"{SCHEDULE_PREFIX}{schedule_id}.plist"),
        os.path.join(SCHEDULE_DIR, f"{schedule_id}.json"),
    )


def schedule_calendar(hour, minute, weekdays):
    return [{"Hour": hour, "Minute": minute, "Weekday": day} for day in weekdays] or [{"Hour": hour, "Minute": minute}]


def launchctl_schedule(action, path):
    """Load/unload a user-created routine. No shell interpolation is used."""
    domain = f"gui/{os.getuid()}"
    try:
        if action == "load":
            subprocess.run(["launchctl", "bootout", domain, path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            result = subprocess.run(["launchctl", "bootstrap", domain, path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
        else:
            result = subprocess.run(["launchctl", "bootout", domain, path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
        return result.returncode == 0, result.stdout.strip()
    except Exception as exc:
        return False, str(exc)


def create_schedule(data):
    """Create or replace a founder-configured local launchd routine."""
    schedule_id = (data.get("id") or data.get("name") or "").strip().lower()
    title = (data.get("title") or schedule_id.replace("-", " ").title()).strip()
    prompt = (data.get("prompt") or "").strip()
    time_text = (data.get("time") or "").strip()
    weekdays = data.get("weekdays", [])
    if not SLUG_RE.match(schedule_id):
        return {"error": "Schedule name must be lower-case letters, digits, and dashes (2-40 characters)."}, 400
    if not title or len(title) > 80 or not prompt or len(prompt) > 6000:
        return {"error": "Provide a short title and a local task prompt (up to 6,000 characters)."}, 400
    match = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", time_text)
    if not match:
        return {"error": "Use a 24-hour time such as 08:30."}, 400
    if not isinstance(weekdays, list) or any(not isinstance(day, int) or day < 1 or day > 7 for day in weekdays):
        return {"error": "Choose valid weekdays."}, 400
    weekdays = sorted(set(weekdays))
    hour, minute = int(match.group(1)), int(match.group(2))
    plist_path, spec_path = schedule_paths(schedule_id)
    os.makedirs(SCHEDULE_DIR, exist_ok=True)
    os.makedirs(LAUNCH_AGENTS_DIR, exist_ok=True)
    spec = {"id": schedule_id, "title": title, "prompt": prompt, "createdAt": time.time()}
    with open(spec_path, "w", encoding="utf-8") as fh:
        json.dump(spec, fh, indent=2, ensure_ascii=False)
    log_path = os.path.expanduser(f"~/Library/Logs/nova-schedule-{schedule_id}.log")
    plist = {
        "Label": f"{SCHEDULE_PREFIX}{schedule_id}",
        "ProgramArguments": [sys.executable, os.path.join(BASE, "scheduled-run.py"), spec_path],
        "StartCalendarInterval": schedule_calendar(hour, minute, weekdays),
        "RunAtLoad": False,
        "WorkingDirectory": BASE,
        "StandardOutPath": log_path,
        "StandardErrorPath": log_path,
        "NovaSchedule": {"id": schedule_id, "prompt": prompt, "title": title},
    }
    with open(plist_path, "wb") as fh:
        plistlib.dump(plist, fh)
    loaded, detail = launchctl_schedule("load", plist_path)
    if not loaded:
        return {"error": f"Saved the schedule but launchd could not load it: {detail or 'unknown error'}"}, 500
    return {"ok": True, "schedule": {"id": schedule_id, "title": title, "time": f"{hour:02d}:{minute:02d}", "weekdays": weekdays}}, 201


def schedule_action(schedule_id, data):
    action = (data.get("action") or "").strip().lower()
    if not SLUG_RE.match(schedule_id) or action not in {"pause", "resume", "delete"}:
        return {"error": "Unknown schedule action."}, 400
    plist_path, spec_path = schedule_paths(schedule_id)
    if not os.path.exists(plist_path):
        return {"error": "Unknown managed schedule."}, 404
    try:
        with open(plist_path, "rb") as fh:
            plist = plistlib.load(fh)
        if not plist.get("NovaSchedule"):
            return {"error": "Only Nova-managed schedules can be changed here."}, 403
        if action == "delete":
            launchctl_schedule("unload", plist_path)
            os.remove(plist_path)
            if os.path.exists(spec_path):
                os.remove(spec_path)
            return {"ok": True, "action": "deleted"}, 200
        plist["Disabled"] = action == "pause"
        with open(plist_path, "wb") as fh:
            plistlib.dump(plist, fh)
        if action == "pause":
            launchctl_schedule("unload", plist_path)
        else:
            ok, detail = launchctl_schedule("load", plist_path)
            if not ok:
                return {"error": f"Could not resume schedule: {detail or 'unknown error'}"}, 500
        return {"ok": True, "action": f"{action}d"}, 200
    except OSError as exc:
        return {"error": f"Could not change schedule: {exc}"}, 500


def archive_job(job):
    if not ARCHIVE:
        return
    try:
        started = time.localtime(job["started"])
        note_stamp = time.strftime("%Y-%m-%d %H%M", started)
        label = slugify(job["label"])
        out_dir = os.path.join(WORKDIR, ARCHIVE_DIR)
        os.makedirs(out_dir, exist_ok=True)

        # The note name is derived, not discovered, so it can be settled before
        # the run is logged — log_run has to carry it, and it runs first so a
        # failure further down still leaves the run on the record.
        fname = f"{note_stamp} {label}.md"
        job["note"] = os.path.join(ARCHIVE_DIR, fname)

        attachments = harvest_files(job, note_stamp)
        attachments += harvest_fenced_html(job, note_stamp)
        capture_state(job)
        log_run(job)

        # drop the two echoed "$ ..." provenance lines from the transcript body
        lines = job["lines"]
        body = "".join(lines)
        if body.startswith("$ cd "):
            body = body.split("\n\n", 1)[-1]

        fm = [
            "---",
            "type: run",
            f"skill: {job['skill']}",
            f"label: {job['label']}",
            f"status: {job['status']}",
            f"date: {time.strftime('%Y-%m-%d', started)}",
            f"started: {time.strftime('%Y-%m-%dT%H:%M:%S', started)}",
            f"duration_s: {int((job['ended'] or time.time()) - job['started'])}",
            "tags:",
            "  - run",
            "  - command-center",
            "---",
            "",
            f"# {job['label']}",
            "",
            "> [!info] Prompt",
            "> " + job["prompt"].replace("\n", "\n> "),
            "",
        ]
        if attachments:
            fm.append("## Files")
            fm.append("")
            for name in attachments:
                # Obsidian only renders embeds for images and PDFs; anything
                # else (an HTML brief, a CSV) has to be a plain link.
                ext = os.path.splitext(name)[1].lower()
                embed = ext in (".png", ".jpg", ".jpeg", ".svg", ".pdf")
                fm.append(f"- {'!' if embed else ''}[[{name}]]")
            fm.append("")
        fm.append("## Output")
        fm.append("")
        fm.append(body.rstrip())
        fm.append("")

        with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as fh:
            fh.write("\n".join(fm))
        threading.Thread(target=run_mirror, args=("after a run",), daemon=True).start()
        print(f"[command-center] archived -> {fname}"
              + (f" (+{len(attachments)} file(s))" if attachments else ""))
    except Exception as exc:
        print(f"[command-center] archive failed: {exc}")


def job_view(job, offset=0):
    with LOCK:
        lines = job["lines"]
        chunk = "".join(lines[offset:])
        next_offset = len(lines)
    return {
        "id": job["id"],
        "skill": job["skill"],
        "label": job["label"],
        "status": job["status"],
        "started": job["started"],
        "ended": job["ended"],
        "elapsed": int((job["ended"] or time.time()) - job["started"]),
        "chunk": chunk,
        "offset": next_offset,
        "note": job.get("note"),
    }


# --- request origin guard --------------------------------------------------
# Binding to 127.0.0.1 keeps other machines out; it does NOT keep other *pages*
# out. A POST with Content-Type: text/plain is a CORS "simple request", so any
# site loaded in the browser can fire one at localhost with no preflight, and
# the body is still parsed as JSON. That was harmless while the runner could
# only read a calendar. It is not harmless once skills can write files and run
# commands, so state-changing routes now require a same-origin caller.

ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}", f"[::1]:{PORT}"}


def origin_ok(handler):
    """True when this request plausibly came from the dashboard itself."""
    origin = handler.headers.get("Origin")
    if origin:
        # a browser sets this on cross-site POSTs and cannot be forged by script
        host = origin.split("//", 1)[-1]
        return host in ALLOWED_HOSTS
    # No Origin: curl, or a same-origin GET. Fall back to the Host header, which
    # also blocks DNS-rebinding names that resolve to 127.0.0.1.
    return (handler.headers.get("Host") or "") in ALLOWED_HOSTS


class Handler(BaseHTTPRequestHandler):
    server_version = "CommandCenter/1.0"

    def log_message(self, fmt, *args):
        pass

    def send_json(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, name, ctype):
        try:
            with open(os.path.join(BASE, name), "rb") as fh:
                body = fh.read()
        except OSError:
            self.send_error(404, "Not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)

        # the Jarvis Dashboards design is the home page; build-orbit.py makes it
        if route in ("/", "/index.html", "/orbit", "/orbit.html"):
            return self.send_file("orbit.html", "text/html; charset=utf-8")

        # Classic is the review surface; keep dashboard.html available as the
        # original low-level fallback rather than replacing it.
        if route in ("/classic", "/classic.html"):
            return self.send_file("classic.html", "text/html; charset=utf-8")
        if route == "/dashboard.html":
            return self.send_file("dashboard.html", "text/html; charset=utf-8")

        if route in ("/agents", "/console", "/console.html"):
            return self.send_file("console.html", "text/html; charset=utf-8")

        if route in ("/venture", "/venture.html", "/board"):
            return self.send_file("venture.html", "text/html; charset=utf-8")

        if route in ("/runs", "/runs.html"):
            return self.send_file("runs.html", "text/html; charset=utf-8")

        if route in ("/outbox", "/outbox.html"):
            return self.send_file("outbox.html", "text/html; charset=utf-8")

        if route in ("/vault", "/vault.html"):
            return self.send_file("vault.html", "text/html; charset=utf-8")

        if route == "/nav.js":
            return self.send_file("nav.js", "application/javascript")

        if route == "/theme.js":
            return self.send_file("theme.js", "application/javascript")

        if route == "/theme.css":
            return self.send_file("theme.css", "text/css; charset=utf-8")

        if route == "/nova-workspaces.css":
            return self.send_file("nova-workspaces.css", "text/css; charset=utf-8")

        if route == "/nova-workspaces.js":
            return self.send_file("nova-workspaces.js", "application/javascript")

        if route == "/orbit-live.js":
            return self.send_file("orbit-live.js", "application/javascript")

        if route == "/particle-cloud.js":
            return self.send_file("particle-cloud.js", "application/javascript")

        if route == "/assets/nova-living-orb-v1.png":
            return self.send_file("assets/nova-living-orb-v1.png", "image/png")

        if route == "/assets/nova-orbital-halo-v1.png":
            return self.send_file("assets/nova-orbital-halo-v1.png", "image/png")

        if route == "/api/skills":
            return self.send_json({
                "workdir": WORKDIR,
                "skills": load_json("skills.json", []),
            })

        if route == "/api/agents":
            return self.send_json(agents_payload())

        if route == "/api/integrations":
            return self.send_json(integrations_payload())

        if route == "/api/console":
            return self.send_json(console_payload())

        if route == "/api/state":
            state = load_json("orbit-state.json", {})
            state["routines"] = read_routines()
            return self.send_json(state)

        if route == "/api/venture":
            return self.send_json(venture_payload())

        if route.startswith("/api/workspace/project/"):
            opportunity_id = route[len("/api/workspace/project/"):].strip("/")
            payload, code = project_workspace_payload(opportunity_id)
            return self.send_json(payload, code)

        if route == "/api/workspace/tasks":
            state = workspace_state()
            return self.send_json({"tasks": state["tasks"]})

        if route == "/api/notifications":
            return self.send_json(notifications_payload())

        if route == "/api/history":
            limit = int(query.get("limit", ["200"])[0])
            runs = merged_history(limit)
            return self.send_json({"runs": runs, "stats": run_stats(merged_history(10000))})

        if route == "/api/orchestrations":
            limit = int(query.get("limit", ["30"])[0])
            return self.send_json({"orchestrations": orchestration_history(limit)})

        if route == "/api/schedules":
            return self.send_json({"schedules": [row for row in read_routines() if row.get("managed")]})

        if route == "/api/agenda":
            return self.send_json(agenda_payload())

        if route.startswith("/api/orchestrations/"):
            orchestration_id = route.split("/api/orchestrations/", 1)[1]
            found = next((row for row in orchestration_history(100)
                          if row.get("id") == orchestration_id), None)
            if not found:
                return self.send_json({"error": "Unknown orchestration."}, 404)
            return self.send_json(found)

        if route == "/api/memory/search":
            query_text = query.get("q", [""])[0]
            return self.send_json({"query": query_text, "results": recall_memory(query_text)})

        if route == "/api/next-id":
            ids, err = allocate_ids(query.get("prefix", [""])[0],
                                    query.get("count", ["1"])[0])
            if err:
                return self.send_json({"error": err}, 400)
            return self.send_json({"ids": ids, "next": ids[0]})

        if route == "/api/outbox":
            items, err = outbox_items()
            return self.send_json({"items": items, "error": err})

        if route == "/api/intents":
            if not CONFIG.get("supabase", {}).get("service_key"):
                return self.send_json({"items": [], "error": "No Supabase key configured."})
            try:
                import importlib
                import mirror as m
                importlib.reload(m)
                return self.send_json({"items": m.recent_intents(25), "error": None})
            except BaseException as exc:
                return self.send_json({"items": [], "error": f"Could not read intents: {exc}"})

        if route == "/api/vault":
            notes, err = vault_notes()
            return self.send_json({
                "dir": ARCHIVE_DIR,
                "workdir": WORKDIR,
                "notes": notes,
                "error": err,
            })

        if route == "/api/vault/search":
            question = query.get("q", [""])[0].strip()
            if not question:
                return self.send_json({"items": []})
            return self.send_json({"items": recall_memory(question)})

        if route == "/api/vault/note":
            name = query.get("name", [""])[0]
            body = vault_note(name)
            if body is None:
                return self.send_json({"error": "No such note."}, 404)
            return self.send_json({"name": name, "body": body})

        if route == "/api/projects":
            documents, error = project_documents()
            return self.send_json({"documents": documents, "error": error})

        if route == "/api/projects/document":
            rel = query.get("path", [""])[0]
            document, error = project_document(rel)
            if error:
                return self.send_json({"error": error}, 404)
            return self.send_json(document)

        if route == "/api/projects/drafts":
            with PROJECT_DRAFT_LOCK:
                drafts = [project_draft_view(item) for item in PROJECT_DRAFTS]
            drafts.sort(key=lambda item: item.get("created", 0), reverse=True)
            return self.send_json({"drafts": drafts})

        if route.startswith("/api/job/"):
            job_id = route.split("/api/job/", 1)[1]
            job = JOBS.get(job_id)
            if not job:
                return self.send_json({"error": "unknown job"}, 404)
            offset = int(query.get("offset", ["0"])[0])
            return self.send_json(job_view(job, offset))

        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path
        if not origin_ok(self):
            return self.send_json(
                {"error": "Refused: this request did not come from the dashboard."}, 403)
        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self.send_json({"error": "bad request body"}, 400)

        if route == "/api/agents":
            payload, code = create_agent(data)
            return self.send_json(payload, code)

        if route == "/api/run":
            prompt = (data.get("prompt") or "").strip()
            if not prompt:
                return self.send_json({"error": "Nothing to run — the prompt is empty."}, 400)
            with LOCK:
                busy = sum(1 for j in JOBS.values() if j.get("status") == "running")
            if busy >= MAX_CONCURRENT_RUNS:
                return self.send_json({
                    "error": f"{busy} run{'' if busy == 1 else 's'} "
                             f"{'is' if busy == 1 else 'are'} already going, which is the "
                             f"limit ({MAX_CONCURRENT_RUNS}). Wait for one to finish, or stop one."
                }, 429)
            job = new_job(
                data.get("skill") or "ad-hoc",
                data.get("label") or "Ad-hoc request",
                prompt,
            )
            return self.send_json(job_view(job))

        if route == "/api/orchestrations":
            payload, code = create_orchestration(data)
            return self.send_json(payload, code)

        if route == "/api/speak":
            payload, code = local_speech(data.get("text", ""))
            return self.send_json(payload, code)

        if route == "/api/speak/stop":
            payload, code = stop_local_speech()
            return self.send_json(payload, code)

        if route == "/api/schedules":
            payload, code = create_schedule(data)
            return self.send_json(payload, code)

        if route.startswith("/api/schedules/") and route.endswith("/action"):
            schedule_id = route[len("/api/schedules/"):-len("/action")].strip("/")
            payload, code = schedule_action(schedule_id, data)
            return self.send_json(payload, code)

        if route == "/api/projects/drafts":
            payload, code = create_project_draft(data)
            return self.send_json(payload, code)

        if route.startswith("/api/projects/drafts/"):
            suffix = route[len("/api/projects/drafts/"):].strip("/")
            parts = suffix.split("/")
            if len(parts) == 2 and parts[1] in ("approve", "reject"):
                payload, code = project_draft_action(parts[0], parts[1])
                return self.send_json(payload, code)

        if route.startswith("/api/orchestrations/") and route.endswith("/review"):
            orchestration_id = route[len("/api/orchestrations/"):-len("/review")].strip("/")
            payload, code = review_orchestration(orchestration_id, data)
            return self.send_json(payload, code)

        if route == "/api/outbox/decide":
            payload, code = outbox_decide(data)
            return self.send_json(payload, code)

        if route == "/api/state/edit":
            payload, code = state_write(data)
            return self.send_json(payload, code)

        if route == "/api/venture/decision":
            payload, code = venture_decision(data)
            return self.send_json(payload, code)

        if route == "/api/venture/projects":
            payload, code = create_venture_project(data)
            return self.send_json(payload, code)

        if route.startswith("/api/venture/projects/"):
            opportunity_id = route[len("/api/venture/projects/"):].strip("/")
            payload, code = update_venture_project(opportunity_id, data)
            return self.send_json(payload, code)

        if route == "/api/workspace/tasks":
            payload, code = create_workspace_task(data)
            return self.send_json(payload, code)

        if route.startswith("/api/workspace/tasks/"):
            task_id = route[len("/api/workspace/tasks/"):].strip("/")
            payload, code = update_workspace_task(task_id, data)
            return self.send_json(payload, code)

        if route.startswith("/api/workspace/project/") and route.endswith("/plans"):
            opportunity_id = route[len("/api/workspace/project/"):-len("/plans")].strip("/")
            payload, code = link_project_plan(opportunity_id, data)
            return self.send_json(payload, code)

        if route == "/api/workspace/external-drafts":
            payload, code = create_external_draft(data)
            return self.send_json(payload, code)

        if route.startswith("/api/workspace/external-drafts/") and route.endswith("/decision"):
            draft_id = route[len("/api/workspace/external-drafts/"):-len("/decision")].strip("/")
            payload, code = decide_external_draft(draft_id, data)
            return self.send_json(payload, code)

        if route.startswith("/api/notifications/") and route.endswith("/read"):
            notification_id = route[len("/api/notifications/"):-len("/read")].strip("/")
            payload, code = read_notification(notification_id)
            return self.send_json(payload, code)

        if route.startswith("/api/stop/"):
            job_id = route.split("/api/stop/", 1)[1]
            job = JOBS.get(job_id)
            if not job:
                return self.send_json({"error": "unknown job"}, 404)
            job["status"] = "stopped"
            if job["proc"] and job["proc"].poll() is None:
                job["proc"].terminate()
            return self.send_json({"ok": True})

        self.send_error(404, "Not found")


def main():
    threading.Thread(target=mirror_loop, daemon=True).start()
    threading.Thread(target=intent_loop, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Command Center is up.")
    print(f"  dashboard   http://127.0.0.1:{PORT}")
    print(f"  working in  {WORKDIR}")
    print(f"  running     {CLAUDE_BIN}")
    print("  ctrl-c to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
