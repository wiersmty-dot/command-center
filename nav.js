/* Shared navigation for the Command Center.
 *
 * The four pages came from three different design comps, and none of them
 * shipped real links — orbit painted ORBIT/BOARD/RUNS/VAULT as <span>s, and
 * the console had no nav at all. So every page was a dead end you could only
 * leave by typing a URL.
 *
 * Rather than bolt a second nav bar on top of designs that already have one,
 * this promotes the existing labels to anchors in place, keeping their inline
 * styling, and only injects a bar on pages that genuinely have none.
 */
(() => {
  // ALL is the full set every page should be able to reach. HREF only covers
  // the labels a comp might already have drawn as text, so AGENTS (which no
  // comp drew) is appended rather than promoted.
  const ROUTES = [
    ['ORBIT',   '/'],
    ['BOARD',   '/board'],
    ['RUNS',    '/runs'],
    ['VAULT',   '/vault'],
    ['CLASSIC', '/classic'],
  ];
  const ALL = ROUTES.concat([['MISSION', '/mission'], ['AGENTS', '/agents'], ['OUTBOX', '/outbox']]);
  const HREF = new Map(ROUTES);

  // which page are we on — used to mark the active item
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const ACTIVE = ({
    '/': 'ORBIT', '/orbit': 'ORBIT', '/orbit.html': 'ORBIT',
    '/venture': 'BOARD', '/board': 'BOARD', '/venture.html': 'BOARD',
    '/runs': 'RUNS', '/vault': 'VAULT',
    '/classic': 'CLASSIC', '/dashboard.html': 'CLASSIC',
    '/agents': 'AGENTS', '/console': 'AGENTS',
    '/outbox': 'OUTBOX',
    '/mission': 'MISSION', '/mission.html': 'MISSION',
  })[path] || '';

  /* Promote an existing label element to a real link, keeping its look. */
  function promote(el, label) {
    if (el.closest('a')) return null;
    const a = document.createElement('a');
    a.href = HREF.get(label);
    a.setAttribute('style', el.getAttribute('style') || '');
    a.style.textDecoration = 'none';
    a.style.cursor = 'pointer';
    a.style.color = a.style.color || 'inherit';
    a.textContent = el.textContent;
    if (label === ACTIVE) a.setAttribute('aria-current', 'page');
    el.replaceWith(a);
    return a;
  }

  /* Find nav labels the comps left as inert text.
   *
   * Orbit paints its whole screen twice — once dark, once light — and hides
   * one. Both copies get promoted, not just the visible one, or the nav would
   * go dead the moment you hit the theme toggle.
   */
  function promoteExisting() {
    const wanted = new Set(HREF.keys());

    // Collect candidates grouped by their container. A page title chip that
    // happens to read "RUNS" or "VAULT" is a single label sitting on its own;
    // a real nav has several of these as siblings. Requiring two keeps this
    // from turning a heading into navigation.
    const groups = new Map();
    document.querySelectorAll('span,div,li').forEach(el => {
      if (el.children.length) return;                 // leaf nodes only
      const txt = (el.textContent || '').trim().toUpperCase();
      if (!wanted.has(txt)) return;
      const p = el.parentElement;
      if (!p) return;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push([txt, el]);
    });

    const hits = [];
    groups.forEach(candidates => {
      const distinct = new Set(candidates.map(([t]) => t));
      if (distinct.size < 2) return;                  // a heading, not a nav
      candidates.forEach(([txt, el]) => {
        const a = promote(el, txt);
        if (a) hits.push([txt, a]);
      });
    });
    return hits;
  }

  /* A comp's nav only offered the labels that comp happened to draw — orbit
   * never had AGENTS or CLASSIC. Append whatever is missing into the same
   * container so every page can reach every other one.
   */
  function completeNav(hits) {
    const byParent = new Map();
    hits.forEach(([label, a]) => {
      const p = a.parentElement;
      if (!p) return;
      if (!byParent.has(p)) byParent.set(p, new Set());
      byParent.get(p).add(label);
    });
    byParent.forEach((have, parent) => {
      // copy an inactive sibling's styling so additions look native
      const model = [...parent.querySelectorAll('a')]
        .find(a => !a.hasAttribute('aria-current')) || parent.querySelector('a');
      ALL.forEach(([label, href]) => {
        if (have.has(label)) return;
        const a = document.createElement('a');
        a.href = href;
        if (model) a.setAttribute('style', model.getAttribute('style') || '');
        a.style.textDecoration = 'none';
        a.style.cursor = 'pointer';
        a.textContent = label;
        if (label === ACTIVE) a.setAttribute('aria-current', 'page');
        parent.appendChild(a);
      });
    });
  }

  /* Pages with no nav of their own get a compact bar that matches nothing —
     deliberately neutral so it reads as chrome, not as part of the comp. */
  function inject() {
    if (document.getElementById('cc-nav')) return;
    const bar = document.createElement('nav');
    bar.id = 'cc-nav';
    bar.setAttribute('aria-label', 'Command Center');
    bar.innerHTML = ALL.map(([label, href]) =>
      `<a href="${href}"${label === ACTIVE ? ' aria-current="page"' : ''}>${label}</a>`
    ).join('');
    document.body.appendChild(bar);

    // Layout only. This <style> is appended at runtime, so it lands AFTER
    // /theme.css and would win any colour it declared — which left the bar
    // dark on a light page. The palette lives in theme.css; keep it there.
    const css = document.createElement('style');
    css.textContent = `
      #cc-nav{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:999;
        display:flex;gap:2px;padding:4px;border-radius:999px;
        backdrop-filter:blur(10px);
        font:600 9.5px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.16em}
      #cc-nav a{padding:7px 13px;border-radius:999px;
        text-decoration:none;white-space:nowrap;transition:background .15s,color .15s}
      @media print{#cc-nav{display:none}}`;
    document.head.appendChild(css);
  }

  /* Anchors the page already shipped (venture hand-wrote its own nav). These
     count as an existing nav, so it gets completed rather than given a second
     floating bar on top of the one it already had. */
  function existingAnchors() {
    const byHref = new Map(ALL.map(([label, href]) => [href, label]));
    const hits = [];
    document.querySelectorAll('a[href]').forEach(a => {
      if (a.closest('#cc-nav')) return;
      const label = byHref.get(a.getAttribute('href'));
      if (label) hits.push([label, a]);
    });
    return hits;
  }

  function init() {
    const hits = promoteExisting().concat(existingAnchors());
    if (hits.length) completeNav(hits);   // a real nav: fill in what it lacked
    else inject();                        // no nav at all: give it one
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();
})();
