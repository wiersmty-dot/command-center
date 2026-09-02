/* The Mission Control chrome, for every other page.
 *
 * Mission Control renders its own shell inline because it builds the whole
 * page. The rest of the Command Center already has markup and behaviour worth
 * keeping, so this wraps what a page ships rather than replacing it: it links
 * /hud.css, moves the page's existing body into `.hud > .hud-wrap`, and puts
 * the same nav strip and masthead above it.
 *
 * A page opts in with:
 *   <script src="/hud-shell.js" data-hud-title="RUNS"
 *           data-hud-sub="Every run, live and archived"></script>
 *
 * Anything already inside <body> keeps working — its own listeners are never
 * re-bound, because the nodes are moved, not re-created. That matters: the
 * dashboard's run tabs and the outbox's approve buttons attach handlers to
 * live nodes, and re-parenting preserves them.
 */
(() => {
  const NAV = [['Mission', '/'], ['Orbit', '/orbit'], ['Board', '/venture'],
               ['Runs', '/runs'], ['Vault', '/vault'], ['Agents', '/agents'],
               ['Outbox', '/outbox']];

  const script = document.currentScript;
  const title = (script && script.dataset.hudTitle) || 'N.O.V.A.';
  const sub = (script && script.dataset.hudSub) || 'Command Center';

  if (!document.querySelector('link[href="/hud.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/hud.css';
    document.head.appendChild(link);
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Which nav entry is this page? Compared on the path only, so /runs and
  // /runs.html both light the same pill.
  const here = location.pathname.replace(/\.html$/, '') || '/';
  const current = ([, href]) => href.replace(/\.html$/, '') === here;

  function build() {
    if (document.querySelector('.hud')) return;      // mission builds its own

    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
<a class="skip" href="#hud-main">Skip to main content</a>
<div class="hud-wrap">
  <nav class="hud-strip" aria-label="Primary">
    ${NAV.map(n => `<a class="hud-pill" href="${n[1]}"${current(n) ? ' aria-current="page"' : ''}>${n[0]}</a>`).join('')}
  </nav>
  <header class="hud-head">
    <div>
      <h1 class="hud-title">${esc(title)}</h1>
      <div class="hud-sub">${esc(sub)}</div>
    </div>
    <div class="hud-clock">
      <div class="hud-time" id="hud-time">--:--:--</div>
      <div class="hud-day" id="hud-day"></div>
    </div>
  </header>
  <main id="hud-main"></main>
</div>`;

    // Move, don't clone: cloning would drop every listener the page has
    // already attached.
    const main = hud.querySelector('#hud-main');
    while (document.body.firstChild) {
      const node = document.body.firstChild;
      if (node.nodeType === 1 && node.tagName === 'SCRIPT') {
        document.head.appendChild(node);              // keep scripts running
        continue;
      }
      main.appendChild(node);
    }
    document.body.appendChild(hud);

    const pad = n => String(n).padStart(2, '0');
    const tick = () => {
      const d = new Date();
      const t = document.getElementById('hud-time');
      const day = document.getElementById('hud-day');
      if (t) t.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      if (day) day.textContent = d.toLocaleDateString(undefined,
        { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    };
    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, { once: true });
  } else {
    build();
  }
})();
