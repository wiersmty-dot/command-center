/* Mission Control — design turn 1a from design/Jarvis Dashboards.dc.html.
 *
 * 1a is the screen the design doc labels "JARVIS-STYLE COMMAND DASHBOARD":
 * nav rail, KPI strip, venture board, copilot column, activity feed. It was
 * never built — it carries no data-screen-label, so build-orbit.py's extract()
 * cannot reach it, and its layout is not 3a's, so add_hooks() would not bind.
 *
 * Rather than lift the comp's fixed-1440 absolute markup into a page that
 * cannot reflow, this rebuilds 1a's structure as real markup against the same
 * REST API the orbit view uses. The comp is the spec; the data is live.
 *
 * ONE DELIBERATE DEVIATION. 1a's KPI strip leads with REVENUE · MTD ($48.2K)
 * and PIPELINE · OPEN ($128K / 9 DEALS). No monetary figure exists anywhere in
 * this system — venture opportunities carry stage/status/owner and no values,
 * and workspace tasks is empty. Inventing them on an operations dashboard
 * would make the whole strip untrustworthy, so both tiles are replaced with
 * metrics that have a real source. If a revenue source appears later, the
 * tiles are one entry each in KPI_SPECS below.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* ---------------------------------------------------------------- styles */
  /* Every size here is >= 11px. build-orbit.py floors comp type at 11px but
     only for markup it extracts; hand-written CSS has bypassed that floor
     before, so this file honours it at the source. */
  const css = `
.mc{min-height:100vh;background:var(--bg);color:var(--ink);
  font-family:'Rajdhani',system-ui,sans-serif;
  background-image:radial-gradient(ellipse at 50% -10%,var(--accent-wash),transparent 40rem),
    repeating-linear-gradient(0deg,var(--line-soft) 0 1px,transparent 1px 4px)}
.mc-wrap{max-width:1560px;margin:0 auto;padding:0 26px 40px}

.mc-top{display:flex;align-items:center;gap:20px;height:70px;
  border-bottom:1px solid var(--line)}
.mc-brand{font-family:'Michroma',var(--display),sans-serif;font-size:14px;
  letter-spacing:.14em;color:var(--ink);white-space:nowrap}
.mc-brand i{font-style:normal;color:var(--accent)}
.mc-context{padding-left:18px;border-left:1px solid var(--line);color:var(--dim)}
.mc-kicker,.mc-label{font:600 11px/1 'JetBrains Mono',monospace;
  letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
.mc-status{margin-left:auto;display:flex;align-items:center;gap:8px}
.mc-dot{width:7px;height:7px;border-radius:50%;background:var(--ok);
  box-shadow:0 0 10px var(--ok)}
.mc-dot[data-state="warn"]{background:var(--warn);box-shadow:0 0 10px var(--warn)}
.mc-clock{font:600 13px 'JetBrains Mono',monospace;letter-spacing:.08em;
  color:var(--ink);font-variant-numeric:tabular-nums}
.mc-date{font:500 11px 'JetBrains Mono',monospace;letter-spacing:.14em;
  color:var(--dim);text-transform:uppercase}

/* KPI strip -------------------------------------------------------------- */
.mc-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0}
.mc-kpi{position:relative;padding:16px 18px;border:1px solid var(--line);
  border-radius:8px;background:linear-gradient(180deg,var(--accent-wash),transparent)}
.mc-kpi:before{content:'';position:absolute;top:-1px;left:-1px;width:11px;height:11px;
  border-top:2px solid var(--accent);border-left:2px solid var(--accent);
  border-radius:3px 0 0 0}
.mc-kpi-value{margin-top:9px;font:700 30px 'JetBrains Mono',monospace;
  letter-spacing:.02em;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1}
.mc-kpi-sub{margin-top:7px;font:500 11px 'JetBrains Mono',monospace;
  letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.mc-kpi-sub b{color:var(--accent);font-weight:600}

/* main grid -------------------------------------------------------------- */
.mc-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:18px}
.mc-panel{border:1px solid var(--line);border-radius:8px;
  background:color-mix(in srgb,var(--panel) 52%,transparent);padding:16px 18px 18px}
.mc-panel + .mc-panel{margin-top:18px}
.mc-panel-head{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}
.mc-panel-head h2{margin:0;font:600 11px/1 'JetBrains Mono',monospace;
  letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
.mc-panel-head h2:before{content:'\\25E2';margin-right:8px;color:var(--accent)}
.mc-count{margin-left:auto;font:600 11px 'JetBrains Mono',monospace;
  letter-spacing:.14em;color:var(--accent)}

/* venture board ---------------------------------------------------------- */
.mc-vent{border-top:1px solid var(--line-soft);padding:13px 0 3px}
.mc-vent:first-of-type{border-top:0;padding-top:0}
.mc-vent-head{display:flex;align-items:center;gap:11px;margin-bottom:9px}
.mc-vent-name{font:700 13px 'JetBrains Mono',monospace;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ink)}
.mc-chip{padding:4px 8px;border-radius:3px;border:1px solid var(--line);
  font:600 11px 'JetBrains Mono',monospace;letter-spacing:.1em;
  text-transform:uppercase;color:var(--dim);white-space:nowrap}
.mc-chip[data-tone="go"]{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent)}
.mc-chip[data-tone="wait"]{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,transparent)}
.mc-chip[data-tone="live"]{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.mc-vent-body{font-size:14px;line-height:1.5;color:var(--ink-2);margin:0 0 9px}
.mc-vent-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center}

/* rows (today + activity) ------------------------------------------------ */
.mc-row{display:flex;gap:13px;padding:11px 0;border-top:1px solid var(--line-soft);
  align-items:flex-start}
.mc-row:first-of-type{border-top:0}
.mc-time{flex:0 0 58px;font:600 13px 'JetBrains Mono',monospace;
  color:var(--accent);font-variant-numeric:tabular-nums}
.mc-row-main{flex:1;min-width:0}
.mc-row-title{font-size:14px;line-height:1.4;color:var(--ink)}
.mc-row-sub{margin-top:4px;font:500 11px 'JetBrains Mono',monospace;
  letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}

/* empty states ----------------------------------------------------------- */
.mc-empty{padding:16px 0;font-size:14px;line-height:1.5;color:var(--dim)}

/* links / controls ------------------------------------------------------- */
.mc-nav{display:flex;gap:5px;margin-left:6px}
.mc-nav a{display:inline-flex;align-items:center;min-height:34px;padding:0 11px;
  border-radius:3px;text-decoration:none;color:var(--dim);
  font:600 11px 'JetBrains Mono',monospace;letter-spacing:.16em;
  text-transform:uppercase;transition:color .18s ease,background .18s ease}
.mc-nav a:hover{color:var(--ink);background:var(--line-soft)}
.mc-nav a[aria-current="page"]{color:var(--accent);background:var(--accent-wash)}
.mc-link{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;
  border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:999px;
  background:var(--accent-wash);color:var(--accent);text-decoration:none;
  font:600 11px 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;
  transition:background .18s ease}
.mc-link:hover{background:color-mix(in srgb,var(--accent) 22%,transparent)}
.mc :is(a,button):focus-visible{outline:2px solid var(--accent);outline-offset:3px}

.mc-skip{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;
  background:var(--accent);color:var(--on-accent);border-radius:6px;
  font:600 12px 'JetBrains Mono',monospace;letter-spacing:.1em;text-decoration:none}
.mc-skip:focus,.mc-skip:focus-visible{position:fixed;left:14px;top:14px;z-index:60;
  width:auto;height:auto;margin:0;padding:11px 15px;overflow:visible;
  clip:auto;clip-path:none}

@media (max-width:1180px){
  .mc-kpis{grid-template-columns:repeat(2,1fr)}
  .mc-grid{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:640px){
  .mc-kpis{grid-template-columns:minmax(0,1fr)}
  .mc-top{height:auto;flex-wrap:wrap;gap:11px;padding:14px 0}
  .mc-wrap{padding:0 16px 32px}
}
@media (prefers-reduced-motion:reduce){
  .mc *{transition:none!important;animation:none!important}
}
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ------------------------------------------------------------ scaffold */
  const root = document.createElement('div');
  root.className = 'mc';
  root.innerHTML = `
