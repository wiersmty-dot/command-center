# Nova workspace design QA

## Comparison target

- Source visual truth: `/Users/tyler/.codex/generated_images/01a04ade-6828-7c10-a661-117286a2c187/exec-ff42a955-9fba-4970-9a56-6b2a9136c289.png` (Agents), plus the supplied Vault, Runs, and Board concept PNGs in the same folder.
- Implementation: browser-rendered local Command Center at `http://127.0.0.1:7777/agents`, `/vault`, `/runs`, and `/board`.
- Browser viewport: 1488 × 1058 requested. The in-app browser capture is device-scaled; comparison was made on the normalized visible content region rather than browser canvas padding.
- State: existing local registry and run history, no completed Chief-of-Staff orchestration, and a Vault permission warning from the local runtime.

## Full-view comparison evidence

Opened each source concept and the corresponding locally rendered page in the in-app browser. The rendered Agents page has the reference's top composer, compact group rail, central chronological work feed, and task decision rail. Vault, Runs, and Board each retain their three-region compositions, tactile warm-gray surface, fine cyan rules, and their live source-of-truth data routes.

Focused checks covered the Agents composer/feed/right-rail relationship; Vault search; Runs queue selection; and Board decision-cluster selection. Browser console had no errors or warnings during the interaction pass.

## Required fidelity surfaces

- Fonts and typography: retained the established mono micro-labels with restrained sans-serif reading text; applied the compact hierarchy and low-contrast metadata used by the sources.
- Spacing and layout rhythm: desktop three-rail grids, thin dividers, restrained card treatment, and roomy central work areas align with the selected layouts. Empty-state feed space is intentional when no actual task exists.
- Colors and visual tokens: retains the shared warm paper, charcoal, thin cyan, and mint state token system.
- Image and asset fidelity: the supplied concepts contain interface line/icon treatment rather than photographic or illustration assets. No substitute raster imagery, branded assets, or custom inline SVGs were introduced.
- Copy and app content: all visible task, agent, run, decision, and evidence content comes from the existing local APIs; demo-copy was not substituted for records.

## Interaction verification

- Agents group selection changes the active agent rail; the composer still dispatches the persistent Chief-of-Staff orchestration.
- Returned task stages remain connected to the actual plan/research/diligence/verification outputs; approve and change-scope continue to call the persistent review APIs.
- Vault search, Runs record selection, and Board cluster selection were exercised successfully.
- No console errors observed on Agents, Vault, Runs, or Board.

## Follow-up polish

- Vault content density will increase once the local runtime has access to the configured Obsidian archive; this is an operating-system permission limitation, not a design/layout fault.
- The visual references illustrate more populated states than the current live data. The implementation intentionally does not invent projects, evidence, or completed Chief tasks to fill that space.

final result: passed

## Read-only agenda QA — 2026-08-31

- Source discovery: `/api/agenda` reads every available `com.tyler.*` launchd routine and expands its actual recurrence into chronological local occurrences. The readable feed currently includes five local routines, including Morning Brief, Claude Obsidian Sync, Monday portfolio prioritisation, Weekly Project Ledger, and Friday decision memo.
- Scope honesty: Google Calendar is configured as a read-only Chief connector, but no direct browser/server event-feed API exists. The agenda names this source and clearly states that limitation instead of displaying invented calendar events. No calendar, task, schedule, message, or external data was created or changed.
- Orbit surface: a visible, accessible `Agenda` entry is available beside Command and in the Command palette. The modal groups local occurrences by date, shows time and EDT, source, truthful per-occurrence state, and recurrence; project linkage is shown only when a routine explicitly names a known Board identifier.
- Interaction: Today, Upcoming (14 days), and All readable (30-day horizon) filters update the live schedule list and `aria-pressed` state. Opening the agenda moves keyboard focus to the selected range control. Empty, loading, and API-error copy is present in the UI.
- Verification: Python source compilation passed. Browser checks passed for Agenda visibility/accessibility, default Upcoming view (30 entries), Today scope (3 entries), All readable scope (65 entries), Command-palette entry, focus handling, source disclosure, and zero console errors.

final result: passed

## Audit remediation QA — 2026-08-31

