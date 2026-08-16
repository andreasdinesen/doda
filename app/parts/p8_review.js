'use strict';
/* doda - Waiting For, Someday, Logbook, den ugentlige gennemgang og
   fokustilstand med timer. */

/* ------------------------------------------------- Waiting For / Someday */

async function sideStatusliste(status, titel) {
  const host = document.getElementById('pageHost');
  const d = await api('GET', `/api/v1/items?status=${status}`);
  state.items = d.items;

  if (!d.items.length) {
    host.innerHTML = `<section class="page">
      <div class="page-head"><h1>${esc(titel)}</h1><p class="lead">${esc(BESKRIVELSER[state.view])}</p></div>
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">${status === 'waiting' ? 'Nobody owes you anything' : 'Nothing parked'}</p>
        <p>${status === 'waiting'
    ? 'Press <strong>w</strong> on a task to move it here when you have handed it off.'
    : 'Press <strong>s</strong> on a task to park it without any commitment.'}</p></div>
    </section>`;
    return;
  }

  host.innerHTML = `<section class="page">
    <div class="page-head"><h1>${esc(titel)}</h1><p class="lead">${esc(BESKRIVELSER[state.view])}</p></div>
    <div class="list" data-keynav>${d.items.map((it, i) => {
    const raekke = elementRaekke(it, i);
    if (status !== 'waiting') return raekke;
    // "Venter pa" giver kun mening, hvis man kan se HVEM (handover §4).
    return raekke.replace('</div>\n  </div>', `</div>
      <input class="waitwho" data-who="${esc(it.id)}" value="${esc(it.waiting_for || '')}"
        placeholder="Who?" aria-label="Waiting on whom">
  </div>`);
  }).join('')}</div>
    <p class="hintline meta">↑↓ move · enter open · n back to next · space done</p>
  </section>`;
  bindListe();

  document.querySelectorAll('.waitwho[data-who]').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('change', async () => {
      await api('POST', `/api/v1/items/${el.dataset.who}`, { waiting_for: el.value });
      toast('Saved');
    });
  });
}

/* --------------------------------------------------------------- logbog */

async function sideLog() {
  const host = document.getElementById('pageHost');
  const q = state.logProject ? `?project=${encodeURIComponent(state.logProject)}` : '';
  const d = await api('GET', `/api/v1/logbook${q}`);

  const filtre = state.projects.map((p) =>
    `<button class="pill${state.logProject === p.id ? ' on' : ''}" data-logp="${esc(p.id)}">${esc(p.name)}</button>`).join('');

  if (!d.items.length) {
    host.innerHTML = `<section class="page">
      <div class="page-head"><h1>Logbook</h1><p class="lead">${esc(BESKRIVELSER.log)}</p></div>
      ${state.projects.length ? `<div class="pills"><button class="pill${state.logProject ? '' : ' on'}" data-logp="">All</button>${filtre}</div>` : ''}
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">Nothing finished yet</p><p>It shows up here as you go.</p></div>
    </section>`;
    bindLog();
    return;
  }

  // Grupperet pr. dag. Ingen tal, ingen grafer, ingen score - se §10.
  const dage = new Map();
  for (const it of d.items) {
    const dag = new Date(it.completed_at * 1000).toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long' });
    if (!dage.has(dag)) dage.set(dag, []);
    dage.get(dag).push(it);
  }

  host.innerHTML = `<section class="page">
    <div class="page-head"><h1>Logbook</h1><p class="lead">${esc(BESKRIVELSER.log)}</p></div>
    ${state.projects.length ? `<div class="pills"><button class="pill${state.logProject ? '' : ' on'}" data-logp="">All</button>${filtre}</div>` : ''}
    ${[...dage.entries()].map(([dag, liste]) => `
      <h2 class="group meta">${esc(dag)}</h2>
      <div class="list">${liste.map(logRaekke).join('')}</div>`).join('')}
  </section>`;
  bindLog();
}

function logRaekke(it) {
  const projekt = it.project_id ? (state.projects.find((p) => p.id === it.project_id) || {}).name : null;
  const meta = [];
  if (projekt) meta.push(esc(projekt));
  if (it.status === 'dropped') meta.push('dropped');
  if (it.contexts.length) meta.push(it.contexts.map((c) => `#${esc(c.name)}`).join(' '));
  return `<div class="item-row log-row${it.status === 'dropped' ? ' dim' : ''}">
    <span class="logtick">${it.status === 'dropped' ? '·' : '✓'}</span>
    <div class="item-main">
      <div class="item-title">${linkify(it.title)}</div>
      ${meta.length ? `<div class="item-meta meta">${meta.join(' · ')}</div>` : ''}
    </div>
  </div>`;
}

function bindLog() {
  document.querySelectorAll('[data-logp]').forEach((el) => {
    el.addEventListener('click', () => { state.logProject = el.dataset.logp || null; tegnSide(); });
  });
}