<a class="mc-skip" href="#mc-main">Skip to main content</a>
<div class="mc-wrap">
  <header class="mc-top">
    <h1 class="mc-brand">NOVA <i>//</i> COMMAND</h1>
    <div class="mc-context mc-kicker">Sys.overview / all ventures</div>
    <nav class="mc-nav" aria-label="Primary">
      <a href="/">Orbit</a><a href="/mission" aria-current="page">Mission</a>
      <a href="/venture">Board</a><a href="/runs">Runs</a>
      <a href="/vault">Vault</a><a href="/agents">Agents</a>
    </nav>
    <div class="mc-status">
      <span class="mc-dot" id="mc-dot"></span>
      <span class="mc-kicker" id="mc-health">Checking…</span>
      <span class="mc-clock" id="mc-clock">--:--:--</span>
      <span class="mc-date" id="mc-date"></span>
    </div>
  </header>

  <section class="mc-kpis" id="mc-kpis" aria-label="Key indicators"></section>

  <main class="mc-grid" id="mc-main">
    <div>
      <section class="mc-panel">
        <div class="mc-panel-head"><h2>Venture board</h2><span class="mc-count" id="mc-vent-count"></span></div>
        <div id="mc-ventures"><p class="mc-empty">Loading ventures…</p></div>
      </section>
      <section class="mc-panel">
        <div class="mc-panel-head"><h2>Today</h2><span class="mc-count" id="mc-today-count"></span></div>
        <div id="mc-today"><p class="mc-empty">Loading schedule…</p></div>
      </section>
    </div>
    <div>
      <section class="mc-panel">
        <div class="mc-panel-head"><h2>Nova</h2><span class="mc-count" id="mc-agent-count"></span></div>
        <div id="mc-nova"><p class="mc-empty">Loading agents…</p></div>
      </section>
      <section class="mc-panel">
        <div class="mc-panel-head"><h2>Activity feed</h2></div>
        <div id="mc-activity"><p class="mc-empty">Loading runs…</p></div>
      </section>
    </div>
  </main>