- Orbit: the Command launcher is visibly available with an accessible name, CMD K hint, and focused command input after opening. The stalled Weekly Project Ledger now appears in the visible Chief surface with its actual elapsed time, stage state, an inspect action, and a Runs handoff.
- Board: the first populated actionable horizon is selected automatically. With Now empty, Next is shown with the explicit `Now is clear` handoff rather than an empty queue.
- Runs: the live Weekly Project Ledger is selected as `Active run`; a completed personal calendar lookup is labelled as personal utility, hides the Board decision path, and does not repeat detailed personal output. Archived work now uses an actual filtered `/vault?q=…` link.
- Vault: `Ask Vault` is a real focused input and returns ranked local-evidence records through `/api/vault/search`; opening a returned record shows the bounded section reader and Close returns to the Vault surface.
- Light Nova surfaces: compact metadata, ghost controls, interactive focus rings, and the map-level Ask control have sufficient visible treatment in the shared light theme.
- Verification: Python source compilation passed. Browser interaction checks passed for Orbit Command and stalled-status inspection, Board populated-horizon selection, Runs active/privacy/archive behavior, and Vault evidence search/reader close. No browser console errors were found on the fresh Orbit or Vault checks.
- Limitation: orchestration has no retry/cancel API. Nova truthfully exposes inspect and Runs recovery context instead of presenting a nonfunctional control.

final result: passed

---

## Chief voice replies — QA addendum

- Chief replies now default to **Voice on** for this user’s new Orbit requests. A project-context answer speaks immediately; an orchestration delivery speaks only after that same locally initiated task completes. Historic deliveries and background routines are never announced.
- The visible **Voice on / Voice off** control persists its setting locally. Turning it off cancels the current browser or local-Mac reading while retaining the explicit `Listen` action on individual deliveries.
- Browser QA: the control rendered in the Chief composer with `aria-pressed="true"`, changed to `Voice off` / `aria-pressed="false"`, restored to `Voice on`, and produced no console errors.
- The embedded browser exposes no Web Speech synthesis API, so the app now falls back to macOS `say` through a localhost-only endpoint. A short on-device `Nova voice check complete` request returned `{"spoken": true, "engine": "macos-say"}`; the subsequent stop request returned `{"stopped": true}`. The text is bounded to 6,000 characters, passed as an argument (not a shell command), and is never sent to a cloud speech service.

final result: passed

---

# Executive Chief-of-Staff workflow QA addendum

## Comparison target

- Visual source remains `/var/folders/2h/29y4224900gb6b36hvt94gtm0000gn/T/codex-clipboard-cb0fd483-e503-4451-b792-103845fe4c58.png`.
- Ambient implementation capture: `/private/tmp/nova-executive-ambient-qa.png`.
- Working implementation capture: `/private/tmp/nova-executive-working-qa.png`.
- Reference/ambient comparison: `/private/tmp/nova-executive-reference-comparison.png`.
- Viewport: 1280 × 720 CSS pixels at device scale factor 1. The 564 × 306 source was normalized to 1326 × 720 for side-by-side review.

## Approved improvements delivered

1. Ambient Orbit leads with one API-backed highest-value move, why it matters, and the appropriate Board or Workspace action.
2. A safe project-context question changes Orbit into a working brief: the orb yields space to the conversation, evidence, and next decision rather than keeping results in a small side rail.
3. The orb now uses actual semantic states: idle, working, decision, and complete. Its label reports only live local project/run/review counts; decision state receives an amber treatment, working state accelerates the halo.
4. The current brief rail is readable and structured as What changed, Why now, and Nova recommends.
5. The composer now asks `What do you want me to move forward?`, exposes contextual starter questions, and places Capture/Speak behind a functional plus control.
6. The floating Theme control is removed from Orbit, toasts move clear of the composer, focus treatment is explicit, and reduced-motion rules stop the core and halo animation.

## Browser verification

- Ambient state: priority card, three starters, dark executive visual field, hidden Theme control, and semantic `decision` state rendered with zero console errors.
- Starter interaction: `Status update` filled and focused the composer, then the existing read-only project-context path rendered the actual `OPP-001` brief. No orchestration, approval, or source content was created or changed.
- Working state: the Chief working brief rendered separately from the current brief rail. Measured thread bounds `435–922` and rail bounds `974–1256`, confirming the earlier text overlap was fixed.
- Composer utilities: plus control opens Capture and Speak, then closes cleanly.

## Comparison history

- [P1 fixed] The first working-mode pass allowed its transcript to overlap the right brief rail at 1280px. Reduced its maximum width to `min(38vw, 540px)` and repeated the browser measurement and screenshot check.

final result: passed

---

# Living Orb motion QA addendum

## Comparison target

- Source visual truth: `/var/folders/2h/29y4224900gb6b36hvt94gtm0000gn/T/codex-clipboard-cb0fd483-e503-4451-b792-103845fe4c58.png`.
- Implementation capture: `/private/tmp/nova-orbit-alive-qa.png` at 1280 × 720 CSS pixels, device scale factor 1.
- Side-by-side visual evidence: `/private/tmp/nova-orbit-alive-comparison.png`; the 564 × 306 source was normalized to 1326 × 720 alongside the implementation capture.

