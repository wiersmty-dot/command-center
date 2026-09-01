# Command Center

A browser dashboard that runs your Claude Code skills. Click a button, watch the
output stream back. No dependencies — Python standard library only.

## The pages

All six are reachable from every other one — the nav is shared (`nav.js`), so
you never have to type a URL to move between them.

| Page | Route | What it is |
|---|---|---|
| Orbit | `/` | The landing view. Live clock, open decisions, needs-Tyler, mail signal, and a command bar that runs anything. Your four most-used skills sit on the ring. |
| Board | `/venture` | The venture portfolio. Approve scope, advance a gate, hold or kill a thesis — every decision is recorded locally and nothing is ever sent anywhere. |
| Runs | `/runs` | Every run ever recorded, read back from `runs.jsonl`, so it survives a restart. Click one to read its transcript. |
| Vault | `/vault` | The archived run notes sitting in your Obsidian vault, readable in place. |
| Agents | `/agents` | The full 18-skill roster, the agent map, and the form for adding a new skill. |
| Classic | `/classic` | The original single-pane dashboard, kept as a fallback. |

### One theme, everywhere

All six pages share `theme.css` (the palette and type scale, lifted from the
orbit comp) and `theme.js` (the switch). Dark and light are both first-class;
the choice is stored under `nova-theme` and follows you between pages and
across tabs. The **THEME** button sits bottom-right on every page.

Pages express colour as tokens — `var(--accent)`, `var(--ink)`, `var(--panel)`
— never as literals, so changing the palette in one file restyles the whole
app. The two generated pages are handled at build time: `build-orbit.py` and
`build-console.py` rewrite the design documents' literal colours into those
same tokens, so a rebuild keeps the theme.

### Editing what's open

Orbit's **Open decisions** and **Needs Tyler** panels are editable. A morning
brief rewrites them wholesale when it emits a `json` fence, but between briefs
you can hover any row and click **DONE** to close it, or use **+ ADD** on the
panel heading. Changes persist to `orbit-state.json`.

## Setup (about three minutes)

**1. Put the folder somewhere permanent**

```
mkdir -p ~/bin/command-center
# copy server.py, dashboard.html, skills.json, config.json into it
cd ~/bin/command-center
```

**2. Point `config.json` at your setup**

```
which claude
```

Paste that full path into `claude_bin` (something like
`/opt/homebrew/bin/claude` or `~/.local/bin/claude` — a bare `claude` works too
if your PATH is already set up).

Set `workdir` to the folder Claude Code should run *inside*. This matters: your
skills resolve relative to it. If your skills live in `~/.claude/skills/` and
your notes are in the vault, point `workdir` at the vault.

**3. Start it**

```
python3 server.py
```

Open **http://127.0.0.1:7777** — that lands on Orbit.

## How the buttons work

Every entry in `skills.json` becomes a button. Two kinds:

- `"ask": false` — fires immediately with the prompt as written. Morning intel
  and Session handoff are set up this way.
- `"ask": true` — loads the skill into the input box and waits for one line of
  detail from you. The amber lamp on a button means it wants input.

The typed detail gets appended to the skill's `prompt`, so
`"Use the deal-underwriter skill."` + `"$210k duplex in Wimauma"` is what
actually gets sent.

Adding a button is just another object in `skills.json` — no code changes.
Refresh the page to pick it up.

## Keeping it always on

Edit the paths in `com.tyler.command-center.plist` if your username isn't
`tyler`, then:

```
cp com.tyler.command-center.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tyler.command-center.plist
```

It now starts at login and restarts if it dies. To stop it:

```
launchctl unload ~/Library/LaunchAgents/com.tyler.command-center.plist
```

## One ledger

The venture workspace is the source of truth, and the board is its interface.
`venture_workspace` in `config.json` points at it.

- A board decision (approve / hold / kill / resume) appends a `DEC-###` row to
  `records/decision-log.md` — the log the charter requires and the Chief of
  Staff actually reads.
- A gate advance rewrites the `Gate` cell for that thesis in
  `records/opportunity-pipeline.md`, leaving every other cell untouched.
- `/api/venture` reads gates back from the pipeline, so the board can never
  display a stage the written record does not support.

**Advance moves one gate, from the gate the agents recorded.** It used to
increment the board's private copy with nothing behind it, which is how a thesis
reached `Pilot committed` while every lead was still waiting for approval to
make first contact. Each advance also writes a decision row naming the proof
that gate requires.

Still board-only: a thesis's `status` (active / hold / killed) lives in
`venture-state.json` and has no column in the pipeline table. If that starts to
matter, give the Active portfolio table a Status column, or move held theses out
of it the way the workspace README intends.

