/* Mission Control — the Daily Hub's JARVIS HUD, running on Command Center data.
 *
 * The visual system is ported from ~/Documents/DailyHub: the `.hud-tile` glass
 * primitive (src/styles.css) and the oklch tokens in src/lib/hud-tokens.ts.
 * That app is React/TanStack with a build step; this server hands out static
 * files, so the language is reimplemented in plain CSS rather than imported —
 * same glass, same masked gradient rim, same depth tiers and accent hues.
 *
 * DATA. Every tile names its source. Where the Command Center has no source
 * for something the design asks for, the tile renders an explicit "no source
 * connected" state rather than being hidden or filled with a plausible number:
 * an operations dashboard that invents one figure cannot be trusted on any of
 * the others.
 *
 * TYPE. The Daily Hub sets tile titles at 10px and meta at 9px. This build
 * floors both at 11px, matching build-orbit.py's map_size() and the rest of
 * this server.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

    // The design system now lives in /hud.css so the other pages can wear it too.
  // Linked rather than inlined: two copies would drift the first time one page
  // needed a tweak.
  if (!document.querySelector('link[href="/hud.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/hud.css';
    document.head.appendChild(link);
  }

  const NAV = [['Mission', '/'], ['Orbit', '/orbit'], ['Board', '/venture'],
               ['Runs', '/runs'], ['Vault', '/vault'], ['Agents', '/agents'],
               ['Outbox', '/outbox']];

  const root = document.createElement('div');
  root.className = 'hud';
  root.innerHTML = `
<a class="skip" href="#hud-main">Skip to main content</a>
<div class="hud-wrap">
  <nav class="hud-strip" aria-label="Primary">
    ${NAV.map(([l, h]) => `<a class="hud-pill" href="${h}"${h === '/' ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
    <span class="hud-pill" id="hud-health"><span class="dot" data-s="info"></span>Checking…</span>
  </nav>
  <header class="hud-head">
    <div>
      <h1 class="hud-title">N.O.V.A.</h1>
      <div class="hud-sub">Command Center · all ventures</div>
    </div>
    <div class="hud-clock">
      <div class="hud-time" id="hud-time">--:--:--</div>
      <div class="hud-day" id="hud-day"></div>
    </div>
  </header>
  <section class="hud-stats" id="hud-stats" aria-label="Key indicators"></section>
  <main class="hud-grid" id="hud-main">
    <div class="hud-col">
      <section class="tile" id="t-vent"></section>
      <section class="tile" id="t-today"></section>
    </div>
    <div class="hud-col">
      <section class="tile tile--lifted" id="t-ask"></section>
      <section class="tile" id="t-agents"></section>
      <section class="tile" id="t-activity"></section>
      <section class="tile" id="t-decisions"></section>
      <section class="tile tile--ghost tile--amber" id="t-nosource"></section>
    </div>
  </main>
</div>`;
  document.body.appendChild(root);

  const tick = () => {
    const d = new Date();
    $('#hud-time').textContent = d.toLocaleTimeString('en-US', { hour12: false });
    $('#hud-day').textContent = d.toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase();
  };
  tick(); setInterval(tick, 1000);

  const api = async (p, f) => {
    try { const r = await fetch(p, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw 0; return await r.json(); } catch (e) { return f; }
  };
  const ago = ts => { if (!ts) return ''; const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago'
      : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };

  const head = (title, meta, status, tag = 'h2') => `
    <div class="tile-head">
      <div class="tile-name">${status ? `<span class="dot" data-s="${status}" aria-label="Status: ${status}"></span>` : ''}
        <${tag} class="tile-title">${esc(title)}</${tag}></div>
      ${meta ? `<span class="tile-meta">${esc(meta)}</span>` : ''}
    </div>`;

  /* Each stat names the view holding the records behind it. */
  const STATS = [
    { title: 'Agent runs · today', accent: '', to: '/runs', goes: 'run history',
      value: d => d.hist?.stats?.today ?? 0,
      sub: d => `${d.hist?.stats?.week ?? 0} this week · ${d.hist?.stats?.faults ?? 0} faults` },
    { title: 'Ventures · active', accent: '', to: '/venture', goes: 'venture board',
      value: d => d.vent?.metrics?.active ?? 0,
      sub: d => `${d.vent?.metrics?.candidate ?? 0} candidate · ${d.vent?.metrics?.pilots ?? 0} pilot` },
    { title: 'Waiting on you', accent: 'tile--amber', to: '/outbox', goes: 'approval queue',
      value: d => (d.vent?.metrics?.approvals ?? 0) + (d.notif?.unread ?? 0),
      sub: d => `${d.vent?.metrics?.approvals ?? 0} approvals · ${d.notif?.unread ?? 0} unread` },
    { title: 'Run success', accent: 'tile--green', to: '/agents', goes: 'agent console',
      value: d => (d.con?.successRate ?? 0) + '%',
      sub: d => `avg ${d.con?.avgSeconds ?? 0}s · ${d.con?.skills ?? 0} skills` },
  ];

  const STAGE = { 'Pilot committed': 'go', 'Qualified thesis': 'live', Candidate: 'warn' };
  const AGENT = { ready: 'go', queued: 'warn', at_capacity: 'warn', blocked: 'warn' };

  const render = d => {
    $('#hud-stats').innerHTML = STATS.map(s => {
      const v = s.value(d);
      return `<a class="tile tile--lifted ${s.accent}" href="${s.to}"
        aria-label="${esc(s.title)}: ${esc(v)}. ${esc(s.sub(d))}. Opens ${esc(s.goes)}.">
        ${head(s.title, '', '', 'span')}
        <div class="tile-body">
          <div class="stat-value">${esc(v)}</div>
          <div class="stat-sub">${esc(s.sub(d))}</div>
          <div class="stat-go" aria-hidden="true">${esc(s.goes)} &rsaquo;</div>
        </div></a>`;
    }).join('');

    const faults = d.hist?.stats?.faults ?? 0;
    const waiting = (d.vent?.metrics?.approvals ?? 0) + (d.notif?.unread ?? 0);
    const hs = faults ? 'alert' : waiting ? 'warn' : 'live';
    $('#hud-health').innerHTML = `<span class="dot" data-s="${hs}"></span>` +
      esc(faults ? `${faults} fault${faults > 1 ? 's' : ''} in history`
        : waiting ? `${waiting} waiting on you` : 'All systems nominal');

    const opps = d.vent?.opportunities || [];
    $('#t-vent').innerHTML = head('Venture board', opps.length ? `${opps.length} active` : '', 'info') +
      `<div class="tile-body">${opps.length ? opps.map(o => `
        <article class="vent">
          <div class="vent-head"><span class="vent-id">${esc(o.id)}</span>
            <span class="chip" data-t="${STAGE[o.stage] || ''}">${esc(o.stage || '—')}</span>
            ${o.approvalStatus === 'approved' ? '<span class="chip" data-t="go">Approved</span>' : ''}</div>
          <p class="vent-body"><strong>${esc(o.name || 'Untitled')}</strong>${o.nextAction ? ' — ' + esc(o.nextAction) : ''}</p>
          <a class="link" href="/venture">Open board</a>
        </article>`).join('')
        : '<p class="empty"><b>Nothing active</b>No opportunities yet. The thesis scout creates them.</p>'}</div>`;

    const today = new Date().toISOString().slice(0, 10);
    const items = (d.agenda?.items || []).filter(i => i.date === today)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    $('#t-today').innerHTML = head('Today', items.length ? `${items.length} scheduled` : '', 'info') +
      `<div class="tile-body">${items.length ? items.map(i => `
        <div class="row"><div class="row-time">${esc(i.time || '--:--')}</div>
          <div class="row-main"><div class="row-title">${esc(i.title || 'Routine')}</div>
            <div class="row-sub">${esc(i.status || '')} · ${esc(i.source || '')}</div></div></div>`).join('')
        : '<p class="empty"><b>Clear</b>Nothing scheduled today.</p>'}</div>`;

    const agents = d.vent?.agents || [];
    $('#t-agents').innerHTML = head('Nova agents', agents.length ? `${agents.length} agents` : '', 'live') +
      `<div class="tile-body">${agents.length ? agents.map(a => `
        <div class="row"><div class="row-main"><div class="row-title">${esc(a.label)}</div>
          <div class="row-sub">${esc(a.focus || a.skill || '')}</div></div>
          <span class="chip" data-t="${AGENT[a.state] || ''}">${esc(String(a.state).replace(/_/g, ' '))}</span></div>`).join('')
        : '<p class="empty"><b>None registered</b>No agents in venture-state.</p>'}</div>`;

    const runs = (d.hist?.runs || []).slice(0, 7);
    $('#t-activity').innerHTML = head('Activity feed', '', 'live') +
      `<div class="tile-body">${runs.length ? runs.map(r => `
        <div class="row"><div class="row-main"><div class="row-title">${esc(r.label || r.skill)}</div>
          <div class="row-sub">${esc(r.skill)} · ${esc(r.elapsed || 0)}s · ${esc(ago(r.started))}</div></div>
          <span class="chip" data-t="${r.status === 'done' ? 'go' : r.status === 'running' ? 'live' : 'warn'}">${esc(r.status)}</span></div>`).join('')
        : '<p class="empty"><b>No runs</b>Nothing recorded yet.</p>'}</div>`;

    /* Decision log — read back from the Supabase projection. The local
       venture-state cache holds 16 decisions across 3 opportunities; the
       mirror holds 34 across 4, today's included. So this tile shows the
       Command Center something it could not otherwise see. */
    const dec = d.dec || {};
    const rows = dec.decisions || [];
    $('#t-decisions').innerHTML =
      head('Decision log', rows.length ? `${dec.count} · via supabase` : 'via supabase',
           dec.error ? 'warn' : 'live') +
      `<div class="tile-body">${dec.error
        ? `<p class="empty"><b>Mirror unreachable</b>${esc(dec.error)}</p>`
        : rows.length ? rows.slice(0, 6).map(r => `
          <div class="row">
            <div class="row-time">${esc(String(r.decided_on || '').slice(5))}</div>
            <div class="row-main">
              <div class="row-title">${esc(r.decision || '—')}</div>
              <div class="row-sub">${esc(r.opportunity || '')}${r.owner ? ' · ' + esc(r.owner) : ''}</div>
            </div>
          </div>`).join('')
        : '<p class="empty"><b>No decisions</b>The mirror is reachable but empty.</p>'}</div>`;

    /* Each of these was checked against a source, not assumed. The reason
       differs per tile and the differences matter: "no column exists" is a
       data-model gap, "fetched live and never stored" means there is nothing
       to read, and "one row from May" is a table that exists but is dead. A
       single vague "not connected" would flatten all three into one wrong
       impression. */
    const MISSING = [
      ['Revenue · pipeline', 'No monetary column in any Supabase project.'],
      ['Weather', 'No table — the Hub fetches it live and stores nothing.'],
      ['Home controls', 'OAuth state only; no device records.'],
      ['Fitness', 'One workout row, last written 30 May 2026.'],
    ];
    $('#t-nosource').innerHTML = head('Checked · no source', `${MISSING.length} tiles`, 'warn') +
      `<div class="tile-body">
        <ul class="missing">${MISSING.map(([k, why]) => `
          <li><b>${esc(k)}</b><span>${esc(why)}</span></li>`).join('')}</ul>
        <a class="link" href="http://localhost:8080/dashboard">Open Daily Hub</a></div>`;
  };

  /* Composer — the one piece of turn 1a that was left read-only.
     Contract, taken from the orbit view rather than invented:
       POST /api/run  {prompt, skill?, label?}  -> job_view
       GET  /api/job/<id>?offset=N              -> {chunk, offset, status, ...}
       POST /api/stop/<id>                      -> {ok:true}
     The server answers 400 on an empty prompt and 429 over the concurrency
     limit, both with a written reason; those are surfaced verbatim rather
     than replaced with a generic failure. */
  let job = null, timer = null;

  const askEls = () => ({
    form: $('#ask-form'), ta: $('#ask-text'), sel: $('#ask-skill'),
    run: $('#ask-run'), stop: $('#ask-stop'),
    state: $('#ask-state'), out: $('#ask-out'),
  });

  const setBusy = busy => {
    const e = askEls();
    e.run.disabled = busy;
    e.run.textContent = busy ? 'Running…' : 'Run';
    e.stop.hidden = !busy;
    e.ta.readOnly = busy;
  };

  const poll = async () => {
    const e = askEls();
    const r = await fetch(`/api/job/${encodeURIComponent(job.id)}?offset=${job.offset || 0}`)
      .then(x => x.json()).catch(() => null);
    if (!r || r.error) { e.state.textContent = r?.error || 'Lost the run'; setBusy(false); return; }
    job.offset = r.offset;
    if (r.chunk) { e.out.textContent += r.chunk; e.out.scrollTop = e.out.scrollHeight; }
    e.state.textContent = `${r.status} · ${r.elapsed}s`;
    if (r.status === 'running') { timer = setTimeout(poll, 900); return; }
    setBusy(false);
    timer = null;
    if (r.note) e.state.textContent += ` · ${r.note}`;
    load();                       // a finished run changes the counts above
  };

  const submit = async ev => {
    ev.preventDefault();
    const e = askEls();
    const prompt = e.ta.value.trim();
    if (!prompt) { e.state.textContent = 'Nothing to run'; e.ta.focus(); return; }
    setBusy(true);
    e.out.textContent = '';
    e.state.textContent = 'Starting…';
    try {
      const res = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          skill: e.sel.value || 'ad-hoc',
          label: e.sel.value ? e.sel.selectedOptions[0].textContent : 'Ad-hoc request',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { e.state.textContent = body.error || `Run failed (${res.status})`; setBusy(false); return; }
      job = { id: body.id, offset: body.offset || 0 };
      if (body.chunk) e.out.textContent = body.chunk;
      poll();
    } catch (err) { e.state.textContent = 'Could not reach the server'; setBusy(false); }
  };

  const stop = async () => {
    if (!job) return;
    if (timer) { clearTimeout(timer); timer = null; }
    await fetch(`/api/stop/${encodeURIComponent(job.id)}`, { method: 'POST' }).catch(() => {});
    askEls().state.textContent = 'Stopped';
    setBusy(false);
  };

  const renderAsk = d => {
    const skills = (d.con?.skillList || []).slice().sort((a, b) =>
      String(a.label).localeCompare(String(b.label)));
    $('#t-ask').innerHTML = head('Ask Nova', '', 'live') + `
      <div class="tile-body">
        <form class="ask" id="ask-form">
          <label for="ask-text">What do you want me to move forward?</label>
          <textarea id="ask-text" placeholder="Describe the work, or pick a skill and give it a prompt."></textarea>
          <div class="ask-row">
            <select id="ask-skill" aria-label="Skill to run">
              <option value="">Ad-hoc (no skill)</option>
              ${skills.map(s => `<option value="${esc(s.skill)}">${esc(s.label)}</option>`).join('')}
            </select>
            <button type="submit" id="ask-run">Run</button>
            <button type="button" id="ask-stop" data-stop hidden>Stop</button>
            <span class="ask-state" id="ask-state" role="status" aria-live="polite"></span>
          </div>
        </form>
        <pre class="ask-out" id="ask-out" aria-live="polite" aria-label="Run output"></pre>
      </div>`;
    askEls().form.addEventListener('submit', submit);
    askEls().stop.addEventListener('click', stop);
  };

  /* One loader, so a finished run can refresh the counts without a reload.
     The composer is only rebuilt on first paint — re-rendering it mid-session
     would wipe whatever is in the textarea. */
  let askDrawn = false;
  async function load() {
    const [con, vent, hist, agenda, notif, dec] = await Promise.all([
      api('/api/console', {}), api('/api/venture', {}),
      api('/api/history?limit=12', {}), api('/api/agenda', {}),
      api('/api/notifications', {}), api('/api/decisions', {})]);
    const d = { con, vent, hist, agenda, notif, dec };
    render(d);
    if (!askDrawn) { renderAsk(d); askDrawn = true; }
  }
  load();
})();