## Motion and fidelity

- Added `assets/nova-orbital-halo-v1.png`, a project-local RGBA orbital particle asset, around the existing central particle sphere. The actual asset—not a CSS/SVG stand-in—rotates continuously at a quiet cadence and accelerates/brightens when the orb is focused.
- The core label now reports live local values: active project count, queued/running orchestration count, and reviews waiting. It uses no synthesized activity or fake numerical readout.
- The giant orb remains the dominant visual field; the halo reads as a thin active perimeter and does not obscure the conversation, project context, or command input.

## Interaction verification

- Sampled the halo transform 450 ms apart and confirmed it changed, proving live motion.
- Clicking the orb focused the Chief composer and applied its active listening state.
- Observed live status: `2 PROJECTS · 1 LIVE RUN · 1 REVIEW`.
- Browser console errors: `[]`.

## Comparison history

- [P1 fixed] The first giant-orb iteration had only a slow breathing effect. Added the real orbital halo and state-driven status line, then repeated visual and interaction QA.

final result: passed

---

# Giant Orb Orbit QA addendum

## Comparison target

- Source visual truth: `/var/folders/2h/29y4224900gb6b36hvt94gtm0000gn/T/codex-clipboard-cb0fd483-e503-4451-b792-103845fe4c58.png`.
- Implementation: `http://127.0.0.1:7777/` with live Chief-of-Staff data.
- Browser-rendered implementation capture: `/private/tmp/nova-orbit-qa.png`.
- Side-by-side comparison evidence: `/private/tmp/nova-orbit-comparison.png`.
- Viewport: 1280 × 720 CSS pixels, device scale factor 1. Source was 564 × 306 pixels and normalized to 1326 × 720 for the side-by-side review; the implementation capture was 1280 × 720, so no implementation-density correction was needed.
- State: real local project context selected for `OPP-001`; no agent run, approval, or source document was created or changed during QA.

## Comparison and findings

- The composition now follows the source’s governing relationship: a cyan particulate orb owns the visual field, while information is reduced to thin peripheral telemetry on a near-black scanline surface. The implementation deliberately makes the orb larger than the reference because the user explicitly asked for a giant orb.
- The generated `assets/nova-living-orb-v1.png` replaces the prior small code-drawn core. Its particle density, cyan/mint luminance, circular contour, and soft halo match the requested visual language without reproducing source text or UI.
- The reference has a blue outer frame and a static numerical readout; Nova instead uses its established route navigation and a live Chief prompt. This is an intentional product adaptation: the screen remains an operational control surface rather than a static visual.
- [P1 fixed] The first functional QA pass found two controls with the accessible name `Ask Nova` (the orb and submit button). The orb is now named `Focus Chief input`; it focuses the live composer without colliding with form automation or keyboard users.

## Required fidelity surfaces

- Fonts and typography: compact mono telemetry and restrained cyan display labels mirror the reference’s technical hierarchy; live project copy remains readable in the side rails.
- Spacing and layout rhythm: the orb holds the central 70–76% visual field, with quiet left conversation and right context rails that do not compete with it; the composer is anchored beneath the orb.
- Colors and visual tokens: near-black ground, cyan particles, pale-mint highlights, and subtle scanlines match the target atmosphere. The blue screenshot border was not carried forward because it is framing, not the application interior.
- Image quality and asset fidelity: a project-local 1254 × 1254 RGBA generated asset is served through the local app; it is not a CSS, SVG, or placeholder substitute.
- Copy and content: telemetry uses existing local project/orchestration data. No fabricated run result appears in the UI.

## Interaction verification

- Clicking or pressing Enter/Space on the giant orb focuses the Chief input.
- Submitted `What is the status of Industrial demand-charge peak forensics?`; Nova rendered the real `LIVE PROJECT CONTEXT`, including its current stage and `Next:` action, without creating a persistent agent run.
- Browser console errors: `[]`.

## Implementation checklist

- [x] Replace the smaller visual core with a project-local, giant particle orb asset.
- [x] Reduce Orbit to dark peripheral telemetry plus a central Chief interaction.
- [x] Preserve live project lookup, real orchestration dispatch, Capture, Speak, and approval-safe local data flow.

final result: passed

---

# Orbit Chief-of-Staff QA addendum

## Scope

- Implementation route: `http://127.0.0.1:7777/`.
- Source: the existing live Orbit data and orchestration APIs; no Obsidian documents, example projects, or test runs were created for this pass.

## Delivered interaction

