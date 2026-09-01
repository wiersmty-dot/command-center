(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = async (path, options) => {
    const response = await fetch(path, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `${path} failed`);
    return body;
  };
  const shortDate = timestamp => {
    if (!timestamp) return '—';
    const d = new Date(timestamp * 1000);
    return `${d.toLocaleDateString(undefined, {month:'short', day:'numeric'})} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const duration = seconds => seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds || 0}s`;
  const nav = active => `<div class="nw-top"><div class="nw-brand">NOVA</div><div class="nw-kicker">agentic os</div><nav class="nw-nav" aria-label="Nova"><a href="/orbit">Orbit</a><a ${active==='mission'?'aria-current="page"':''} href="/">Mission</a><a ${active==='board'?'aria-current="page"':''} href="/board">Board</a><a ${active==='runs'?'aria-current="page"':''} href="/runs">Runs</a><a ${active==='vault'?'aria-current="page"':''} href="/vault">Vault</a><a href="/classic">Classic</a><a ${active==='agents'?'aria-current="page"':''} href="/agents">Agents</a></nav><div class="nw-status"><i class="nw-dot"></i>runtime online</div></div>`;
  const toast = text => { const el = $('#toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3400); };
  const shell = (active, title, text, action) => `<main class="nw-shell">${nav(active)}<header class="nw-title"><div><div class="nw-label">${active} / control surface</div><h1>${title}</h1></div><p>${text}</p>${action || ''}</header><div id="workspace"></div></main><div id="toast" class="nw-toast" role="status"></div>`;

  const statusClass = state => state === 'done' ? 'ok' : state === 'fault' ? 'fault' : 'wait';
  const closeJarvis = () => { const panel = $('#jarvis'); if (panel) panel.remove(); };
  const closeVaultReader = () => { const reader = $('#vault-reader'); if (reader) { reader.dispatchEvent(new CustomEvent('vaultreaderclose')); reader.remove(); } };
  async function openJarvis() {
    if ($('#jarvis')) { $('#jarvis-question').focus(); return; }
    document.body.insertAdjacentHTML('beforeend', `<div class="jarvis" id="jarvis" role="presentation"><section class="jarvis-panel" role="dialog" aria-modal="true" aria-labelledby="jarvis-title"><div class="jarvis-head"><div><div class="nw-label">Nova / chief-of-staff console</div><h2 id="jarvis-title">What should move forward?</h2></div><button class="nw-dialog-close" id="jarvis-close">Esc close</button></div><p class="jarvis-copy">Ask a project question. Nova recalls related records, starts local work in the background, and leaves external actions for your approval.</p><div class="jarvis-projects" id="jarvis-projects"><span class="nw-meta">Loading active projects…</span></div><label class="nw-label" for="jarvis-question">Your question</label><textarea id="jarvis-question" placeholder="For example: What is the fastest way to validate the buyer trigger for this project?"></textarea><div class="jarvis-actions"><button class="nw-button" id="jarvis-dispatch">Start background task</button><a class="nw-button ghost" href="/agents">Open agent field</a></div><section class="jarvis-background"><div class="nw-label">Background work</div><div id="jarvis-background-list"><span class="nw-meta">Loading task status…</span></div></section></section></div>`);
    let selectedProject = null;
    const question = $('#jarvis-question');
    const drawProjects = payload => {
      const projects = payload.opportunities || [];
      $('#jarvis-projects').innerHTML = projects.length ? projects.map(project => `<button class="jarvis-project ${project.status === 'active' ? 'active' : ''}" data-project="${esc(project.id)}"><b>${esc(project.id)}</b><span>${esc(project.name)}</span><small>${esc(project.stage || 'Candidate')}</small></button>`).join('') : `<span class="nw-meta">No venture projects are currently available.</span>`;
      document.querySelectorAll('.jarvis-project').forEach(button => button.onclick = () => {
        selectedProject = projects.find(project => project.id === button.dataset.project) || null;
        document.querySelectorAll('.jarvis-project').forEach(item => item.classList.toggle('selected', item === button));
        question.focus();
      });
    };
    const drawBackground = payload => {
      const items = (payload.orchestrations || []).slice(0, 4);
      $('#jarvis-background-list').innerHTML = items.length ? items.map(item => `<div class="jarvis-task"><span class="nw-pill ${statusClass(item.status)}">${esc(item.status)}</span><b>${esc(item.question)}</b><small>${esc((item.stages || []).find(stage => stage.status === 'running')?.name || (item.status === 'done' ? 'archived result' : 'queued for intake'))}</small></div>`).join('') : `<span class="nw-meta">No background tasks yet. Start with a concrete project question.</span>`;
    };
    try {
      const [projects, background] = await Promise.all([api('/api/venture'), api('/api/orchestrations')]);
      drawProjects(projects); drawBackground(background);
    } catch (error) { $('#jarvis-background-list').textContent = `Runtime connection unavailable: ${error.message}`; }
    $('#jarvis-close').onclick = closeJarvis;
    $('#jarvis').onclick = event => { if (event.target.id === 'jarvis') closeJarvis(); };
    $('#jarvis-dispatch').onclick = async () => {
      const rawQuestion = question.value.trim();
      if (!rawQuestion) { question.focus(); return; }
      const action = $('#jarvis-dispatch');
      action.disabled = true; action.textContent = 'Dispatching…';
      const projectPrefix = selectedProject ? `[${selectedProject.id} — ${selectedProject.name}] ` : '';
      try {
        await api('/api/orchestrations', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question: `${projectPrefix}${rawQuestion}`})});
        question.value = ''; action.textContent = 'Background task started'; toast('Chief of Staff task is running in the background.');
        const background = await api('/api/orchestrations'); drawBackground(background);
      } catch (error) { action.disabled = false; action.textContent = 'Start background task'; toast(error.message); }
    };
    question.focus();
  }
  document.addEventListener('click', event => { if (event.target.closest('#jarvis-open')) openJarvis(); });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openJarvis(); }
    if (event.key === 'Escape') { closeJarvis(); closeVaultReader(); }
  });

  function modal(title) {
    document.body.insertAdjacentHTML('beforeend', `<div class="nw-modal" id="modal" hidden><section class="nw-dialog" role="dialog" aria-modal="true"><div class="nw-dialog-head"><strong id="modal-title">${esc(title)}</strong><button class="nw-dialog-close" id="modal-close">Close</button></div><pre class="nw-transcript" id="modal-body"></pre></section></div>`);
    $('#modal-close').onclick = () => $('#modal').hidden = true;
    $('#modal').onclick = event => { if (event.target.id === 'modal') $('#modal').hidden = true; };
  }
  const showModal = (title, body) => { $('#modal-title').textContent = title; $('#modal-body').textContent = body; $('#modal').hidden = false; };

  async function agents() {
    document.body.innerHTML = shell('agents', 'A governed agent field.', 'A read-only operating map of the runner: work flows through command, planning, verification, and bounded specialists. No external action happens without human approval.');
    $('#workspace').innerHTML = `<section class="agent-layout"><aside class="nw-card agent-rail"><div class="nw-label">Architecture</div><ul><li>Command Orchestrator<span>routes intent and maintains state</span></li><li>Planner + Verifier<span>decompose and check bounded work</span></li><li>Specialists<span>research · build · operate · analyze</span></li></ul><div class="governance"><div><b>Read-only autonomy</b>Research and synthesis may proceed within the vault.</div><div><b>External actions</b>Outreach, purchases, legal conclusions, and changes require human approval.</div><div><b>Observability</b>Every run is streamed, logged, and archived.</div></div></aside><section class="nw-card agent-map" aria-label="Agent hierarchy"><button class="agent-node core" data-role="core"><b>Command<br>Orchestrator</b><small>routes + state</small></button><button class="agent-node planner" data-role="planner"><b>Planner</b><small>scope + sequence</small></button><button class="agent-node verifier" data-role="verifier"><b>Verifier</b><small>evidence + guardrails</small></button><button class="agent-node research" data-role="research"><b>Research</b><small>read-only discovery</small></button><button class="agent-node builder" data-role="builder"><b>Builder</b><small>draft + construct</small></button><button class="agent-node operator" data-role="operator"><b>Operator</b><small>local execution</small></button><button class="agent-node analyst" data-role="analyst"><b>Analyst</b><small>measure + interpret</small></button></section><aside class="nw-card agent-inspector"><div class="nw-label">Selected capability</div><div id="agent-detail"><h2>Command Orchestrator</h2><p>Coordinates eligible local work and keeps the operator in control of anything externally consequential.</p><span class="nw-pill ok">observed</span></div><div class="governance"><div><b>System rule</b>Skills execute with a durable run record; not all agents may change the outside world.</div></div></aside></section><section class="agent-observe"><section class="nw-card chief-station"><div class="nw-card-head"><div><h2>Chief of Staff dispatch</h2><p>Ask a question and watch the actual local run move through its lifecycle.</p></div><span class="nw-pill ok" id="chief-state">ready</span></div><div class="chief-body"><label class="nw-label" for="chief-question">Operator question</label><textarea id="chief-question" placeholder="What do you want the Chief of Staff to work through?"></textarea><div class="chief-actions"><button class="nw-button" id="chief-send">Dispatch to Chief of Staff</button><span class="nw-meta">Local work only · every output is archived</span></div><div class="trace" id="chief-trace"><div class="trace-step active" data-step="0"><b>Intake</b><span>question captured</span></div><div class="trace-step" data-step="1"><b>Plan</b><span>scope and constraints</span></div><div class="trace-step" data-step="2"><b>Work</b><span>local skill execution</span></div><div class="trace-step" data-step="3"><b>Verify</b><span>result checked for handoff</span></div><div class="trace-step" data-step="4"><b>Archive</b><span>run record written</span></div></div><div class="chief-output"><div class="nw-label">Live return</div><pre id="chief-log">Waiting for a Chief of Staff question.</pre></div></div></section><section class="nw-card agent-history"><div class="nw-card-head"><div><h2>Observed work</h2><p>Who ran, when they ran, and the returned record.</p></div><span class="nw-meta" id="history-count">loading</span></div><div id="agent-history-list"></div></section><section class="nw-card agent-inventory"><div class="nw-card-head"><div><h2>Agent registry</h2><p>Every installed agent, its role, backing skill, and recorded use.</p></div><span class="nw-meta" id="agent-count">loading</span></div><div id="agent-inventory-list"></div></section></section>`;
    $('#workspace .agent-observe').insertAdjacentHTML('beforeend', `<section class="nw-card decision-inbox"><div class="nw-card-head"><div><h2>Founder review queue</h2><p>Returned work becomes a decision task: read the result, approve the local recommendation, or redirect the next run.</p></div><span class="nw-meta" id="decision-count">loading</span></div><div id="decision-task-list"></div></section>`);
    let data, history, orchestrationData;
    try { [data, history, orchestrationData] = await Promise.all([api('/api/agents'), api('/api/history?limit=80'), api('/api/orchestrations?limit=30')]); } catch (error) { $('#agent-detail').innerHTML = `<div class="nw-empty">Agent registry unavailable: ${esc(error.message)}</div>`; return; }
    const categories = {
      core: {title:'Command Orchestrator', note:'Routes user intent to a bounded skill, then records the output for review.', picks: data.agents.slice(0, 3)},
      planner: {title:'Planner', note:'Turns an objective into an ordered local workflow before execution.', picks: data.agents.filter(a => /plan|project|brief/i.test(`${a.label} ${a.group}`)).slice(0, 3)},
      verifier: {title:'Verifier', note:'Checks evidence, constraints, and completion criteria before a decision advances.', picks: data.agents.filter(a => /review|check|audit|validate/i.test(`${a.label} ${a.group}`)).slice(0, 3)},
      research: {title:'Research specialists', note:'Read-only research and synthesis. Outputs are logged rather than sent externally.', picks: data.agents.filter(a => /research|intel|market/i.test(`${a.label} ${a.group}`)).slice(0, 3)},
      builder: {title:'Builder specialists', note:'Produces local artifacts and implementation drafts under the run archive.', picks: data.agents.filter(a => /build|code|write/i.test(`${a.label} ${a.group}`)).slice(0, 3)},
      operator: {title:'Operator specialists', note:'Runs approved local workflows; external commitments stay gated.', picks: data.agents.filter(a => /operate|morning|run/i.test(`${a.label} ${a.group}`)).slice(0, 3)},
      analyst: {title:'Analyst specialists', note:'Interprets records, options, and operating signals for human review.', picks: data.agents.filter(a => /anal|finance|venture/i.test(`${a.label} ${a.group}`)).slice(0, 3)},
    };
    const select = key => {
      document.querySelectorAll('.agent-node').forEach(el => el.classList.toggle('selected', el.dataset.role === key));
      const item = categories[key], choices = item.picks.length ? item.picks : data.agents.slice(0, 3);
      $('#agent-detail').innerHTML = `<h2>${esc(item.title)}</h2><p>${esc(item.note)}</p><span class="nw-pill ok">${data.withFile}/${data.agents.length} backed by skill files</span><div class="governance">${choices.map(a => `<div><b>${esc(a.label)}</b>${esc(a.group)} · ${a.runs} recorded runs <button class="nw-button ghost run-agent" data-skill="${esc(a.skill)}">run</button></div>`).join('')}</div>`;
      document.querySelectorAll('.run-agent').forEach(button => button.onclick = async () => {
        const agent = data.agents.find(a => a.skill === button.dataset.skill); if (!agent) return;
        button.disabled = true; button.textContent = 'starting';
        try { await api('/api/run', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({skill:agent.skill,label:agent.label,prompt:agent.prompt})}); toast(`${agent.label} started; transcript is available in Runs.`); button.textContent = 'started'; }
        catch (error) { button.textContent = 'failed'; toast(error.message); }
      });
    };
    const statusClass = state => state === 'done' ? 'ok' : state === 'fault' ? 'fault' : 'wait';
    const showRun = async row => {
      $('#chief-log').textContent = 'Loading returned record…';
      $('#chief-state').textContent = row.status || 'recorded';
      setTrace(row.status === 'done' ? 4 : row.status === 'running' ? 2 : 3, row.status === 'done');
      try {
        if (row.live) {
          const job = await api(`/api/job/${encodeURIComponent(row.id)}?offset=0`);
          $('#chief-log').textContent = job.chunk || '(run started; no text returned yet)';
        } else if (row.note) {
          const vault = await api('/api/vault');
          const note = (vault.notes || []).find(n => n.name === row.note.split('/').pop());
          if (!note) throw new Error('Archived transcript not found.');
          const record = await api(`/api/vault/note?name=${encodeURIComponent(note.name)}`);
          $('#chief-log').textContent = record.body;
        } else $('#chief-log').textContent = 'This completed run predates the available archived transcript.';
      } catch (error) { $('#chief-log').textContent = error.message; }
    };
    const drawObserved = () => {
      const rows = history.runs || [];
      $('#history-count').textContent = `${rows.length} recorded runs`;
      $('#agent-history-list').innerHTML = rows.slice(0, 7).map(row => `<button class="observed-run" data-id="${esc(row.id)}"><span class="nw-pill ${statusClass(row.status)}">${esc(row.status)}</span><strong>${esc(row.label)}</strong><small>${esc(row.skill)} · ${esc(shortDate(row.started))} · ${esc(duration(row.elapsed))}</small></button>`).join('') || `<div class="nw-empty">No run records yet.</div>`;
      document.querySelectorAll('.observed-run').forEach(button => button.onclick = () => showRun(rows.find(r => r.id === button.dataset.id)));
      $('#agent-count').textContent = `${data.agents.length} agents · ${data.withFile} backed`;
      $('#agent-inventory-list').innerHTML = data.agents.map(agent => `<button class="inventory-agent" data-skill="${esc(agent.skill)}"><span class="inventory-dot ${agent.hasFile ? 'ready' : ''}"></span><strong>${esc(agent.label)}</strong><small>${esc(agent.group)} · ${agent.runs} runs · ${agent.last ? shortDate(agent.last) : 'not yet run'}</small></button>`).join('');
      document.querySelectorAll('.inventory-agent').forEach(button => button.onclick = () => {
        const agent = data.agents.find(a => a.skill === button.dataset.skill);
        $('#chief-log').textContent = `${agent.label}\n\nGroup: ${agent.group}\nRecorded runs: ${agent.runs}\nAverage duration: ${duration(agent.avg)}\nFaults: ${agent.faults}\n\nPrompt:\n${agent.prompt}`;
        $('#chief-state').textContent = agent.hasFile ? 'skill ready' : 'no skill file';
      });
    };
    const drawDecisionQueue = () => {
      const tasks = (orchestrationData.orchestrations || []).filter(item => item.status === 'done' || item.status === 'fault');
      $('#decision-count').textContent = tasks.length ? `${tasks.filter(item => item.review?.status !== 'approved').length} awaiting you` : 'no returned tasks';
      $('#decision-task-list').innerHTML = tasks.length ? tasks.slice(0, 6).map(item => {
        const review = item.review || {}, latest = [...(item.stages || [])].reverse().find(stage => stage.result);
        const result = latest?.result || item.error || 'The task returned without a readable result.';
        const isApproved = review.status === 'approved';
        const isRescoped = review.status === 'rescope_requested';
        return `<article class="decision-task ${isApproved ? 'approved' : ''}" data-task="${esc(item.id)}"><div class="decision-task-orbit"></div><div class="decision-task-head"><span class="nw-pill ${isApproved ? 'ok' : statusClass(item.status)}">${esc(isApproved ? 'reviewed' : item.status === 'fault' ? 'needs attention' : 'decision ready')}</span><span class="nw-meta">${esc(shortDate(item.ended || item.updated || item.started))}</span></div><h3>${esc(item.question)}</h3><div class="decision-result"><div class="nw-label">${esc(latest?.name || 'Returned result')}</div><p>${esc(result.slice(0, 620))}${result.length > 620 ? '…' : ''}</p></div>${isApproved ? `<div class="decision-reviewed">Approved locally · ${esc(review.note || 'manual follow-through remains yours')}</div>` : isRescoped ? `<div class="decision-reviewed">New scope running in background${review.followUpId ? ` · task ${esc(review.followUpId)}` : ''}</div>` : `<div class="decision-actions"><button class="nw-button review-approve" data-task="${esc(item.id)}">Approve recommendation</button><button class="nw-button ghost review-scope" data-task="${esc(item.id)}">Change agent scope</button><button class="nw-button ghost review-result" data-task="${esc(item.id)}">Read full result</button></div><div class="scope-editor" id="scope-${esc(item.id)}" hidden><label class="nw-label" for="scope-input-${esc(item.id)}">Redirect the next run</label><textarea id="scope-input-${esc(item.id)}" placeholder="For example: focus only on buyer interviews and exclude market sizing."></textarea><button class="nw-button scope-submit" data-task="${esc(item.id)}">Start revised task</button></div>`}</article>`;
      }).join('') : `<div class="nw-empty">Completed Chief-of-Staff tasks will appear here as reviewable decisions.</div>`;
      document.querySelectorAll('.review-result').forEach(button => button.onclick = () => {
        const item = tasks.find(task => task.id === button.dataset.task); const latest = [...(item.stages || [])].reverse().find(stage => stage.result);
        $('#chief-log').textContent = latest?.result || item.error || 'No returned result.'; $('#chief-state').textContent = 'reviewing'; setTrace(4, true);
      });
      document.querySelectorAll('.review-approve').forEach(button => button.onclick = async () => {
        button.disabled = true;
        try { await api(`/api/orchestrations/${encodeURIComponent(button.dataset.task)}/review`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({decision:'approve'})}); orchestrationData = await api('/api/orchestrations?limit=30'); drawDecisionQueue(); toast('Recommendation approved locally; external follow-through remains gated.'); }
        catch (error) { button.disabled = false; toast(error.message); }
      });
      document.querySelectorAll('.review-scope').forEach(button => button.onclick = () => { $(`#scope-${button.dataset.task}`).hidden = false; $(`#scope-input-${button.dataset.task}`).focus(); });
      document.querySelectorAll('.scope-submit').forEach(button => button.onclick = async () => {
        const input = $(`#scope-input-${button.dataset.task}`), scope = input.value.trim(); if (!scope) { input.focus(); return; }
        button.disabled = true;
        try { await api(`/api/orchestrations/${encodeURIComponent(button.dataset.task)}/review`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({decision:'rescope', scope})}); orchestrationData = await api('/api/orchestrations?limit=30'); drawDecisionQueue(); toast('Revised agent task is running in the background.'); }
        catch (error) { button.disabled = false; toast(error.message); }
      });
    };
    const setTrace = (active, finished = false) => document.querySelectorAll('.trace-step').forEach(step => {
      const n = Number(step.dataset.step); step.classList.toggle('done', n < active || (finished && n <= active)); step.classList.toggle('active', !finished && n === active);
    });
    $('#chief-send').onclick = async () => {
      const question = $('#chief-question').value.trim();
      if (!question) { $('#chief-question').focus(); return; }
      const send = $('#chief-send'); send.disabled = true; send.textContent = 'Dispatching…'; $('#chief-state').textContent = 'starting'; setTrace(0); $('#chief-log').textContent = `Question accepted:\n${question}\n\nRecalling durable records, then starting the Chief of Staff pipeline…`;
      try {
        const orchestration = await api('/api/orchestrations', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question})});
        const poll = async () => {
          try {
            const update = await api(`/api/orchestrations/${encodeURIComponent(orchestration.id)}`);
            const active = Math.max(0, update.stages.findIndex(stage => stage.status === 'running'));
            const latest = [...update.stages].reverse().find(stage => stage.result);
            if (latest) $('#chief-log').textContent = `${latest.name} · ${latest.skill}\n\n${latest.result}`;
            $('#chief-state').textContent = update.status;
            if (update.status === 'queued' || update.status === 'running') { setTrace(active); setTimeout(poll, 1100); return; }
            setTrace(4, update.status === 'done'); $('#chief-state').textContent = update.status === 'done' ? 'archived' : update.status; send.textContent = 'Dispatch to Chief of Staff'; send.disabled = false; toast(`Chief pipeline ${update.status}.`);
            [history, orchestrationData] = await Promise.all([api('/api/history?limit=80'), api('/api/orchestrations?limit=30')]); drawObserved(); drawDecisionQueue();
          } catch (error) { $('#chief-log').textContent += `\n\nTrace error: ${error.message}`; $('#chief-state').textContent = 'error'; send.textContent = 'Dispatch to Chief of Staff'; send.disabled = false; }
        };
        setTrace(1); poll();
      } catch (error) { $('#chief-log').textContent += `\n\nCould not start: ${error.message}`; $('#chief-state').textContent = 'failed'; send.textContent = 'Dispatch to Chief of Staff'; send.disabled = false; }
    };
    document.querySelectorAll('.agent-node').forEach(button => button.onclick = () => select(button.dataset.role)); select('core'); drawObserved(); drawDecisionQueue();
  }

  async function vault() {
    document.body.innerHTML = shell('vault', 'Knowledge, with evidence attached.', 'Search durable run records, follow the semantic connections, and pull only the evidence needed to answer a real operating question.', '<button class="nw-button" id="ask-action">Ask the vault</button>');
    const initialQuery = new URLSearchParams(location.search).get('q') || '';
    $('#workspace').innerHTML = `<section class="vault-layout"><aside class="nw-card vault-rail"><h3>Context</h3><input id="vault-search" class="nw-search" placeholder="search records…" value="${esc(initialQuery)}"><h3 style="margin-top:20px">Saved views</h3><button class="vault-view">Recent work<small id="view-recent">Loading…</small></button><button class="vault-view">Research evidence<small>source-backed outputs</small></button><button class="vault-view">Open decisions<small>requires operator review</small></button><button class="vault-view">Build artifacts<small>delivered files and notes</small></button></aside><section class="nw-card vault-map"><div class="map-lines"></div><div class="knowledge-node core"><strong>Semantic<br>knowledge map</strong><span id="map-count">archive index</span></div><div class="knowledge-node n1"><strong>Operating context</strong><span>projects + constraints</span></div><div class="knowledge-node n2"><strong>Research evidence</strong><span>sources + findings</span></div><div class="knowledge-node n3"><strong>Run archive</strong><span>prompts + transcripts</span></div><div class="knowledge-node n4"><strong>Decisions</strong><span>proof + approvals</span></div><button class="vault-ask-trigger" id="vault-ask-trigger" type="button">Ask Vault</button></section><aside class="nw-card vault-preview"><div class="nw-label">Evidence preview</div><div id="vault-preview"><div class="nw-empty">Select a record or ask a question.</div></div></aside></section>`;
    let notes = [], root = '';
    const draw = () => {
      const needle = $('#vault-search').value.trim().toLowerCase();
      const filtered = notes.filter(note => !needle || note.name.toLowerCase().includes(needle)).slice(0, 8);
      $('#view-recent').textContent = `${notes.length} archived records`;
      $('#map-count').textContent = `${notes.length} live records`;
      const preview = $('#vault-preview');
      preview.innerHTML = filtered.length ? `<div class="governance">${filtered.map(n => `<div><b>${esc(n.name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2} \d{4} /,''))}</b>${esc(shortDate(n.modified))} · ${Math.ceil(n.bytes / 1024)} KB<button class="nw-button ghost vault-open" data-note="${esc(n.name)}" aria-label="Inspect ${esc(n.name.replace(/\.md$/, ''))}">Inspect</button></div>`).join('')}</div>` : `<div class="nw-empty">No archived record matches this view.</div>`;
      document.querySelectorAll('.vault-open').forEach(button => button.onclick = () => open(button.dataset.note));
    };
    const sectionize = body => {
      const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
      const chunks = [], headings = [];
      let current = {title:'Opening context', lines:[]};
      const flush = () => { if (current.lines.some(line => line.trim())) chunks.push(current); };
      lines.forEach(line => {
        const match = line.match(/^#{1,6}\s+(.+)$/);
        if (match) { flush(); current = {title:match[1].trim(), lines:[]}; headings.push(match[1].trim()); }
        else current.lines.push(line);
      });
      flush();
      if (chunks.length <= 1 && lines.length > 42) {
        const pieces = [];
        for (let index = 0; index < lines.length; index += 32) pieces.push({title:index ? `Record continuation ${index / 32 + 1}` : 'Opening context', lines:lines.slice(index,index + 32)});
        return {sections:pieces.filter(section => section.lines.some(line => line.trim())), headings:[]};
      }
      return {sections:chunks, headings};
    };
    const takeaways = body => String(body || '').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#') && !line.startsWith('```')).filter(line => !/^[-*+]\s*$/.test(line)).slice(0, 3).map(line => line.slice(0, 260));
    const renderReader = (note, record) => {
      closeVaultReader();
      const parsed = sectionize(record.body), summary = takeaways(record.body);
      const safeId = index => `vault-section-${index}`;
      document.body.insertAdjacentHTML('beforeend', `<div class="vault-reader" id="vault-reader" role="presentation"><section class="vault-reader-panel" role="dialog" aria-modal="true" aria-labelledby="vault-reader-title"><header class="vault-reader-head"><div><div class="nw-label">Vault / evidence reader</div><h2 id="vault-reader-title">${esc(note.name.replace(/\.md$/, ''))}</h2><div class="vault-reader-meta">${esc(root)}/${esc(note.rel || note.name)} · ${esc(shortDate(note.modified))} · ${Math.ceil(note.bytes / 1024)} KB</div></div><div class="vault-reader-actions"><button class="nw-button ghost" id="vault-reader-back">Back to results</button><button class="nw-dialog-close" id="vault-reader-close">Close</button></div></header><div class="vault-reader-grid"><aside class="vault-reader-toc"><div class="nw-label">In this record</div><div class="vault-toc-list">${parsed.sections.map((section,index) => `<button data-target="${safeId(index)}"><span>${String(index + 1).padStart(2,'0')}</span>${esc(section.title)}</button>`).join('')}</div><div class="vault-source-card"><div class="nw-label">Source citation</div><b>${esc(note.name)}</b><small>${esc(note.rel || note.name)}</small><small>Local archive · read only</small></div></aside><main class="vault-reader-main" id="vault-reader-main"><section class="vault-reader-summary"><div class="nw-label">At a glance</div>${summary.length ? `<ul>${summary.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p>No concise text was available to extract from this record.</p>'}</section>${parsed.sections.map((section,index) => `<article class="vault-reader-section" id="${safeId(index)}"><div class="vault-section-kicker">Section ${String(index + 1).padStart(2,'0')}</div><h3>${esc(section.title)}</h3><pre>${esc(section.lines.join('\n').trim())}</pre></article>`).join('')}</main></div></section></div>`);
      $('#vault-reader').addEventListener('vaultreaderclose', draw);
      $('#vault-reader-close').onclick = closeVaultReader;
      $('#vault-reader-back').onclick = closeVaultReader;
      $('#vault-reader').onclick = event => { if (event.target.id === 'vault-reader') closeVaultReader(); };
      document.querySelectorAll('.vault-toc-list button').forEach(button => button.onclick = () => { const section = $(`#${button.dataset.target}`); if (section) section.scrollIntoView({behavior:'smooth', block:'start'}); });
      $('#vault-reader-close').focus();
    };
    const open = async name => {
      const note = notes.find(n => n.name === name); if (!note) return;
      $('#vault-preview').innerHTML = `<h2>${esc(name.replace(/\.md$/, ''))}</h2><div class="nw-meta">${esc(root)}/${esc(note.rel || name)}</div><p class="nw-meta">Opening a focused reader with document sections and source metadata…</p>`;
      try { const record = await api(`/api/vault/note?name=${encodeURIComponent(name)}`); renderReader(note, record); }
      catch (error) { $('#vault-preview').innerHTML = `<div class="nw-empty">${esc(error.message)}</div>`; }
    };
    $('#vault-search').oninput = draw;
    const openAsk = () => {
      $('#vault-preview').innerHTML = `<div class="vault-ask"><div class="nw-label">Question for the vault</div><h2>What needs evidence?</h2><textarea id="vault-question" placeholder="Ask a specific operating question…"></textarea><button class="nw-button" id="vault-question-submit">Find supporting records</button></div>`;
      $('#vault-question').focus();
      $('#vault-question-submit').onclick = async () => { const q = $('#vault-question').value.trim(); if (!q) return $('#vault-question').focus(); $('#vault-question-submit').disabled = true; $('#vault-question-submit').textContent = 'Searching local evidence…'; try { const response = await api(`/api/vault/search?q=${encodeURIComponent(q)}`); const matches = response.items || []; $('#vault-preview').innerHTML = `<div class="vault-ask"><div class="nw-label">Evidence matches</div><h2>${matches.length ? `${matches.length} ranked local record${matches.length === 1 ? '' : 's'}` : 'No supporting local records yet'}</h2><p class="nw-meta">Results are ranked from the locally archived evidence. Open a record to inspect the underlying source.</p>${matches.length ? `<div class="vault-ask-results">${matches.map(match => `<button class="vault-ask-result" data-note="${esc(match.name)}"><b>${esc(match.name.replace(/\.md$/, ''))}</b><span>${esc(match.snippet || 'No readable excerpt.')}</span></button>`).join('')}</div>` : '<p class="nw-meta">Try a more specific project, decision, or evidence term.</p>'}</div>`; document.querySelectorAll('.vault-ask-result').forEach(button => button.onclick = () => open(button.dataset.note)); } catch (error) { $('#vault-preview').innerHTML = `<div class="nw-empty">Evidence search unavailable: ${esc(error.message)}</div>`; } };
    };
    $('#ask-action').onclick = openAsk;
    $('#vault-ask-trigger').onclick = openAsk;
    try { const payload = await api('/api/vault'); notes = payload.notes || []; root = payload.workdir || ''; if (payload.error) $('#vault-preview').innerHTML = `<div class="nw-empty">${esc(payload.error)}</div>`; else draw(); }
    catch (error) { $('#vault-preview').innerHTML = `<div class="nw-empty">Vault unavailable: ${esc(error.message)}</div>`; }
  }

  async function runs() {
    document.body.innerHTML = shell('runs', 'A run control room.', 'Launch bounded work, watch the live path from plan to verification, and read the transcript before deciding what happens next.', '<button class="nw-button" id="launch-action">Launch a run</button>');
    $('#workspace').innerHTML = `<section class="runs-layout"><aside class="nw-card run-rail"><h3>Run queue</h3><div id="run-queue"><div class="nw-empty">Loading…</div></div><h3 style="margin-top:24px">Recently complete</h3><div id="run-recent"></div></aside><section class="nw-card run-flow"><div class="nw-label">Live execution flow</div><div class="run-flow-track"><div class="run-step active"><b>Plan</b><span>clarify the bounded objective</span></div><div class="run-step"><b>Research</b><span>gather context and evidence</span></div><div class="run-step"><b>Build</b><span>produce the local result</span></div><div class="run-step"><b>Verify</b><span>check output and constraints</span></div><div class="run-step"><b>Complete</b><span>archive transcript and artifacts</span></div></div><section class="nw-card run-transcript"><h2 id="transcript-title">Run transcript</h2><pre id="transcript">Select a recent run, or launch an approved local task.</pre></section></section><aside class="nw-card run-rail"><h3>Launch local work</h3><div class="runs-launch"><input id="run-prompt" placeholder="Describe the work…"><button class="nw-button" id="run-go">Launch</button></div><div class="governance"><div><b>Bounded execution</b>Runs are local and logged. External actions remain subject to approval.</div><div><b>Archive</b>Finished work is written to the vault with the complete transcript.</div></div><h3 style="margin-top:26px">Run health</h3><div id="run-health" class="nw-meta">Loading…</div></aside></section>`;
    let rows = [];
    const show = async row => {
      $('#transcript-title').textContent = row.label;
      $('#transcript').textContent = 'Loading transcript…';
      try {
        if (row.live) { const job = await api(`/api/job/${encodeURIComponent(row.id)}?offset=0`); $('#transcript').textContent = job.chunk || '(run started; no output yet)'; }
        else { $('#transcript').textContent = row.note ? 'This archived run is available in Vault.' : 'This completed run predates the accessible transcript archive.'; }
      } catch (error) { $('#transcript').textContent = error.message; }
    };
    const draw = stats => {
      const live = rows.filter(r => r.status === 'running'), recent = rows.filter(r => r.status !== 'running').slice(0, 8);
      const markup = item => `<button class="run-row" data-id="${esc(item.id)}"><b>${esc(item.label)}</b><small>${esc(item.skill)} · ${esc(duration(item.elapsed))} · ${esc(item.status)}</small></button>`;
      $('#run-queue').innerHTML = live.length ? live.map(markup).join('') : `<div class="nw-empty">No live runs. The runtime is ready.</div>`;
      $('#run-recent').innerHTML = recent.length ? recent.map(markup).join('') : `<div class="nw-empty">No recorded completions.</div>`;
      $('#run-health').textContent = `${stats.total || 0} recorded · ${stats.today || 0} today · ${stats.faults || 0} faults · ${duration(stats.avgSeconds || 0)} avg`;
      document.querySelectorAll('.run-row').forEach(button => button.onclick = () => show(rows.find(r => r.id === button.dataset.id)));
    };
    const launch = async () => {
      const prompt = $('#run-prompt').value.trim(); if (!prompt) { $('#run-prompt').focus(); return; }
      $('#run-go').disabled = true;
      try { const job = await api('/api/run', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skill:'ad-hoc',label:'Operator request',prompt})}); $('#transcript-title').textContent = 'Operator request'; $('#transcript').textContent = job.chunk || 'Run started…'; toast('Run launched and will be archived when complete.'); await load(); }
      catch (error) { toast(error.message); } finally { $('#run-go').disabled = false; }
    };
    $('#run-go').onclick = launch; $('#launch-action').onclick = () => $('#run-prompt').focus();
    async function load() { try { const payload = await api('/api/history?limit=80'); rows = payload.runs || []; draw(payload.stats || {}); } catch (error) { $('#run-queue').innerHTML = `<div class="nw-empty">Run history unavailable: ${esc(error.message)}</div>`; } }
    await load(); setInterval(load, 7000);
  }

  async function board() {
    document.body.innerHTML = shell('board', 'Decisions move like a river.', 'Compare opportunities across time horizons, select the proof that matters, and record an explicit human decision instead of turning strategy into a kanban queue.', '<button class="nw-button" id="add-decision">Add decision</button>');
    $('#workspace').innerHTML = `<section class="board-layout"><aside class="nw-card board-rail"><h3>Horizon</h3><button class="filter-chip active" data-filter="active">Active</button><button class="filter-chip" data-filter="all">All records</button><h3 style="margin-top:20px">Decision filters</h3><button class="filter-chip active">Needs approval</button><button class="filter-chip">Evidence pending</button><button class="filter-chip">Pilot horizon</button><div class="governance"><div><b>Human gate</b>Changing a decision state is recorded locally; it cannot send outreach or commit spend.</div></div></aside><section class="nw-card river"><div class="nw-label">Spatial decision river</div><div id="river-clusters"></div></section><aside class="nw-card board-detail"><div class="nw-label">Selected decision</div><div id="decision-detail"><div class="nw-empty">Loading decisions…</div></div></aside></section>`;
    let state, selected, filter = 'active';
    const getOpportunity = () => (state.opportunities || []).find(o => o.id === selected) || (state.opportunities || [])[0];
    const renderDetail = () => {
      const o = getOpportunity(); if (!o) return;
      selected = o.id;
      const evidence = [o.nextProof, o.nextAction, o.approval].filter(Boolean);
      $('#decision-detail').innerHTML = `<h2>${esc(o.name)}</h2><div class="nw-meta">${esc(o.id)} · ${esc(o.stage || 'candidate')}</div><p>${esc(o.summary || 'No summary recorded.')}</p><span class="nw-pill ${o.approvalStatus === 'pending' ? 'wait' : 'ok'}">${esc(o.approvalStatus === 'pending' ? 'approval needed' : 'scope approved')}</span><div class="evidence"><h3>Evidence + next proof</h3>${evidence.map(item => `<div>${esc(item)}</div>`).join('')}</div><div class="board-actions">${o.approvalStatus === 'pending' ? '<button class="nw-button" data-decision="approve" data-dispatch="1">Approve &amp; start brief</button><button class="nw-button ghost" data-decision="approve">Approve only</button>' : ''}${o.approvalStatus === 'approved' ? '<button class="nw-button warn" data-decision="advance">Advance horizon</button>' : ''}${o.status === 'active' ? '<button class="nw-button ghost" data-decision="hold">Hold</button>' : '<button class="nw-button ghost" data-decision="resume">Resume</button>'}<button class="nw-button ghost" id="brief">Run bounded brief</button></div>`;
      document.querySelectorAll('[data-decision]').forEach(button => button.onclick = () => decide(o, button.dataset.decision, button.dataset.dispatch === '1'));
      $('#brief').onclick = () => runBrief(o);
    };
    const render = () => {
      const items = (state.opportunities || []).filter(o => filter === 'all' || o.status === 'active').slice(0, 3);
      $('#river-clusters').innerHTML = items.length ? items.map((o, index) => `<button class="decision-cluster c${index + 1} ${o.id === selected ? 'selected' : ''}" data-id="${esc(o.id)}"><b>${esc(o.name)}</b><span>${esc(o.stage || 'Candidate')} · ${esc(o.nextProof || 'proof pending')}</span></button>`).join('') : `<div class="nw-empty">No decisions in this horizon.</div>`;
      document.querySelectorAll('.decision-cluster').forEach(button => button.onclick = () => { selected = button.dataset.id; render(); renderDetail(); }); renderDetail();
    };
    const decide = async (o, decision, dispatch) => {
      // Approving means two different things: authorising the owner to start,
      // and clearing the way to advance a gate. Only the first spends a run.
      const ask = dispatch
        ? `Approve this scope and start the ${o.owner} brief for ${o.id} now?`
        : `Record ${decision} for ${o.name}? This only updates local board state.`;
      if (!confirm(ask)) return;
      try {
        const result = await api('/api/venture/decision', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opportunity: o.id, decision, dispatch: !!dispatch })
        });
        if (result.job) toast(`${result.decision} - started ${result.job.label}`);
        else if (result.dispatchError) toast(result.dispatchError);
        else toast(result.decision);
        await load();
      } catch (error) { toast(error.message); }
    };
    const runBrief = async o => { if (!confirm(`Start the prepared local brief for ${o.id}? It cannot authorize external action.`)) return; try { await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skill:o.owner,label:`${o.id} — ${o.name}`,prompt:o.brief})}); toast('Bounded brief started; follow it in Runs.'); } catch (error) { toast(error.message); } };
    document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button)); render(); });
    $('#add-decision').onclick = () => toast('New decisions are added through the current venture operating record; select an existing opportunity to make its next gated decision.');
    async function load() { try { state = await api('/api/venture'); selected = selected || (state.opportunities || [])[0]?.id; render(); } catch (error) { $('#decision-detail').innerHTML = `<div class="nw-empty">Board unavailable: ${esc(error.message)}</div>`; } }
    await load(); setInterval(load, 30000);
  }

  // The priority horizon is deliberately a list, not a board: the founder can
  // scan one decision at a time, understand the consequence, then make a
  // bounded local choice. The underlying venture record remains the source of
  // truth for every state transition.
  async function boardPriority() {
    document.body.innerHTML = shell('board', '', '', '');
    $('#workspace').innerHTML = `<section class="priority-loop"><aside class="priority-left"><div class="loop-label">Horizons</div><div id="horizon-nav"></div><div class="loop-label sources-label">Sources</div><div id="source-list"></div><div class="loop-nav-note">Board decides<br><a href="/runs">Runs executes</a><br><a href="/classic">Classic reviews</a></div></aside><main class="priority-main"><header class="priority-page-title"><div><h1>Board</h1><p>Your priority horizon. Decide what gets your attention now.</p></div><div><button class="nw-button ghost" id="show-all">Filters</button><button class="nw-button" id="add-decision">Add commitment</button></div></header><div class="priority-header"><div><div class="loop-label">Decision queue</div><p id="priority-caption">Loading your priority horizon…</p><p id="priority-cue" class="priority-cue" aria-live="polite"></p></div><label class="priority-sort">Sort: Priority <select id="priority-sort"><option value="pending">Needs approval</option><option value="active">Active work</option><option value="all">All records</option></select></label></div><section id="priority-queue" class="priority-queue"></section><div class="priority-promote">Choose an item above to promote it to Now. Every decision stays local, logged, and reversible.</div></main><aside class="priority-right"><div id="priority-detail"><div class="nw-empty">Loading evidence…</div></div></aside></section>`;
    let state, boardRuns = [], selected, horizon = null;
    const opportunities = () => state?.opportunities || [];
    const bucket = item => {
      if (item.status === 'active' && item.approvalStatus === 'pending') return 'now';
      if (item.status === 'active') return 'next';
      return 'later';
    };
    const selectedItem = () => opportunities().find(item => item.id === selected) || opportunities()[0];
    const historyFor = item => (state?.decisionLog || []).filter(entry => entry.opportunity === item?.id).slice(0, 5);
    const renderDetail = () => {
      const item = selectedItem(); if (!item) return;
      selected = item.id;
      const history = historyFor(item);
      const linkedRuns = boardRuns.filter(run => run.sourceOpportunity === item.id).slice(0, 4);
      const pending = item.approvalStatus === 'pending';
      const source = item.nextProof || 'No source record has been linked yet.';
      $('#priority-detail').innerHTML = `<div class="loop-label">Evidence</div><section class="evidence-sheet"><h2>${esc(item.name)}</h2><div class="priority-state ${pending ? 'pending' : 'ready'}">${pending ? 'High priority · approval needed' : 'Scope is approved'}</div><dl><dt>Proposed by</dt><dd>${esc(item.owner || 'Nova')}</dd><dt>Source</dt><dd>${esc(source)}</dd><dt>Current gate</dt><dd>${esc(item.stage || 'Candidate')}</dd></dl><div class="evidence-summary"><div class="loop-label">Summary</div><p>${esc(item.summary || 'No summary recorded.')}</p><p><b>Next proof:</b> ${esc(item.nextAction || item.nextProof || 'Define the next proof with Nova.')}</p></div><button class="detail-link" id="open-brief">View full proposal</button></section><section class="signal-sheet"><div class="loop-label">Linked local work</div>${linkedRuns.length ? linkedRuns.map(run => `<div><b>${esc(run.status)}</b><a href="/runs">${esc(run.question)}</a></div>`).join('') : '<p class="nw-meta">No revised evidence task is running for this decision.</p>'}</section><section class="signal-sheet"><div class="loop-label">Key signals</div><div><b>Priority horizon</b><span>${esc(bucket(item).toUpperCase())}</span></div><div><b>Approval</b><span>${esc(item.approvalStatus || 'pending')}</span></div><div><b>Status</b><span>${esc(item.status || 'candidate')}</span></div></section><section class="history-sheet"><div class="loop-label">Decision history</div>${history.length ? history.map(entry => `<div><b>${esc(entry.label)}</b><small>${esc(String(entry.at || '').slice(0, 10))}</small></div>`).join('') : '<p class="nw-meta">No local decision has been recorded yet.</p>'}</section>`;
      $('#open-brief').onclick = () => { if (!$('#modal')) modal(`${item.id} — full proposal`); showModal(`${item.id} — full proposal`, `${item.summary || ''}\n\nNext proof:\n${item.nextProof || ''}\n\nNext action:\n${item.nextAction || ''}\n\nPrepared local brief:\n${item.brief || ''}`); };
    };
    const renderQueue = () => {
      const filtered = opportunities().filter(item => horizon === 'all' || bucket(item) === horizon);
      const nowCount = opportunities().filter(item => bucket(item) === 'now').length;
      if (!filtered.some(item => item.id === selected)) selected = filtered[0]?.id || opportunities()[0]?.id;
      $('#priority-caption').textContent = horizon === 'now' ? 'Decide what gets your attention this week.' : horizon === 'next' ? 'Approved work that is ready for follow-through.' : horizon === 'later' ? 'Held or deferred work to revisit intentionally.' : 'Every local venture record, ordered for review.';
      $('#priority-cue').textContent = horizon === 'next' && nowCount === 0 ? `Now is clear · showing ${filtered.length} approved item${filtered.length === 1 ? '' : 's'} ready for follow-through.` : horizon === 'now' ? `${filtered.length} decision${filtered.length === 1 ? '' : 's'} need your approval.` : '';
      $('#priority-queue').innerHTML = filtered.length ? filtered.map(item => {
        const pending = item.approvalStatus === 'pending';
        return `<article class="priority-row ${item.id === selected ? 'selected' : ''}" data-id="${esc(item.id)}"><button class="priority-select" aria-label="View ${esc(item.name)}"><span class="priority-dot ${pending ? 'high' : 'low'}"></span><div><div class="priority-kicker">${pending ? 'Needs your decision' : 'Approved scope'}</div><h2>${esc(item.name)}</h2><small>${esc(item.id)} · ${esc(item.owner || 'Nova')}</small></div></button><div class="priority-why"><div class="loop-label">Why it matters</div><p>${esc(item.nextAction || item.summary || 'Review the evidence before proceeding.')}</p><small>Impact · ${esc(item.stage || 'Candidate')}</small></div><div class="priority-actions">${pending ? '<button class="queue-action approve" data-action="approve">Approve &amp; start</button>' : '<button class="queue-action run" data-action="run">Run brief</button>'}<button class="queue-action change" data-action="change">Request changes</button><button class="queue-action defer" data-action="defer">Defer</button></div></article>`;
      }).join('') : '<div class="nw-empty">Nothing is in this horizon. Choose another horizon or add a commitment.</div>';
      document.querySelectorAll('.priority-row').forEach(row => row.onclick = event => { if (event.target.closest('[data-action]')) return; selected = row.dataset.id; renderQueue(); renderDetail(); });
      document.querySelectorAll('[data-action]').forEach(button => button.onclick = event => { event.stopPropagation(); const item = opportunities().find(row => row.id === button.closest('.priority-row').dataset.id); if (button.dataset.action === 'change') return requestChanges(item); if (button.dataset.action === 'run') return runBrief(item); if (button.dataset.action === 'defer') return decide(item, 'hold'); return decide(item, 'approve', true); });
      renderDetail();
    };
    const renderNav = () => {
      const counts = ['now', 'next', 'later'].map(key => opportunities().filter(item => bucket(item) === key).length);
      $('#horizon-nav').innerHTML = [['now','Now','This week',counts[0]],['next','Next','This quarter',counts[1]],['later','Later','This year+',counts[2]]].map(([key,label,note,count]) => `<button class="horizon-button ${horizon === key ? 'selected' : ''}" data-horizon="${key}"><b>${label}</b><small>${note}</small><span>${count}</span></button>`).join('') + `<button class="horizon-button ${horizon === 'all' ? 'selected' : ''}" data-horizon="all"><b>All</b><small>Every record</small><span>${opportunities().length}</span></button>`;
      $('#source-list').innerHTML = opportunities().slice(0, 6).map(item => `<button class="source-button" data-id="${esc(item.id)}"><span>${esc(item.owner || 'Nova')}</span>${esc(item.name)}</button>`).join('') || '<span class="nw-meta">No local sources yet.</span>';
      document.querySelectorAll('[data-horizon]').forEach(button => button.onclick = () => { horizon = button.dataset.horizon; renderNav(); renderQueue(); });
      document.querySelectorAll('.source-button').forEach(button => button.onclick = () => { selected = button.dataset.id; horizon = 'all'; renderNav(); renderQueue(); });
    };
    const decide = async (item, decision, dispatch) => {
      // Approving here means one thing only: authorise the owner to start.
      // There is no advance action in this view, so approval hands the thesis
      // straight to its specialist instead of leaving a second click owed.
      const ask = dispatch
        ? `Approve this scope and start the ${item.owner || 'owning'} brief for ${item.id} now?`
        : `Record ${decision} for ${item.name}? This only updates your local Board.`;
      if (!confirm(ask)) return;
      try {
        const result = await api('/api/venture/decision', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opportunity: item.id, decision, dispatch: !!dispatch })
        });
        if (result.job) toast(`Approved - started ${result.job.label}`);
        else if (result.dispatchError) toast(result.dispatchError);
        else toast(result.decision);
        await load();
      } catch (error) { toast(error.message); }
    };
    const runBrief = async item => { if (!confirm(`Start the prepared local brief for ${item.id}? No external action will be taken.`)) return; try { await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skill:item.owner || 'ad-hoc',label:`${item.id} — ${item.name}`,prompt:item.brief || item.nextAction || item.summary})}); toast('Brief started. Follow it in Runs.'); } catch (error) { toast(error.message); } };
    const requestChanges = item => { $('#priority-detail').insertAdjacentHTML('afterbegin', `<form class="change-request" id="change-request"><label class="loop-label" for="change-note">Request changes to ${esc(item.name)}</label><textarea id="change-note" placeholder="Tell Nova what evidence, scope, or constraint should change…"></textarea><button class="nw-button">Start revised local task</button></form>`); $('#change-note').focus(); $('#change-request').onsubmit = async event => { event.preventDefault(); const note = $('#change-note').value.trim(); if (!note) return $('#change-note').focus(); try { await api('/api/orchestrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:`[${item.id} — ${item.name}] Refine this decision before approval: ${note}`,sourceOpportunity:item.id,origin:'board-revision'})}); toast('Revised task started and linked to this decision.'); $('#change-request').remove(); await load(); } catch (error) { toast(error.message); } }; };
    $('#add-decision').onclick = openJarvis;
    $('#show-all').onclick = () => { horizon = 'all'; renderNav(); renderQueue(); };
    $('#priority-sort').onchange = event => { horizon = event.target.value === 'all' ? 'all' : event.target.value === 'active' ? 'next' : 'now'; renderNav(); renderQueue(); };
    async function load() { try { const [venture, runs] = await Promise.all([api('/api/venture'), api('/api/orchestrations?limit=60')]); state = venture; boardRuns = runs.orchestrations || []; if (!horizon) horizon = ['now', 'next', 'later', 'all'].find(key => key === 'all' || opportunities().some(item => bucket(item) === key)); selected = selected || opportunities()[0]?.id; renderNav(); renderQueue(); } catch (error) { $('#priority-queue').innerHTML = `<div class="nw-empty">Board unavailable: ${esc(error.message)}</div>`; } }
    await load(); setInterval(load, 30000);
  }

  async function runsFollowThrough() {
    document.body.innerHTML = shell('runs', 'Runs', 'Follow-through for the work launched from Board. Read the local evidence, then return to Board whenever a decision needs you.', '<a class="nw-button" href="/board">Return to Board</a>');
    $('#workspace').innerHTML = `<section class="follow-through"><aside class="follow-queue"><div class="loop-label">Active queue</div><div id="follow-active"></div><div class="loop-label recent-label">Recent completions</div><div id="follow-recent"></div></aside><main class="follow-main"><div class="run-context"><span>Board decides</span><b>→</b><span class="active">Runs executes</span><b>→</b><a href="/classic">Classic reviews</a></div><section class="follow-status"><div><div class="loop-label" id="follow-status-label">Run</div><h1 id="follow-title">Loading local work…</h1><p id="follow-subtitle"></p></div><a class="nw-button ghost" id="follow-decision-link" href="/board">Need a decision?</a></section><ol class="follow-timeline" id="follow-timeline"></ol><section class="follow-transcript"><div class="loop-label">Transcript + evidence</div><pre id="follow-output">Select a run to read the returned local record.</pre></section></main><aside class="follow-evidence"><div class="loop-label">Run evidence</div><div id="follow-evidence"><p class="nw-meta">Select a task to inspect its local evidence and return path.</p></div></aside></section>`;
    let history = [], orchestration = [], selectedKey;
    const sourceItems = () => [...orchestration.map(item => ({...item, key:`or:${item.id}`,kind:'chief',label:item.question,started:item.started,elapsed:0})), ...history.map(item => ({...item,key:`run:${item.id}`,kind:'run'}))];
    const isVentureItem = item => Boolean(item?.sourceOpportunity) || /^OPP-\d+\b/i.test(item?.label || '') || /\b(venture|thesis|pilot|buyer|tariff|insurability|sirs|condominium)\b/i.test(item?.label || '');
    const isUtilityLookup = item => item?.kind === 'chief' && !isVentureItem(item);
    const vaultHref = item => item?.note ? `/vault?q=${encodeURIComponent(String(item.note).split('/').pop())}` : '';
    const stateIndex = item => item.status === 'done' ? 5 : item.status === 'fault' ? 4 : item.status === 'running' ? 3 : 1;
    const view = () => sourceItems().find(item => item.key === selectedKey) || sourceItems().find(item => item.status === 'running' || item.status === 'queued') || sourceItems()[0];
    const draw = () => {
      const rows = sourceItems(), current = view();
      if (!current) { $('#follow-active').innerHTML = '<div class="nw-empty">No local work is running.</div>'; $('#follow-title').textContent = 'Runtime ready'; return; }
      selectedKey = current.key;
      const active = rows.filter(item => item.status === 'running' || item.status === 'queued');
      const finished = rows.filter(item => item.status !== 'running' && item.status !== 'queued').slice(0, 7);
      const renderRow = item => `<button class="follow-row ${item.key === selectedKey ? 'selected' : ''}" data-key="${esc(item.key)}"><span class="nw-pill ${statusClass(item.status)}">${esc(item.status)}</span><b>${esc(item.label)}</b><small>${esc(item.kind === 'chief' ? 'Chief of Staff' : item.skill || 'local run')} · ${esc(shortDate(item.started))}</small></button>`;
      $('#follow-active').innerHTML = active.length ? active.map(renderRow).join('') : '<div class="nw-empty">No live task. Start a bounded brief from Board.</div>';
      $('#follow-recent').innerHTML = finished.length ? finished.map(renderRow).join('') : '<div class="nw-empty">No completed history yet.</div>';
      const utility = isUtilityLookup(current), live = current.status === 'running' || current.status === 'queued', archive = vaultHref(current);
      $('#follow-status-label').textContent = utility ? 'Personal utility lookup' : live ? 'Active run' : current.status === 'done' ? 'Completed run' : 'Run needs attention';
      $('#follow-title').textContent = current.label || 'Local run';
      $('#follow-subtitle').textContent = utility ? 'A personal lookup is kept out of the venture decision pipeline. The detailed response is not repeated here.' : current.sourceOpportunity ? `Board ${current.sourceOpportunity} · revised local evidence task.` : current.kind === 'chief' ? 'Chief of Staff task · local work with a durable review record.' : `${current.skill || 'Local runner'} · ${current.status === 'done' ? 'completed and archived' : 'work in progress'}`;
      const labels = utility ? ['Request','Local lookup','Result','Archive'] : ['Intake','Plan','Research','Build','Verify','Complete'];
      const index = utility ? (current.status === 'done' ? 3 : current.status === 'fault' ? 2 : current.status === 'running' ? 1 : 0) : stateIndex(current);
      $('#follow-timeline').classList.toggle('utility-timeline', utility);
      $('#follow-timeline').innerHTML = labels.map((label, idx) => `<li class="${idx < index ? 'done' : idx === index ? 'active' : ''}"><b>${label}</b><small>${idx < index ? 'recorded' : idx === index ? (current.status === 'done' ? 'archived' : 'current') : 'waiting'}</small></li>`).join('');
      $('#follow-decision-link').hidden = utility;
      $('#follow-evidence').innerHTML = `<div class="evidence-mini"><b>Origin</b><span>${utility ? 'Personal local lookup' : current.sourceOpportunity ? `Board decision ${esc(current.sourceOpportunity)}` : current.label?.match(/^OPP-/) ? 'Launched from Board' : current.kind === 'chief' ? 'Chief of Staff question' : 'Local operator request'}</span></div><div class="evidence-mini"><b>State</b><span>${esc(current.status)}</span></div>${utility ? '<div class="evidence-mini"><b>Decision</b><span>No Board decision is required for this lookup.</span></div>' : `<div class="evidence-mini"><b>Next handoff</b><a href="${current.sourceOpportunity || current.status === 'done' ? '/board' : '/runs'}">${current.sourceOpportunity ? `Return to ${esc(current.sourceOpportunity)} on Board` : current.status === 'done' ? 'Return to Board to decide' : 'Continue monitoring this run'}</a></div>`}${archive ? `<div class="evidence-mini"><b>Archive</b><a href="${archive}">Open archived record in Vault</a></div>` : '<div class="evidence-mini"><b>Archive</b><span>No linked Vault record is available for this run.</span></div>'}`;
      document.querySelectorAll('.follow-row').forEach(button => button.onclick = () => { selectedKey = button.dataset.key; draw(); loadTranscript(view()); });
      loadTranscript(current);
    };
    const loadTranscript = async item => { $('#follow-output').textContent = 'Loading local evidence…'; try { if (isUtilityLookup(item)) { $('#follow-output').textContent = 'This personal lookup is complete. Its detailed response is intentionally not duplicated in the venture run transcript.'; return; } if (item.kind === 'chief') { const stageText = (item.stages || []).map(stage => `${stage.name || 'Stage'} · ${stage.status || 'queued'}\n${stage.result || ''}`).join('\n\n'); $('#follow-output').textContent = stageText || item.error || 'The task is queued for local intake.'; } else if (item.live) { const result = await api(`/api/job/${encodeURIComponent(item.id)}?offset=0`); $('#follow-output').textContent = result.chunk || 'The run started; no output has been returned yet.'; } else $('#follow-output').textContent = item.note ? 'This archived run is available through the linked Vault record.' : 'This completion predates the accessible transcript archive.'; } catch (error) { $('#follow-output').textContent = error.message; } };
    async function load() { try { const [past, chief] = await Promise.all([api('/api/history?limit=60'), api('/api/orchestrations?limit=30')]); history = past.runs || []; orchestration = chief.orchestrations || []; selectedKey = selectedKey || sourceItems().find(item => item.status === 'running' || item.status === 'queued')?.key || sourceItems()[0]?.key; draw(); } catch (error) { $('#follow-output').textContent = `Run history unavailable: ${error.message}`; } }
    await load(); setInterval(load, 7000);
  }

  async function classicReview() {
    document.body.innerHTML = shell('classic', 'Classic', 'A quiet daily and weekly review: what completed, what you decided, what still needs approval, and the one focus worth carrying forward.', '');
    $('#workspace').innerHTML = `<section class="review-loop"><div class="review-path"><a href="/board">Board decides</a><span>→</span><a href="/runs">Runs executes</a><span>→</span><b>Classic reviews</b></div><header class="review-hero"><div><div class="loop-label">Founder review</div><h2 id="review-focus">Loading your next focus…</h2><p id="review-copy"></p></div><div class="review-actions"><a class="nw-button" href="/board">Open Board</a><a class="nw-button ghost" href="/runs">Inspect Runs</a></div></header><div class="review-grid"><section><div class="loop-label">Completed work</div><div id="review-completed" class="review-list"></div></section><section><div class="loop-label">Decisions made</div><div id="review-decisions" class="review-list"></div></section><section><div class="loop-label">Open approvals</div><div id="review-approvals" class="review-list"></div></section></div><section class="review-next"><div><div class="loop-label">Next recommended focus</div><h3 id="review-next-title"></h3><p id="review-next-copy"></p></div><a href="/board" class="nw-button">Review decision</a></section></section>`;
    try {
      const [venture, past, chief] = await Promise.all([api('/api/venture'), api('/api/history?limit=60'), api('/api/orchestrations?limit=30')]);
      const opportunities = venture.opportunities || [], approvals = opportunities.filter(item => item.status === 'active' && item.approvalStatus === 'pending'), done = [...(chief.orchestrations || []).filter(item => item.status === 'done').map(item => ({label:item.question, meta:'Chief of Staff · local review ready'})), ...(past.runs || []).filter(item => item.status === 'done').map(item => ({label:item.label, meta:`${item.skill || 'Local run'} · ${shortDate(item.started)}`}))].slice(0, 5);
      const next = approvals[0] || opportunities.find(item => item.status === 'active') || opportunities[0];
      $('#review-focus').textContent = next ? next.name : 'Your local venture records are caught up.';
      $('#review-copy').textContent = next ? `The clearest next move is to review ${next.id} before asking the system to do more work.` : 'Use Board to create the next bounded commitment.';
      $('#review-next-title').textContent = next ? `${next.id} — ${next.name}` : 'Create the next commitment';
      $('#review-next-copy').textContent = next ? (next.nextAction || next.nextProof || next.summary || 'Review the available evidence.') : 'Open Board when a new project deserves a bounded decision.';
      $('#review-completed').innerHTML = done.length ? done.map(item => `<article><b>${esc(item.label)}</b><small>${esc(item.meta)}</small><a href="/runs">Read run</a></article>`).join('') : '<p class="nw-meta">No local work has completed yet.</p>';
      $('#review-decisions').innerHTML = (venture.decisionLog || []).slice(0,5).map(entry => `<article><b>${esc(entry.label)}</b><small>${esc(String(entry.at || '').slice(0, 10))} · ${esc(entry.opportunity || 'local record')}</small><a href="/board">Open Board</a></article>`).join('') || '<p class="nw-meta">No founder decisions have been logged yet.</p>';
      $('#review-approvals').innerHTML = approvals.length ? approvals.map(item => `<article><b>${esc(item.name)}</b><small>${esc(item.nextProof || item.nextAction || 'Evidence review required')}</small><a href="/board">Review</a></article>`).join('') : '<p class="nw-meta">No approval is currently waiting.</p>';
    } catch (error) { $('#review-copy').textContent = `Classic review unavailable: ${error.message}`; }
  }
  async function agentsReference() {
    document.body.innerHTML = shell('agents', '', '');
    $('#workspace').innerHTML = `<section class="agents-reference"><aside class="reference-left"><div class="reference-label">Agent groups <button id="group-add">+</button></div><div id="agent-groups"></div><div class="reference-governance"><b>Governance</b><p>Local research and synthesis may run. External actions always require your approval.</p></div></aside><main class="agent-thread"><h1>Agents</h1><form class="ask-composer" id="chief-form"><textarea id="chief-question" aria-label="Ask Nova" placeholder="Ask Nova anything…"></textarea><button type="button" class="composer-tune" id="composer-tune">Scope</button><button class="nw-button" type="submit">Ask Nova</button></form><div class="reference-label today">Today</div><section id="work-feed" class="work-feed"></section></main><aside class="task-rail"><div id="task-rail"></div></aside></section>`;
    let registry, orch, activeGroup = 'All agents', selectedTask = null;
    try { [registry, orch] = await Promise.all([api('/api/agents'), api('/api/orchestrations?limit=30')]); }
    catch (error) { $('#work-feed').innerHTML = `<div class="nw-empty">Nova is unavailable: ${esc(error.message)}</div>`; return; }
    const task = () => selectedTask || orch.orchestrations.find(item => item.status === 'running' || item.status === 'queued') || orch.orchestrations[0];
    const result = (item, index) => item?.stages?.[index]?.result || '';
    const latest = item => [...(item?.stages || [])].reverse().find(stage => stage.result)?.result || item?.error || '';
    const excerpt = (text, length = 560) => text ? `${text.slice(0, length)}${text.length > length ? '…' : ''}` : 'Waiting for this stage to return.';
    const redraw = () => { drawGroups(); drawFeed(); drawRail(); };
    const drawGroups = () => {
      const groups = ['All agents', ...Array.from(new Set(registry.agents.map(agent => agent.group || 'General'))).slice(0, 5)];
      $('#agent-groups').innerHTML = groups.map(group => { const count = group === 'All agents' ? registry.agents.length : registry.agents.filter(agent => agent.group === group).length; return `<button class="agent-group ${group === activeGroup ? 'selected' : ''}" data-group="${esc(group)}"><b>${esc(group)}</b><span>${count}</span></button>`; }).join('');
      document.querySelectorAll('.agent-group').forEach(button => button.onclick = () => { activeGroup = button.dataset.group; redraw(); });
      $('#group-add').onclick = () => toast('Agent groups are derived from the installed local skill registry.');
    };
    const drawFeed = () => {
      const item = task();
      if (!item) { $('#work-feed').innerHTML = `<article class="feed-event user"><span class="feed-avatar">You</span><div><div class="event-meta">New task</div><p>Ask Nova a specific question to create a transparent work thread.</p></div></article><article class="feed-event nova"><span class="feed-avatar">Nova</span><div><div class="event-meta">Ready</div><p>The Chief of Staff will plan, research, verify, and return a decision task. Nothing external will happen without you.</p></div></article>`; return; }
      const review = item.review || {}, done = item.status === 'done', final = latest(item);
      $('#work-feed').innerHTML = `<article class="feed-event user"><span class="feed-avatar">You</span><div><div class="event-meta">${esc(shortDate(item.started))}</div><p>${esc(item.question)}</p></div></article><article class="feed-event nova"><span class="feed-avatar">Nova</span><div><div class="event-meta">Chief of Staff · plan</div><p>${esc(excerpt(result(item, 0), 390))}</p><button class="event-disclosure" data-stage="0">Plan · ${esc(item.stages?.[0]?.status || 'queued')}</button></div></article><article class="feed-event evidence"><span class="feed-avatar">Evidence</span><div><div class="event-meta">Research + diligence</div><p>${esc(excerpt(`${result(item, 1)}\n${result(item, 2)}`, 520))}</p><button class="event-disclosure" data-stage="evidence">Evidence · ${(item.memory || []).length} linked records</button></div></article><article class="feed-event approval"><span class="feed-avatar">Review</span><div><div class="event-meta">${done ? 'Awaiting your approval' : 'Working locally'}</div><p>${esc(done ? excerpt(final, 620) : 'The Chief is completing the bounded local run. Your decision will appear here after verification.')}</p>${done && review.status !== 'approved' && review.status !== 'rescope_requested' ? `<div class="feed-actions"><button class="nw-button" id="approve-task">Approve</button><button class="nw-button ghost" id="change-scope">Request changes</button></div><div class="scope-editor" id="scope-editor" hidden><label class="reference-label">Change agent scope</label><textarea id="scope-input" placeholder="Tell Nova what to focus on, verify, or exclude…"></textarea><button class="nw-button" id="submit-scope">Start revised task</button></div>` : `<span class="nw-pill ${statusClass(review.status || item.status)}">${esc(review.status === 'approved' ? 'approved locally' : review.status === 'rescope_requested' ? 're-scoped task running' : item.status)}</span>`}</div></article>${done ? `<article class="feed-event delivery"><span class="feed-avatar">Done</span><div><div class="event-meta">Delivery</div><p>${esc(review.status === 'approved' ? 'The recommendation is approved for your manual follow-through.' : 'Review the complete delivery, then approve it or redirect the next task.')}</p><button class="event-disclosure" data-stage="final">Read full delivery</button></div></article>` : ''}`;
      document.querySelectorAll('.event-disclosure').forEach(button => button.onclick = () => { const body = button.dataset.stage === '0' ? result(item, 0) : button.dataset.stage === 'evidence' ? `${result(item, 1)}\n\n${result(item, 2)}` : final; button.insertAdjacentHTML('afterend', `<pre class="feed-expanded">${esc(body || 'No returned text yet.')}</pre>`); button.disabled = true; });
      $('#approve-task')?.addEventListener('click', async () => { try { await api(`/api/orchestrations/${encodeURIComponent(item.id)}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'approve'})}); toast('Approved locally; external follow-through remains yours.'); await refresh(); } catch (error) { toast(error.message); } });
      $('#change-scope')?.addEventListener('click', () => { $('#scope-editor').hidden = false; $('#scope-input').focus(); });
      $('#submit-scope')?.addEventListener('click', async () => { const scope = $('#scope-input').value.trim(); if (!scope) return $('#scope-input').focus(); try { await api(`/api/orchestrations/${encodeURIComponent(item.id)}/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'rescope',scope})}); toast('A revised task is running in the background.'); await refresh(); } catch (error) { toast(error.message); } });
    };
    const drawRail = () => {
      const item = task(), stages = item?.stages || [], complete = stages.filter(stage => stage.status === 'done').length, current = stages.find(stage => stage.status === 'running')?.name || (item?.status === 'done' ? 'Delivery ready' : item?.status || 'Ready'); const pool = activeGroup === 'All agents' ? registry.agents : registry.agents.filter(agent => agent.group === activeGroup);
      $('#task-rail').innerHTML = `<div class="reference-label">Task ${item ? `· ${esc(item.id)}` : ''}</div><section class="task-status"><div class="task-percent">${item ? Math.round(complete / Math.max(stages.length,1) * 100) : 0}%</div><div><b>${esc(item?.status === 'done' ? 'In review' : item?.status === 'running' ? 'In progress' : 'Ready')}</b><small>${esc(current)}</small></div></section><section class="rail-section"><div class="reference-label">Next decision</div><b>${esc(!item ? 'Ask Nova a question' : item.status !== 'done' ? 'Wait for verification' : item.review?.status === 'approved' ? 'Manual follow-through' : 'Approve or request changes')}</b><p>${esc(!item ? 'Nova will create a bounded task thread.' : 'You retain control over recommendations and every external action.')}</p></section><section class="rail-section"><div class="reference-label">Agents involved</div>${pool.slice(0,4).map(agent => `<button class="rail-agent" data-skill="${esc(agent.skill)}"><span class="inventory-dot ${agent.hasFile ? 'ready' : ''}"></span><b>${esc(agent.label)}</b><small>${esc(agent.group)} · ${agent.runs} runs</small></button>`).join('')}</section>`;
      document.querySelectorAll('.rail-agent').forEach(button => button.onclick = async () => { const agent = registry.agents.find(row => row.skill === button.dataset.skill); try { await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({skill:agent.skill,label:agent.label,prompt:agent.prompt})}); toast(`${agent.label} started locally; inspect it in Runs.`); } catch (error) { toast(error.message); } });
    };
    const refresh = async () => { orch = await api('/api/orchestrations?limit=30'); if (selectedTask) selectedTask = orch.orchestrations.find(item => item.id === selectedTask.id) || selectedTask; redraw(); };
    $('#chief-form').onsubmit = async event => { event.preventDefault(); const question = $('#chief-question').value.trim(); if (!question) return $('#chief-question').focus(); const submit = $('#chief-form button[type="submit"]'); submit.disabled = true; try { selectedTask = await api('/api/orchestrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question})}); $('#chief-question').value = ''; redraw(); toast('Nova is planning the local task.'); const poll = async () => { await refresh(); if (selectedTask.status === 'queued' || selectedTask.status === 'running') return setTimeout(poll, 1200); submit.disabled = false; }; poll(); } catch (error) { submit.disabled = false; toast(error.message); } };
    $('#composer-tune').onclick = () => { $('#chief-question').placeholder = 'Include the project, desired result, constraints, and what evidence would change your mind…'; $('#chief-question').focus(); };
    redraw();
  }

  const pathname = location.pathname;
  if (pathname === '/agents' || pathname === '/console' || pathname === '/console.html') agentsReference();
  else if (pathname === '/vault' || pathname === '/vault.html') vault();
  else if (pathname === '/runs' || pathname === '/runs.html') runsFollowThrough();
  else if (pathname === '/classic' || pathname === '/classic.html') classicReview();
  else if (pathname === '/board' || pathname === '/venture' || pathname === '/venture.html') boardPriority();
})();