## The weekly loop, scheduled

The workspace defines a cadence; these launch agents fire it. Each is a
`schedules/<id>.json` spec plus a `com.tyler.nova-schedule.<id>` plist, run
through `scheduled-run.py` so the output lands in the run log and the vault
like any other run.

| When | Job | What it produces |
| --- | --- | --- |
| Weekdays 04:45 | `morning-brief` | The morning brief |
| Monday 08:30 | `monday-portfolio-prioritisation` | Chief of Staff: gate scores, missing proof, one owner and one learning action per thesis |
| Friday 08:30 | `weekly-project-ledger` | Cross-project read-only ledger |
| Friday 15:30 | `friday-decision-memo` | Chief of Staff: the weekly decision memo from the template |

Fire one by hand with `launchctl start com.tyler.nova-schedule.<id>`; the run
appears on `/runs` like any other.

**Agents cannot reach the dashboard's own API.** A scheduled Chief of Staff run
reported that a request to `127.0.0.1:7777` "wasn't permitted in this session".
Anything an agent needs must come from files it can read, not from an endpoint
— which is why the record-ID rule tells agents to list the directory rather
than call `/api/next-id`. That endpoint is for scripts and the dashboard.

## Approving starts the work

On the Board, **Approve & start** records the founder decision *and* hands the
thesis to the specialist that owns it, using the brief already stored on the
opportunity. It was two steps before, and nothing reminded you the second one
was owed.

Dispatch is explicit, not automatic. `POST /api/venture/decision` only starts a
run when the request carries `"dispatch": true`. That matters because approving
is used for two different things: authorising the owner to begin, and clearing
the way to advance a gate. Only the first should spend a run.

**In-flight runs do not survive a server restart.** The job lives in memory, so
reloading the launch agent mid-run orphans it — no archive, no completion. Let
runs finish before restarting, or re-fire them afterwards.

## The outbox

`/outbox` collects every record in `leads/` and `records/` whose `**Status:**`
line still begins with *Draft* — the stamp the charter requires on anything an
agent produces. Grouped by thesis, with an optional note.

Approving rewrites **only that Status line** in the file and appends a
`DEC-###` row naming the record. It stamps and logs; **it contacts nobody.**
`templates/` and `agents/` are excluded — they carry the marker because one is
the blank and the other is the charter mandating it.

⚠️ **A denied directory read used to look like an empty workspace.** macOS
intermittently refuses this process permission to *enumerate* `~/Documents`
while still allowing it to open and write individual files. Three things read
as false-but-plausible when that happened: the vault showed no notes, the board
fell back to its own stale gates, and — worst — the ID allocator scanned
nothing and offered `LED-001` over a directory holding eighteen. All three now
report the failure instead of absorbing it, and the allocator refuses to issue
an ID it cannot vouch for.

## What the runner is allowed to do

`claude_args` in `config.json` builds the permission envelope for every run:

- `--add-dir /Users/tyler/Documents/Codex` — the venture skills keep their
  workspace at `Codex/2026-08-28/he/outputs/venture-studio`, outside the vault
  the runner works in. Without this they cannot read or write it.
- `--allowedTools` — the built-in file and research tools (`Read`, `Write`,
  `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `TodoWrite`, `Task`,
  `NotebookEdit`) plus the read-only Calendar and Gmail MCP tools.

**`Bash` is deliberately not granted.** Nothing in the current skill set needs
it, and this runner is reachable from a browser page — a shell here would be a
much larger blast radius than a file write. Add it consciously, per-skill, if a
skill genuinely needs to run commands.

`--allowedTools` is variadic, so it has to stay **last** in the list and
`--add-dir` has to come before it, or the paths get swallowed as tool names.

Requests that change state (`/api/run`, `/api/stop`, `/api/state/edit`,
`/api/venture/decision`) require a same-origin caller. Binding to `127.0.0.1`
stops other machines, not other web pages: a `text/plain` POST is a CORS simple
request, so without this check any site you visited could fire runs at the
dashboard.

## Notes

- It binds to `127.0.0.1` only, so nothing outside your machine can reach it.
- Arguments are passed to `claude` as a list, never through a shell.
- Long runs are fine — output streams in as it arrives, and **Stop** kills the
  process.
- The last 25 runs stay in memory, but every finished run is also appended to
  `runs.jsonl` and archived to the vault — so **Runs** and **Vault** still have
  the whole record after a restart, and the run drawer falls back to the
  archived note when a transcript is no longer in memory.

## If a run faults immediately

The output pane tells you which of the two it is:

- *Could not find the 'claude' command* → fix `claude_bin`.
- *Working folder not found* → fix `workdir`.