- Orbit now starts with a Chief-of-Staff conversation surface rather than a static dashboard composer. Its animated Nova core uses a pulsing mint signal, rotating cyan orbits, and the established warm scanline field.
- A question such as `What is the status of Industrial demand-charge peak forensics?` matched the live `OPP-001` record and returned the stage, next action, evidence to establish, and personal-action state, with working Workspace and Board handoffs.
- Broader requests still use the existing local orchestration endpoint and return their run state, readable delivery, full-result control, and optional local speech playback in the same conversation. No external connector or automatic action was added.

## Browser QA

- Opened Orbit and verified the animated Chief surface exists and renders without console errors.
- Submitted the project-status question above; verified a rendered `NOVA · LIVE PROJECT CONTEXT` response with `Next:` and selected project context.
- Captured and visually inspected the rendered desktop view. The core, conversational turns, project context, composer, and execution pulse were visible together at 1280 × 720.
- Did not submit a broad task prompt during QA because it would create a real persistent orchestration run. The existing task dispatch path was preserved and reviewed in the rendered handler.

final result: passed

---

# Orbit live activity + capture QA addendum

## Scope

- Route: `http://127.0.0.1:7777/`.
- Added a project-derived Execution pulse, compact active-run telemetry, and a local Quick capture surface. No new data model or external connector was introduced.

## Verification

- The fresh browser load displayed `Execution pulse`, live run count, runs today, average local run duration, and open personal action count from the existing history/task APIs.
- An active run displays its current stage count, elapsed local time, and a bounded title while retaining the complete prompt in its native tooltip/result surface.
- `Capture` opened the project-linked local task form; the form was closed without submitting a test record. It contains no external action path.
- A `Listen to latest result` control appears only when a completed Chief-of-Staff result is available. It uses the browser's local speech synthesis only after an explicit click; no microphone permission, cloud TTS request, or data transmission occurs.
- The quick-capture modal opened and closed successfully, and the browser console had no errors.
- `/usr/bin/python3 -c "compile(open('server.py', encoding='utf-8').read(), 'server.py', 'exec')"` passed. The managed local service was restarted and returned HTTP 200.

final result: passed

---

# Vault Inspect reader QA addendum

## Problem addressed

- The original Inspect path replaced the evidence preview with one unbounded `<pre>` block. Long archived records required a single difficult-to-scan scroll.

## Implemented reading model

- Inspect now opens a focused, light tactile evidence reader over the Vault rather than a raw transcript in the right rail.
- The reader has a sticky document header with record name, local archive path, modified time, and file size; an in-panel section navigator; exact-text at-a-glance excerpts; bounded, independently scrollable evidence sections; and a persistent source-citation card.
- Markdown headings create the navigator. Archives without headings are partitioned into fixed-size continuation sections so no source record is changed or fabricated.
- Back to results, Close, clicking the backdrop, and Escape all restore the filtered Inspect results. Source content remains read-only.

## Browser verification

- Opened the live Vault and inspected an actual `2026-08-31 0445 Morning intel` archive record.
- Verified the reader found four real document sections, displayed source metadata, and moved the reader from scroll position `0` to `471.5` through the second section navigator item.
- Verified Back to results, Close, and Escape each removed the reader and restored the live Inspect buttons.
- Browser console contained no errors during the interaction checks.

final result: passed

---

# Orbit connected-workspace QA addendum

## Scope

- Implementation route: `http://127.0.0.1:7777/`.
- Checked against the shared Nova light tactile system: warm-gray scanline field, charcoal mono labels, thin cyan/mint controls, and low-elevation panels.
- Live state only: no test project, task, plan link, notification, external action draft, or schedule was created during QA.

## Visual + interaction checks

- Opened a real project workspace from Orbit. The modal rendered the live project fields, next proof/action, personal-task area, linked-plan picker, decision history, linked Chief runs, and approval-draft queue.
- Opened the Command palette and confirmed the Board, Runs, Vault, create-project, inbox, and Ask Nova routing actions were visible.
- Opened the local Nova inbox successfully. The unread badge is supplied by the persistent local notification feed.
- Confirmed the Ask Nova composer retains its live task flow and now exposes an opt-in Speak control. The browser requests microphone access only after the operator presses Speak; QA did not request that permission.
- Browser console: no errors on Orbit after loading the workspace, command, and inbox controls.
- Server source compiled successfully with Python after the new local workspace APIs were added.

## Safety verification

- Linked plans reference a canonical Obsidian Markdown path without editing it. Existing draft-and-approve plan write behavior remains unchanged.
- External email/calendar action packages remain local `pending_approval` drafts. Approving one produces an `approved_manual_handoff` state; it cannot send an email or create an event because the configured connectors are read-only.