/* ------------------------------------------------- ugentlig gennemgang */

const TRIN = [
  { t: 'Empty the inbox', n: 'Clarify everything that is still unprocessed.' },
  { t: 'Review active projects', n: 'Does every project have a next action?' },
  { t: 'Review Waiting For', n: 'Is there anything you should chase?' },
  { t: 'Review Someday', n: 'Has anything become relevant?' },
  { t: 'Review skipped repeats', n: 'A habit that keeps getting skipped is telling you something.' },
  { t: 'Look at the week', n: 'What you got done.' },
];

async function sideReview() {
  const host = document.getElementById('pageHost');
  const d = await api('GET', '/api/v1/review');
  state.review = d;

  if (!d.step) {
    const dage = ['Never', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    host.innerHTML = `<section class="page">
      <div class="page-head"><h1>Review</h1><p class="lead">${esc(BESKRIVELSER.review)}</p></div>
      <div class="card">
        <h2>Six steps, whenever it suits you</h2>
        <ol class="reviewlist">${TRIN.map((t) => `<li><strong>${esc(t.t)}</strong> — ${esc(t.n)}</li>`).join('')}</ol>
        <p class="gate-note" style="text-align:left">You can stop halfway and pick up
        from the same step later — even on another device.</p>
        <button class="btn primary" id="revStart" style="margin-top:6px">Start the review</button>
        ${d.lastDone ? `<p class="lead" style="margin-top:14px">Last completed ${esc(visTid(d.lastDone))}.</p>` : ''}
      </div>
      <div class="card">
        <h2>Reminder</h2>
        <p class="lead" style="margin:6px 0 12px">A quiet nudge on the day you choose.
        Nothing else in doda will ever notify you.</p>
        <select class="input" id="revDay" style="max-width:240px">
          ${dage.map((n, i) => `<option value="${i}"${i === d.weekday ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
    </section>`;
    document.getElementById('revStart').addEventListener('click', async () => {
      await api('POST', '/api/v1/review', { action: 'start' });
      tegnSide();
    });
    document.getElementById('revDay').addEventListener('change', async (e) => {
      await api('POST', '/api/v1/settings', { settings: { review_weekday: e.target.value } });
      toast(e.target.value === '0' ? 'Reminder off' : 'Reminder set');
    });
    return;
  }

  const i = d.step - 1;
  host.innerHTML = `<section class="page">
    <div class="page-head">
      <div class="meta">Step ${d.step} of ${TRIN.length}</div>
      <h1>${esc(TRIN[i].t)}</h1>
      <p class="lead">${esc(TRIN[i].n)}</p>
      <div class="progress"><span style="width:${(d.step / TRIN.length) * 100}%"></span></div>
    </div>
    <div class="card">${reviewTrin(i, d)}</div>
    <div class="reviewnav">
      <button class="btn ghost" id="revQuit">Continue later</button>
      <span style="flex:1"></span>
      ${d.step > 1 ? '<button class="btn" id="revBack">Back</button>' : ''}
      <button class="btn primary" id="revNext">${d.step === TRIN.length ? 'Finish' : 'Next step'}</button>
    </div>
  </section>`;

  const gaa = async (trin) => { await api('POST', '/api/v1/review', { step: trin }); tegnSide(); };
  document.getElementById('revQuit').addEventListener('click', async () => {
    // "Fortsaet senere" beholder trinnet - kun "Finish" nulstiller det.
    gaaTil('next');
    toast('Paused — pick it up from the same step whenever');
  });
  if (d.step > 1) document.getElementById('revBack').addEventListener('click', () => gaa(d.step - 1));
  document.getElementById('revNext').addEventListener('click', async () => {
    if (d.step < TRIN.length) { gaa(d.step + 1); return; }
    await api('POST', '/api/v1/review', { action: 'finish' });
    await genindlaes();
    gaaTil('next');
    toast('Review done. Everything is where you left it.');
  });

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.goto));
  });
}

function reviewTrin(i, d) {
  const tom = (t) => `<p class="lead">${t}</p>`;
  const liste = (items, hvad) => (items.length
    ? `<div class="list">${items.slice(0, 40).map((x) => `<div class="item-row">
        <span class="proj-dot"></span><div class="item-main">
        <div class="item-title">${linkify(x.title)}</div>
        ${x.waiting_for ? `<div class="item-meta meta">waiting on ${esc(x.waiting_for)}</div>` : ''}</div></div>`).join('')}</div>`
    : tom(hvad));

  if (i === 0) {
    return d.inbox.length
      ? `<p class="lead" style="margin-bottom:12px">${d.inbox.length} item${d.inbox.length === 1 ? '' : 's'} left.</p>
         ${liste(d.inbox, '')}
         <button class="btn" data-goto="inbox" style="margin-top:14px">Go to the inbox</button>`
      : tom('Inbox is empty. Nothing to clarify.');
  }
  if (i === 1) {
    return d.stalled.length
      ? `<p class="lead" style="margin-bottom:12px">${d.stalled.length} project${d.stalled.length === 1 ? ' has' : 's have'} open work but no next action:</p>
         <div class="list">${d.stalled.map((p) => `<div class="item-row">
           <span class="proj-dot"></span><div class="item-main"><div class="item-title">${esc(p.name)}</div>
           <div class="item-meta meta">${p.open_count} open</div></div></div>`).join('')}</div>
         <button class="btn" data-goto="projects" style="margin-top:14px">Go to projects</button>`
      : tom(`All ${d.projects.length} active projects have a next action. That is the whole point.`);
  }
  if (i === 2) return liste(d.waiting, 'You are not waiting on anyone.');
  if (i === 3) return liste(d.someday, 'Nothing parked.');
  if (i === 4) {
    return d.skipped.length
      ? `<div class="list">${d.skipped.map((r) => `<div class="item-row">
          <span class="rep-icon ${r.mode === 'completion' ? 'completion' : 'schedule'}">${icon('repeat', 16)}</span>
          <div class="item-main"><div class="item-title">${esc(r.title)}</div>
          <div class="item-meta meta">${esc(r.description)}</div></div>
          <span class="skipcount">${r.skips} skipped</span></div>`).join('')}</div>
         <button class="btn" data-goto="repeat" style="margin-top:14px">Go to recurring</button>`
      : tom('Nothing has been skipped. Your habits are holding.');
  }
  return d.done.length
    ? `<p class="lead" style="margin-bottom:12px">${d.done.length} thing${d.done.length === 1 ? '' : 's'} finished this week.</p>
       ${liste(d.done, '')}`
    : tom('A quiet week. That is allowed too.');
}

/* ------------------------------------------------------- fokustilstand */

/* Timeren skal blive ved med at taelle, selv om man skifter skaerm
   (handover §5.3). Derfor gemmes STARTTIDSPUNKTET, ikke en tael-vaerdi -
   sa er den rigtig, uanset hvad der er sket imellemtiden. */
const fokus = { itemId: null, start: 0, timer: null };

function startFokus(it) {
  fokus.itemId = it.id;
  fokus.start = Date.now();
  // Titlen skal HOLDES her. state.items indeholder kun den aktuelle skaerms
  // elementer, saa saa snart man navigerer vaek, kan den ikke slaas op.
  fokus.titel = it.title;
  try {
    localStorage.setItem('doda_focus', JSON.stringify({ id: it.id, start: fokus.start, title: it.title }));
  } catch { /* privat tilstand */ }
  tegnFokus();
}

function stopFokus() {
  fokus.itemId = null;
  clearInterval(fokus.timer);
  fokus.timer = null;
  try { localStorage.removeItem('doda_focus'); } catch { /* ligegyldigt */ }
  const el = document.getElementById('focusBar');
  if (el) el.remove();
}

function gendanFokus() {
  try {
    const g = JSON.parse(localStorage.getItem('doda_focus') || 'null');
    if (!g) return;
    fokus.itemId = g.id;
    fokus.start = g.start;
    fokus.titel = g.title;
    tegnFokus();
  } catch { /* ligegyldigt */ }
}

function tegnFokus() {
  let el = document.getElementById('focusBar');
  if (!fokus.itemId) return;
  if (!el) {
    el = document.createElement('div');
    el.className = 'focusbar';
    el.id = 'focusBar';
    document.body.appendChild(el);
  }
  const tegn = () => {
    const sek = Math.floor((Date.now() - fokus.start) / 1000);
    const m = String(Math.floor(sek / 60)).padStart(2, '0');
    const s = String(sek % 60).padStart(2, '0');
    const t = fokus.titel || (state.items.find((x) => x.id === fokus.itemId) || {}).title || 'Focus';
    el.innerHTML = `<span class="focustime">${Math.floor(sek / 3600) ? `${Math.floor(sek / 3600)}:` : ''}${m}:${s}</span>
      <span class="focustitle">${esc(t)}</span>
      <button class="btn ghost" id="focusDone">Done</button>
      <button class="btn ghost" id="focusStop">Stop</button>`;
    el.querySelector('#focusStop').addEventListener('click', stopFokus);
    el.querySelector('#focusDone').addEventListener('click', async () => {
      const id = fokus.itemId;
      stopFokus();
      await fuldfoer(id);
    });
  };
  tegn();
  clearInterval(fokus.timer);
  // Ét sekund er rigeligt: timeren regner fra starttidspunktet, sa den kan
  // ikke drive, selv om fanen har vaeret i baggrunden.
  fokus.timer = setInterval(tegn, 1000);
}
