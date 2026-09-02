/* Shared data layer for the three candidate designs.
 *
 * All three read the SAME live endpoints and the SAME normalised model, so what
 * you are comparing is the design, not the data. Nothing here invents a number:
 * where the Command Center has no source for something a daily surface wants,
 * the stream is returned with `source:null` and the pages must say so.
 */
window.CC = (() => {
  const get = async p => {
    const r = await fetch(`/api/${p}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`/api/${p} -> ${r.status}`);
    return r.json();
  };
  const safe = async (p, fallback) => { try { return await get(p); } catch { return fallback; } };

  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() / 1000; };

  async function load() {
    const [venture, outbox, history, agenda, notif, sched, orch, skills] = await Promise.all([
      safe('venture', {}), safe('outbox', { items: [] }), safe('history', { runs: [], stats: {} }),
      safe('agenda', { items: [], sources: [] }), safe('notifications', { notifications: [], unread: 0 }),
      safe('schedules', { schedules: [] }), safe('orchestrations', { orchestrations: [] }),
      safe('skills', { skills: [] }),
    ]);

    const today0 = startOfDay(new Date());
    const runs = history.runs || [];
    const live = runs.filter(r => r.status === 'running');
    const orchs = orch.orchestrations || [];

    // --- needs you: everything genuinely waiting on a human decision ---------
    const needsYou = [
      ...(outbox.items || []).map(i => ({
        kind: 'draft', title: i.title, sub: i.rel, at: i.modified,
        where: '/outbox', why: 'Draft awaiting founder approval',
      })),
      ...orchs.filter(o => o.status === 'done' && o.review?.status !== 'approved'
                        && o.review?.status !== 'rescope_requested')
        .map(o => ({ kind: 'review', title: o.question, sub: o.label, at: o.ended,
                     where: '/runs', why: 'Agent result needs your ruling' })),
      ...(venture.opportunities || []).filter(o => o.approvalStatus === 'pending' || o.approval)
        .map(o => ({ kind: 'gate', title: o.name, sub: o.id, at: null,
                     where: '/board', why: o.approval || 'Awaiting a gate decision' })),
    ];

    // --- in flight ----------------------------------------------------------
    const inFlight = [
      ...live.map(r => ({ kind: 'run', id: r.id, title: r.label, sub: r.skill,
                          started: r.started, where: '/runs' })),
      ...orchs.filter(o => o.status === 'running' || o.status === 'queued')
        .map(o => ({ kind: 'orchestration', id: o.id, title: o.question,
                     sub: o.label, started: o.started, where: '/runs' })),
    ];

    // --- today --------------------------------------------------------------
    const todayItems = (agenda.items || [])
      .filter(i => i.date === new Date().toISOString().slice(0, 10))
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    // --- streams: ventures as rows -----------------------------------------
    // ⚠️ The studio theses are real. The operating businesses are NOT wired to
    // this server at all -- no table, no endpoint, nothing. They are listed with
    // source:null so a design has to show the gap instead of leaving them out
    // (which would imply nothing is happening) or filling them in.
    const streams = [
      ...(venture.opportunities || []).map(o => ({
        name: o.name, id: o.id, kind: 'thesis', source: '/api/venture',
        stage: o.stage, owner: o.owner, next: o.nextProof || o.nextAction,
        blocked: !!o.approval, note: o.approval || '',
        runs: runs.filter(r => (r.skill || '').startsWith('venture-')).length,
      })),
      { name: 'ProWood', kind: 'business', source: null,
        why: 'Scheduler and workbooks live in Power Apps and Excel; nothing reports here.' },
      { name: 'BayCo', kind: 'business', source: null,
        why: 'Ad accounts and lead lists are external; no endpoint on this server.' },
      { name: 'B3 Looper', kind: 'business', source: null,
        why: 'Hardware and app work is in the repo, not tracked by the Command Center.' },
    ];

    return {
      at: Date.now(),
      venture, skills: skills.skills || [], stats: history.stats || {},
      runs, live, orchs, needsYou, inFlight, today: todayItems,
      agendaSources: agenda.sources || [],
      notifications: notif.notifications || [], unread: notif.unread || 0,
      schedules: sched.schedules || [], streams,
      runsToday: runs.filter(r => (r.started || 0) >= today0).length,
      stale: venture.stale,
    };
  }

  // Freshness, stated rather than implied.
  const ago = ts => {
    if (!ts) return null;
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return { load, ago, esc };
})();