final result: passed

---

# Option 2 Board → Runs → Classic QA addendum

## Comparison target

- Source visual truth: `/Users/tyler/.codex/generated_images/01a04ade-6828-7c10-a661-117286a2c187/exec-243bc4e7-e8c3-4918-82e0-c1529cba488c.png`.
- Implementation routes: `http://127.0.0.1:7777/board`, `/runs`, and `/classic`.
- Browser-rendered implementation screenshots: in-app Browser captures from the final QA pass (Board, Runs, and Classic); the Browser capture surface does not expose a persistent local screenshot filename. The captures were emitted and visually inspected in this task.
- Viewport: 1280 × 720 CSS pixels at device scale factor 2. Captures use the same in-app browser viewport; no density normalization was needed for the implementation-to-implementation loop. The source is a taller desktop composition, so comparison focused on the common top-of-page regions and preserved proportions rather than browser canvas chrome.
- State: three live venture records, one current approval, existing local run history, and no test decisions or test runs created during QA.

## Full-view comparison evidence

The Board now matches the selected Option 2 composition: horizons and sources at left, a titled vertical decision queue in the center, and an evidence/history rail at right. The only queue row shown is the actual live decision record rather than invented filler. It includes the selected design's explicit `Why it matters`, `Approve`, `Request changes`, and `Defer` controls.

Runs is intentionally linear rather than card-dense: active/recent records at left, an Intake → Plan → Research → Build → Verify → Complete timeline and transcript in the center, and run evidence plus an explicit return-to-Board handoff at right. Classic is a calm three-column review with completed work, decisions made, open approvals, and one next focus.

## Focused region comparison

- Board header and queue: checked title, Filters/Add commitment controls, Now/Next/Later selection, priority row layout, action placement, and the right evidence sheet against the source.
- Board proposal: opening `View full proposal` shows a functional local modal, then closes cleanly.
- Runs: selecting a recent run changes the active title and returned transcript; the six-stage timeline and Board decision link remain visible.
- Classic: verified the explicit Board and Runs paths, plus the review-decision link, all resolve to their intended local routes.

## Required fidelity surfaces

- Fonts and typography: mono micro-labels and compact operational copy remain consistent with the selected source; reading text uses the existing Nova sans hierarchy. Long live record names wrap rather than truncate critical decision context.
- Spacing and layout rhythm: the three-rail Board proportions, low elevation, thin rules, restrained queue rows, and generous empty-space field follow the source. Runs and Classic keep one scanning direction each.
- Colors and visual tokens: warm-gray scanline surface, charcoal type, cyan rules, mint active states, and muted orange approval signal use the established Nova tokens.
- Image quality and asset fidelity: the selected source is interface-led and contains no required logo, illustration, or photographic asset. No substitute SVG, CSS art, or placeholder imagery was introduced.
- Copy and content: decisions, evidence, project ownership, history, and run transcripts come from the existing local APIs. No example projects or evidence were fabricated to fill the target layout.

## Comparison history

- [P1 fixed] The first Board interaction pass exposed a nonfunctional `View full proposal` control because the shared transcript modal had not been instantiated on this route. Fixed in `nova-workspaces.js` by creating the existing local modal on first use, then repeated the interaction check. Post-fix evidence: the modal opened with `OPP-002 — full proposal` and closed successfully.
- No remaining actionable P0, P1, or P2 visual differences were observed. The lower record count compared with the illustrative source is expected live-data variance, not a design mismatch.

## Interaction verification

- Board Now/Next/All horizon selection changes the actual queue without mutating records.
- Board proposal modal works; approval, defer, revised-task, and bounded-run controls remain connected to their existing local APIs but were deliberately not invoked during QA to avoid writing user state.
- Runs record selection updates the active run and transcript. The timeline shows six execution stages and the handoff back to Board.
- Classic exposes working local `/board` and `/runs` handoffs from its review content.
- Browser checks found no page-level console errors on Board, Runs, or Classic.
- Static server source compiled successfully with Python. Node.js is not installed in this environment, so `node --check` was unavailable; browser parsing and interaction checks covered the delivered JavaScript.

## Implementation checklist

- [x] Replace spatial Board with priority-horizon decision queue.
- [x] Make Board actions use existing approval/hold, orchestration, and bounded-run endpoints.
- [x] Make Runs the legible execution and evidence view for Board work.
- [x] Create Classic as the calm decision/execution review surface without replacing the legacy `/dashboard.html` fallback.
- [x] Make the Board → Runs → Classic loop explicit on every new surface.

final result: passed
