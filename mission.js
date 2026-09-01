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

  const css = `
.hud{--cy:oklch(0.82 0.13 215);--cy-br:oklch(0.95 0.13 200);
  --amber:oklch(0.82 0.17 75);--coral:oklch(0.70 0.18 25);--emerald:oklch(0.78 0.16 155);
  --glass:oklch(0.30 0.06 235 / 5%);--glass-ghost:oklch(0.30 0.06 235 / 1.5%);
  --glass-lift:oklch(0.30 0.06 235 / 4%);
  --grid:oklch(0.82 0.13 215 / 8%);--ring:oklch(0.92 0.16 200);
  --ink:oklch(0.95 0.02 230);--ink-2:oklch(0.82 0.05 230 / 82%);
  --dim:oklch(0.80 0.05 230 / 78%);--ground:oklch(0.16 0.03 240);
  --ease:cubic-bezier(0.16,1,0.3,1);--mid:250ms;
  min-height:100vh;color:var(--ink);background:var(--ground);
  font-family:'Rajdhani',system-ui,sans-serif;
  background-image:
    radial-gradient(ellipse at 50% -12%,oklch(0.82 0.13 215 / 14%),transparent 46rem),
    linear-gradient(var(--grid) 1px,transparent 1px),
    linear-gradient(90deg,var(--grid) 1px,transparent 1px);
  background-size:auto,44px 44px,44px 44px}
:root.light .hud,body.light .hud{--ground:oklch(0.95 0.01 230);--ink:oklch(0.22 0.03 240);
  --ink-2:oklch(0.30 0.03 240);--dim:oklch(0.38 0.03 240);
  --glass:oklch(1 0 0 / 62%);--glass-ghost:oklch(1 0 0 / 42%);--glass-lift:oklch(1 0 0 / 74%);
  --cy:oklch(0.48 0.13 235);--cy-br:oklch(0.42 0.14 240);--grid:oklch(0.48 0.13 235 / 9%)}

.hud-wrap{max-width:1600px;margin:0 auto;padding:16px 22px 40px}

.hud-strip{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}
.hud-pill{display:inline-flex;align-items:center;gap:9px;min-height:36px;padding:0 15px;
  border-radius:999px;background:var(--glass);backdrop-filter:blur(8px) saturate(140%);
  -webkit-backdrop-filter:blur(8px) saturate(140%);
  box-shadow:0 1px 0 oklch(0.92 0.16 200 / 45%) inset,0 0 20px oklch(0.82 0.13 215 / 14%);
  font:600 11px 'JetBrains Mono',monospace;letter-spacing:.18em;text-transform:uppercase;
  color:var(--dim);text-decoration:none}
a.hud-pill{transition:color var(--mid) var(--ease),box-shadow var(--mid) var(--ease)}
a.hud-pill:hover{color:var(--ink)}
a.hud-pill[aria-current="page"]{color:var(--cy-br)}

.hud-head{display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap;margin:6px 0 18px}
.hud-title{margin:0;font-family:'Michroma',sans-serif;font-size:26px;line-height:1.1;
  letter-spacing:.16em;color:var(--ink);text-shadow:0 0 22px oklch(0.82 0.13 215 / 45%)}
.hud-sub{margin-top:7px;font:600 11px 'JetBrains Mono',monospace;letter-spacing:.28em;
  text-transform:uppercase;color:var(--cy)}
.hud-clock{margin-left:auto;text-align:right}
.hud-time{font:700 22px 'JetBrains Mono',monospace;letter-spacing:.06em;color:var(--ink);
  font-variant-numeric:tabular-nums;line-height:1}
.hud-day{margin-top:5px;font:500 11px 'JetBrains Mono',monospace;letter-spacing:.2em;
  text-transform:uppercase;color:var(--dim)}

.tile{position:relative;display:flex;flex-direction:column;min-width:0;padding:14px 15px;
  border-radius:10px;overflow:hidden;background:var(--glass);
  backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);
  box-shadow:0 1px 0 oklch(0.92 0.16 200 / 55%) inset,0 -1px 0 oklch(0.92 0.16 200 / 25%) inset,
    0 0 28px oklch(0.82 0.13 215 / 18%),0 10px 32px oklch(0.04 0.02 240 / 35%);
  color:inherit;text-decoration:none}
.tile:before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1.5px;
  pointer-events:none;background:linear-gradient(135deg,
    oklch(0.92 0.16 200 / 75%) 0%,oklch(0.82 0.13 215 / 15%) 35%,
    oklch(0.82 0.13 215 / 15%) 65%,oklch(0.92 0.16 200 / 65%) 100%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude}
.tile--lifted{background:var(--glass-lift);
  box-shadow:0 1px 0 oklch(0.92 0.16 200 / 70%) inset,0 -1px 0 oklch(0.92 0.16 200 / 35%) inset,
    0 0 40px oklch(0.82 0.13 215 / 22%),0 18px 48px oklch(0.04 0.02 240 / 55%)}
.tile--ghost{background:var(--glass-ghost)}
.tile--amber:before{background:linear-gradient(135deg,oklch(0.90 0.18 80 / 70%),oklch(0.82 0.17 75 / 12%) 35%,oklch(0.82 0.17 75 / 12%) 65%,oklch(0.90 0.18 80 / 60%))}
.tile--green:before{background:linear-gradient(135deg,oklch(0.85 0.18 155 / 70%),oklch(0.78 0.16 155 / 12%) 35%,oklch(0.78 0.16 155 / 12%) 65%,oklch(0.85 0.18 155 / 60%))}
a.tile{transition:transform var(--mid) var(--ease),box-shadow var(--mid) var(--ease)}
a.tile:hover{transform:translateY(-2px)}
.tile:focus-visible{outline:2px solid var(--ring);outline-offset:2px}

.tile-head{position:relative;z-index:2;display:flex;align-items:center;
  justify-content:space-between;gap:9px;margin-bottom:8px}
.tile-name{display:flex;align-items:center;gap:8px;min-width:0}
.tile-title{margin:0;font:600 11px 'JetBrains Mono',monospace;letter-spacing:.18em;
  text-transform:uppercase;color:var(--cy);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.tile--amber .tile-title{color:var(--amber)}
.tile--green .tile-title{color:var(--emerald)}
.tile-meta{flex-shrink:0;font:500 11px 'JetBrains Mono',monospace;letter-spacing:.18em;
  text-transform:uppercase;color:var(--dim)}
.dot{width:7px;height:7px;flex-shrink:0;border-radius:50%}
.dot[data-s="live"]{background:var(--emerald);box-shadow:0 0 8px var(--emerald)}
.dot[data-s="warn"]{background:var(--amber);box-shadow:0 0 8px var(--amber)}
.dot[data-s="alert"]{background:var(--coral);box-shadow:0 0 8px var(--coral)}
.dot[data-s="info"]{background:var(--cy);box-shadow:0 0 8px var(--cy)}
.tile-body{position:relative;z-index:2;display:flex;flex-direction:column;flex:1;min-height:0}

.hud-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:13px}
.stat-value{font:700 34px 'JetBrains Mono',monospace;letter-spacing:.01em;line-height:1;
  color:var(--ink);font-variant-numeric:tabular-nums}
.stat-sub{margin-top:8px;font:500 11px 'JetBrains Mono',monospace;letter-spacing:.14em;
  text-transform:uppercase;color:var(--dim)}
.stat-go{margin-top:9px;opacity:0;font:600 11px 'JetBrains Mono',monospace;
  letter-spacing:.14em;text-transform:uppercase;color:var(--cy);
  transition:opacity var(--mid) var(--ease)}
a.tile:hover .stat-go,a.tile:focus-visible .stat-go{opacity:1}

.hud-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:13px;align-items:start}
.hud-col{display:flex;flex-direction:column;gap:13px;min-width:0}

.row{display:flex;gap:12px;align-items:flex-start;padding:10px 0;
  border-top:1px solid oklch(0.82 0.13 215 / 16%)}
.row:first-of-type{border-top:0;padding-top:2px}
.row-time{flex:0 0 54px;font:600 13px 'JetBrains Mono',monospace;color:var(--cy);
  font-variant-numeric:tabular-nums}
.row-main{flex:1;min-width:0}
.row-title{font-size:14px;line-height:1.4;color:var(--ink)}
.row-sub{margin-top:4px;font:500 11px 'JetBrains Mono',monospace;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim)}
.chip{flex-shrink:0;padding:4px 8px;border-radius:4px;
  border:1px solid oklch(0.82 0.13 215 / 32%);font:600 11px 'JetBrains Mono',monospace;
  letter-spacing:.1em;text-transform:uppercase;color:var(--dim);white-space:nowrap}
.chip[data-t="go"]{color:var(--emerald);border-color:oklch(0.78 0.16 155 / 48%)}
.chip[data-t="warn"]{color:var(--amber);border-color:oklch(0.82 0.17 75 / 48%)}
.chip[data-t="live"]{color:var(--cy);border-color:oklch(0.82 0.13 215 / 58%)}
.vent{padding:11px 0 3px;border-top:1px solid oklch(0.82 0.13 215 / 16%)}
.vent:first-of-type{border-top:0;padding-top:2px}
.vent-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:7px}
.vent-id{font:700 13px 'JetBrains Mono',monospace;letter-spacing:.14em;color:var(--ink)}
.vent-body{margin:0 0 8px;font-size:14px;line-height:1.5;color:var(--ink-2)}
.link{display:inline-flex;align-items:center;min-height:32px;padding:0 12px;
  border-radius:999px;border:1px solid oklch(0.82 0.13 215 / 55%);
  background:oklch(0.82 0.13 215 / 12%);color:var(--cy);text-decoration:none;
  font:600 11px 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;
  transition:background var(--mid) var(--ease)}
.link:hover{background:oklch(0.82 0.13 215 / 24%)}

.ask{display:flex;flex-direction:column;gap:9px}
.ask-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ask label{font:600 11px 'JetBrains Mono',monospace;letter-spacing:.16em;
  text-transform:uppercase;color:var(--dim)}
.ask textarea{width:100%;min-height:66px;resize:vertical;padding:10px 11px;border-radius:6px;
  border:1px solid oklch(0.82 0.13 215 / 38%);background:oklch(0.30 0.06 235 / 12%);
  color:var(--ink);font:400 14px/1.5 'Rajdhani',system-ui,sans-serif}
:root.light .ask textarea,body.light .ask textarea{background:oklch(1 0 0 / 70%)}
.ask textarea::placeholder{color:var(--dim)}
.ask select{min-height:32px;padding:0 8px;border-radius:6px;
  border:1px solid oklch(0.82 0.13 215 / 38%);background:oklch(0.30 0.06 235 / 12%);
  color:var(--ink);font:600 11px 'JetBrains Mono',monospace;letter-spacing:.08em}
:root.light .ask select,body.light .ask select{background:oklch(1 0 0 / 70%)}
.ask button{min-height:32px;padding:0 14px;border-radius:999px;cursor:pointer;
  border:1px solid oklch(0.82 0.13 215 / 55%);background:oklch(0.82 0.13 215 / 14%);
  color:var(--cy);font:600 11px 'JetBrains Mono',monospace;letter-spacing:.12em;
  text-transform:uppercase;transition:background var(--mid) var(--ease)}
.ask button:hover:not(:disabled){background:oklch(0.82 0.13 215 / 26%)}
.ask button:disabled{opacity:.45;cursor:not-allowed}
.ask button[data-stop]{border-color:oklch(0.70 0.18 25 / 60%);
  background:oklch(0.70 0.18 25 / 14%);color:var(--coral)}
.ask :is(textarea,select,button):focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.ask-state{font:600 11px 'JetBrains Mono',monospace;letter-spacing:.14em;
  text-transform:uppercase;color:var(--dim)}
.ask-out{margin:0;max-height:230px;overflow:auto;padding:10px 11px;border-radius:6px;
  background:oklch(0.30 0.06 235 / 14%);border:1px solid oklch(0.82 0.13 215 / 18%);
  font:400 12px/1.55 'JetBrains Mono',monospace;color:var(--ink-2);
  white-space:pre-wrap;word-break:break-word}
:root.light .ask-out,body.light .ask-out{background:oklch(1 0 0 / 62%)}
.missing{margin:0 0 11px;padding:0;list-style:none}
.missing li{padding:8px 0;border-top:1px solid oklch(0.82 0.13 215 / 16%)}
.missing li:first-child{border-top:0;padding-top:2px}
.missing b{display:block;margin-bottom:3px;font:600 11px 'JetBrains Mono',monospace;
  letter-spacing:.14em;text-transform:uppercase;color:var(--amber)}
.missing span{font-size:13px;line-height:1.45;color:var(--ink-2)}
.empty{padding:10px 0 4px;font-size:14px;line-height:1.55;color:var(--ink-2)}
.empty b{display:block;margin-bottom:5px;font:600 11px 'JetBrains Mono',monospace;
  letter-spacing:.16em;text-transform:uppercase;color:var(--amber)}

.skip{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;background:var(--cy-br);
  color:oklch(0.16 0.03 240);border-radius:6px;text-decoration:none;
  font:600 12px 'JetBrains Mono',monospace;letter-spacing:.1em}
.skip:focus{position:fixed;left:14px;top:14px;z-index:60;width:auto;height:auto;
  margin:0;padding:11px 15px;overflow:visible;clip:auto;clip-path:none}

@media (max-width:1180px){
  .hud-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hud-grid{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:640px){
  .hud-stats{grid-template-columns:minmax(0,1fr)}
  .hud-wrap{padding:12px 14px 30px}
  .hud-title{font-size:20px}
}
@media (prefers-reduced-motion:reduce){
  .hud *{transition:none!important;animation:none!important}
  a.tile:hover{transform:none}
}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

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