</div>`;
  document.body.appendChild(root);

  /* --------------------------------------------------------------- clock */
  const clock = $('#mc-clock'), dateEl = $('#mc-date');
  const tick = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString('en-US', { hour12: false });
    dateEl.textContent = d.toLocaleDateString('en-US',
      { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();
  };
  tick();
  setInterval(tick, 1000);

  /* ---------------------------------------------------------------- data */
  const api = async (path, fallback) => {
    try {
      const r = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      return fallback;
    }
  };

  const ago = ts => {
    if (!ts) return '';
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  /* Every tile below reads a field that exists. See the header note on the
     two revenue tiles from the comp that deliberately are not here. */
  const KPI_SPECS = [
    { label: 'Agent runs · today',
      value: d => d.hist?.stats?.today ?? 0,
      sub:   d => `${d.hist?.stats?.week ?? 0} this week · ${d.hist?.stats?.faults ?? 0} faults` },
    { label: 'Ventures · active',
      value: d => d.vent?.metrics?.active ?? 0,
      sub:   d => `${d.vent?.metrics?.candidate ?? 0} candidate · ${d.vent?.metrics?.pilots ?? 0} pilot` },
    { label: 'Waiting on you',
      value: d => (d.vent?.metrics?.approvals ?? 0) + (d.notif?.unread ?? 0),
      sub:   d => `${d.vent?.metrics?.approvals ?? 0} approvals · ${d.notif?.unread ?? 0} unread` },
    { label: 'Run success',
      value: d => (d.con?.successRate ?? 0) + '%',
      sub:   d => `avg ${d.con?.avgSeconds ?? 0}s · ${d.con?.skills ?? 0} skills` },
  ];

  const STAGE_TONE = { 'Pilot committed': 'go', 'Qualified thesis': 'live', 'Candidate': 'wait' };
  const AGENT_TONE = { ready: 'go', queued: 'wait', at_capacity: 'wait', blocked: 'wait' };

  const render = d => {
    /* KPI strip */
    $('#mc-kpis').innerHTML = KPI_SPECS.map(k => `
      <article class="mc-kpi">
        <div class="mc-label">${esc(k.label)}</div>
        <div class="mc-kpi-value">${esc(k.value(d))}</div>
        <div class="mc-kpi-sub">${esc(k.sub(d))}</div>
      </article>`).join('');

    /* health line — derived, not asserted */
    const faults = d.hist?.stats?.faults ?? 0;
    const waiting = (d.vent?.metrics?.approvals ?? 0) + (d.notif?.unread ?? 0);
    $('#mc-health').textContent = faults ? `${faults} fault${faults > 1 ? 's' : ''} in history`
      : waiting ? `${waiting} waiting on you` : 'All systems nominal';
    $('#mc-dot').dataset.state = (faults || waiting) ? 'warn' : 'ok';

    /* venture board */
    const opps = d.vent?.opportunities || [];
    $('#mc-vent-count').textContent = opps.length ? `${opps.length} active` : '';
    $('#mc-ventures').innerHTML = opps.length ? opps.map(o => `
      <article class="mc-vent">
        <div class="mc-vent-head">
          <span class="mc-vent-name">${esc(o.id)}</span>
          <span class="mc-chip" data-tone="${STAGE_TONE[o.stage] || ''}">${esc(o.stage || 'unknown')}</span>
          ${o.approvalStatus === 'approved' ? '<span class="mc-chip" data-tone="go">Approved</span>' : ''}
        </div>
        <p class="mc-vent-body"><strong>${esc(o.name || 'Untitled')}</strong>${
          o.nextAction ? ' — ' + esc(o.nextAction) : ''}</p>
        <div class="mc-vent-meta">
          <span class="mc-chip">${esc(o.owner || 'unassigned')}</span>
          <a class="mc-link" href="/venture">Open board</a>
        </div>
      </article>`).join('')
      : `<p class="mc-empty">No active opportunities. The venture scout creates them —
         start one from <a class="mc-link" href="/agents">Agents</a>.</p>`;

    /* today — agenda is every scheduled routine; narrow it to this date */
    const today = new Date().toISOString().slice(0, 10);
    const items = (d.agenda?.items || [])
      .filter(i => i.date === today)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    $('#mc-today-count').textContent = items.length ? `${items.length} scheduled` : '';
    $('#mc-today').innerHTML = items.length ? items.map(i => `
      <div class="mc-row">
        <div class="mc-time">${esc(i.time || '--:--')}</div>
        <div class="mc-row-main">
          <div class="mc-row-title">${esc(i.title || 'Untitled routine')}</div>
          <div class="mc-row-sub">${esc(i.status || '')} · ${esc(i.source || '')}</div>
        </div>
      </div>`).join('')
      : `<p class="mc-empty">Nothing scheduled today.
         <a class="mc-link" href="/runs">See run history</a></p>`;

    /* nova / agents */
    const agents = d.vent?.agents || [];
    $('#mc-agent-count').textContent = agents.length ? `${agents.length} agents` : '';
    $('#mc-nova').innerHTML = agents.length ? agents.map(a => `
      <div class="mc-row">
        <div class="mc-row-main">
          <div class="mc-row-title">${esc(a.label)}</div>
          <div class="mc-row-sub">${esc(a.focus || a.skill || '')}</div>
        </div>
        <span class="mc-chip" data-tone="${AGENT_TONE[a.state] || ''}">${esc(String(a.state).replace(/_/g, ' '))}</span>
      </div>`).join('')
      : '<p class="mc-empty">No agents registered.</p>';

    /* activity feed */
    const runs = (d.hist?.runs || []).slice(0, 8);
    $('#mc-activity').innerHTML = runs.length ? runs.map(r => `
      <div class="mc-row">
        <div class="mc-row-main">
          <div class="mc-row-title">${esc(r.label || r.skill)}</div>
          <div class="mc-row-sub">${esc(r.skill)} · ${esc(r.elapsed || 0)}s · ${esc(ago(r.started))}</div>
        </div>
        <span class="mc-chip" data-tone="${r.status === 'done' ? 'go' : r.status === 'running' ? 'live' : 'wait'}">${esc(r.status)}</span>
      </div>`).join('')
      : '<p class="mc-empty">No runs recorded yet.</p>';
  };

  (async () => {
    const [con, vent, hist, agenda, notif] = await Promise.all([
      api('/api/console', {}), api('/api/venture', {}),
      api('/api/history?limit=12', {}), api('/api/agenda', {}),
      api('/api/notifications', {}),
    ]);
    render({ con, vent, hist, agenda, notif });
  })();
})();
