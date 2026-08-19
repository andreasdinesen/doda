'use strict';
/* doda - Waiting For, Someday, Logbook, den ugentlige gennemgang og
   fokustilstand med timer. */

/* ------------------------------------------------- Waiting For / Someday */

async function sideStatusliste(status, titel) {
  const d = await api('GET', `/api/v1/items?status=${status}`);
  state.items = d.items;
  tegnStatusliste(status, titel);
}

/* Tegner listen af state ALENE - saa den kan tegnes om uden at spoerge
   serveren, naar en raekke flyttes eller en ny fanges (p3_lists §straksVaek). */
function tegnStatusliste(status, titel) {
  const host = document.getElementById('pageHost');
  const d = { items: state.items };

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
    <p class="hintline meta">↑↓ select · enter open · n back to next · space done · esc leave</p>
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
  { id: 'inbox', t: 'Empty the inbox', n: 'Clarify everything that is still unprocessed.' },
  { id: 'projects', t: 'Review active projects', n: 'Does every project have a next action?' },
  { id: 'waiting', t: 'Review Waiting For', n: 'Is there anything you should chase?' },
  { id: 'someday', t: 'Review Someday', n: 'Has anything become relevant?' },
  { id: 'skipped', t: 'Review skipped repeats', n: 'A habit that keeps getting skipped is telling you something.' },
  { id: 'week', t: 'Look at the week', n: 'What you got done.' },
  { id: 'focus', t: 'Pick this week\u2019s projects', n: 'The few you actually intend to move. The rest keep running without you.' },
];

/*
 * Tre maader at gaa igennem paa - efter tingdo.
 *
 * Forskellen er UDELUKKENDE hvilke trin man moeder, og i hvilken orden.
 * Ét sted at aendre, og ingen "hvis speed"-forgreninger nede i trinnene.
 */
const MAADER = {
  speed: {
    navn: 'Speed Review',
    om: 'Inbox and next actions. Nothing else.',
    trin: ['inbox', 'projects'],
  },
  simple: {
    navn: 'Simple Review',
    om: 'Every list, one by one. Confirm a whole list at once when nothing has changed.',
    trin: ['inbox', 'projects', 'waiting', 'someday', 'skipped', 'week'],
  },
  focused: {
    navn: 'Focused Review',
    om: 'Pick the projects you will focus on this week, then walk through every list.',
    trin: ['focus', 'inbox', 'projects', 'waiting', 'someday', 'skipped', 'week'],
  },
};

const trinListe = (mode) => (MAADER[mode] || MAADER.simple).trin.map((id) => TRIN.find((x) => x.id === id));

async function sideReview() {
  const host = document.getElementById('pageHost');
  const d = await api('GET', '/api/v1/review');
  state.review = d;

  if (!d.step) {
    const dage = ['Never', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const u = d.week || { captured: 0, completed: 0, processed: 0 };
    host.innerHTML = `<section class="page">
      <div class="page-head"><h1>Review</h1><p class="lead">${esc(BESKRIVELSER.review)}</p></div>

      <blockquote class="reviewintro">
        <strong>The weekly review is how you stay on top of everything.</strong>
        You clear the inbox, check in on your projects, revisit Someday, and confirm
        nothing is slipping through the cracks. It usually takes 15 to 30 minutes.
      </blockquote>

      <div class="page-head" style="margin:32px 0 18px">
        <h1>Hi ${esc(state.user.username)}.</h1>
        <p class="lead">A quick look at your week before you start.</p>
      </div>

      <!-- Fakta til samtalen, ikke en score: ingen streaks, ingen grafer,
           ingen sammenligning med sidste uge (DESIGN.md §7). -->
      <div class="weekstats">
        <div><span>Captured</span><b>${u.captured}</b></div>
        <div><span>Completed</span><b>${u.completed}</b></div>
        <div><span>Captured and clarified</span><b>${u.processed}</b></div>
      </div>

      <p class="lead" style="margin:30px 0 12px">How would you like to review?</p>
      <div class="modelist">
        ${Object.entries(MAADER).map(([id, m]) => `
          <button class="modecard" data-mode="${id}">
            <strong>${esc(m.navn)}</strong>
            <span class="lead">${esc(m.om)}</span>
            <span class="meta">${(MAADER[id].trin.length)} step${MAADER[id].trin.length === 1 ? '' : 's'}</span>
          </button>`).join('')}
      </div>
      <div class="card" style="margin-top:18px">
        <p class="gate-note" style="text-align:left;margin:0">You can stop halfway and pick
        up from the same step later — even on another device.
        ${d.lastDone ? `Last completed ${esc(visTid(d.lastDone))}.` : ''}</p>
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
    document.querySelectorAll('[data-mode]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('POST', '/api/v1/review', { action: 'start', mode: el.dataset.mode });
        tegnSide();
      });
    });
    document.getElementById('revDay').addEventListener('change', async (e) => {
      await api('POST', '/api/v1/settings', { settings: { review_weekday: e.target.value } });
      toast(e.target.value === '0' ? 'Reminder off' : 'Reminder set');
    });
    return;
  }

  // Trinnene kommer fra den valgte maade - ikke fra den faste liste.
  const trin = trinListe(d.mode);
  const i = Math.min(d.step, trin.length) - 1;
  const nu = trin[i];
  host.innerHTML = `<section class="page">
    <div class="page-head">
      <div class="meta">${esc((MAADER[d.mode] || MAADER.simple).navn)} ·
        Step ${d.step} of ${trin.length}</div>
      <h1>${esc(nu.t)}</h1>
      <p class="lead">${esc(nu.n)}</p>
      <div class="progress"><span style="width:${(d.step / trin.length) * 100}%"></span></div>
    </div>
    <div class="card">${reviewTrin(nu.id, d)}</div>
    <div class="reviewnav">
      <button class="btn ghost" id="revQuit">Continue later</button>
      <span style="flex:1"></span>
      ${d.step > 1 ? '<button class="btn" id="revBack">Back</button>' : ''}
      <button class="btn primary" id="revNext">${d.step === trin.length ? 'Finish' : 'Next step'}</button>
    </div>
  </section>`;

  const gaa = async (t) => { await api('POST', '/api/v1/review', { step: t }); tegnSide(); };

  // Ugens projekter gemmes med det samme, ikke ved "Next" - saa er et
  // "Continue later" midt i trinnet ikke spildt.
  document.querySelectorAll('[data-focus]').forEach((el) => {
    el.addEventListener('change', async () => {
      const valgt = [...document.querySelectorAll('[data-focus]')]
        .filter((x) => x.checked).map((x) => x.dataset.focus);
      d.focus = valgt;
      await api('POST', '/api/v1/review', { action: 'focus', focus: valgt });
    });
  });
  document.getElementById('revQuit').addEventListener('click', async () => {
    // "Fortsaet senere" beholder trinnet - kun "Finish" nulstiller det.
    gaaTil('next');
    toast('Paused — pick it up from the same step whenever');
  });
  if (d.step > 1) document.getElementById('revBack').addEventListener('click', () => gaa(d.step - 1));
  document.getElementById('revNext').addEventListener('click', async () => {
    if (d.step < trin.length) { gaa(d.step + 1); return; }
    await api('POST', '/api/v1/review', { action: 'finish' });
    await genindlaes();
    gaaTil('next');
    toast('Review done. Everything is where you left it.');
  });

  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.goto));
  });
}

/** Indholdet af ét trin. Slaar op paa trinnets ID, ikke paa dets nummer -
    ellers ville en ny maade flytte alle grenene. */
function reviewTrin(id, d) {
  const tom = (t) => `<p class="lead">${t}</p>`;
  const liste = (items, hvad) => (items.length
    ? `<div class="list">${items.slice(0, 40).map((x) => `<div class="item-row">
        <span class="proj-dot"></span><div class="item-main">
        <div class="item-title">${linkify(x.title)}</div>
        ${x.waiting_for ? `<div class="item-meta meta">waiting on ${esc(x.waiting_for)}</div>` : ''}</div></div>`).join('')}</div>`
    : tom(hvad));

  if (id === 'inbox') {
    return d.inbox.length
      ? `<p class="lead" style="margin-bottom:12px">${d.inbox.length} item${d.inbox.length === 1 ? '' : 's'} left.</p>
         ${liste(d.inbox, '')}
         <button class="btn" data-goto="inbox" style="margin-top:14px">Go to the inbox</button>`
      : tom('Inbox is empty. Nothing to clarify.');
  }
  if (id === 'projects') {
    return d.stalled.length
      ? `<p class="lead" style="margin-bottom:12px">${d.stalled.length} project${d.stalled.length === 1 ? ' has' : 's have'} open work but no next action:</p>
         <div class="list">${d.stalled.map((p) => `<div class="item-row">
           <span class="proj-dot"></span><div class="item-main"><div class="item-title">${esc(p.name)}</div>
           <div class="item-meta meta">${p.open_count} open</div></div></div>`).join('')}</div>
         <button class="btn" data-goto="projects" style="margin-top:14px">Go to projects</button>`
      : tom(`All ${d.projects.length} active projects have a next action. That is the whole point.`);
  }
  if (id === 'waiting') return liste(d.waiting, 'You are not waiting on anyone.');
  if (id === 'someday') return liste(d.someday, 'Nothing parked.');
  if (id === 'skipped') {
    return d.skipped.length
      ? `<div class="list">${d.skipped.map((r) => `<div class="item-row">
          <span class="rep-icon ${r.mode === 'completion' ? 'completion' : 'schedule'}">${icon('repeat', 16)}</span>
          <div class="item-main"><div class="item-title">${esc(r.title)}</div>
          <div class="item-meta meta">${esc(r.description)}</div></div>
          <span class="skipcount">${r.skips} skipped</span></div>`).join('')}</div>
         <button class="btn" data-goto="repeat" style="margin-top:14px">Go to recurring</button>`
      : tom('Nothing has been skipped. Your habits are holding.');
  }
  if (id === 'focus') {
    // Ugens projekter. Valget gemmes med det samme - trykker man "Continue
    // later" midt i en gennemgang, skal det ikke vaere spildt.
    const valgt = new Set(d.focus || []);
    return d.projects.length
      ? `<p class="lead" style="margin-bottom:12px">Tick the few you actually intend to
           move this week. The rest keep running without you.</p>
         <div class="list">${d.projects.map((p) => `
           <label class="item-row focusrow">
             <input type="checkbox" data-focus="${esc(p.id)}"${valgt.has(p.id) ? ' checked' : ''}>
             <div class="item-main"><div class="item-title">${esc(p.name)}</div>
             <div class="item-meta meta">${p.open_count} open${p.next_count ? '' : ' · no next action'}</div></div>
           </label>`).join('')}</div>`
      : tom('No active projects yet.');
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
  fokus.note = it.note || '';
  try {
    localStorage.setItem('doda_focus', JSON.stringify({
      id: it.id, start: fokus.start, title: it.title, note: fokus.note,
    }));
  } catch { /* privat tilstand */ }
  tegnFokus();
}

function stopFokus() {
  const paaSkaerm = state.view === 'focus';
  fokus.itemId = null;
  clearInterval(fokus.timer);
  fokus.timer = null;
  try { localStorage.removeItem('doda_focus'); } catch { /* ligegyldigt */ }
  const el = document.getElementById('focusBar');
  if (el) el.remove();
  // Bliver man staaende, ser man paa en skaerm uden en opgave.
  if (paaSkaerm) gaaTil('next');
}

function gendanFokus() {
  try {
    const g = JSON.parse(localStorage.getItem('doda_focus') || 'null');
    if (!g) return;
    fokus.itemId = g.id;
    fokus.start = g.start;
    fokus.titel = g.title;
    fokus.note = g.note || '';
    tegnFokus();
  } catch { /* ligegyldigt */ }
}

/** Sekunder som ur. Bruges baade af linjen og af skaermen, saa de ikke driver. */
function fokusUr(sek) {
  const m = String(Math.floor(sek / 60) % 60).padStart(2, '0');
  const s = String(sek % 60).padStart(2, '0');
  const t = Math.floor(sek / 3600);
  return `${t ? `${t}:` : ''}${m}:${s}`;
}

const fokusTitel = () => fokus.titel
  || (state.items.find((x) => x.id === fokus.itemId) || {}).title || 'Focus';

/**
 * Fokusskaermen: opgaven alene, som hjaelpeteksten i detaljeruden lover
 * ("This task on a screen of its own, with a timer that keeps running").
 *
 * Indtil v38 fandtes den ikke. Knappen lukkede bare ruden og satte en linje i
 * bunden - man landede i listen, altsaa netop det, fokus skulle fjerne. Teksten
 * var skrevet, funktionen var ikke bygget faerdig.
 */
function sideFokus() {
  if (!fokus.itemId) return '<div class="wrap"><p class="empty">Nothing in focus.</p></div>';
  const sek = Math.floor((Date.now() - fokus.start) / 1000);
  return `<div class="wrap focuspage">
    <div class="focusclock" id="focusBig">${esc(fokusUr(sek))}</div>
    <h1 class="focusname">${esc(fokusTitel())}</h1>
    ${fokus.note ? `<div class="note-preview focusnote">${markdown(fokus.note)}</div>` : ''}
    <div class="focusbtns">
      <button class="btn primary" id="fpDone">Done</button>
      <button class="btn" id="fpStop">Stop</button>
      <button class="btn ghost" id="fpBack">Keep it running</button>
    </div>
  </div>`;
}

function bindFokus() {
  const stop = document.getElementById('fpStop');
  if (stop) stop.addEventListener('click', stopFokus);
  const back = document.getElementById('fpBack');
  // Timeren loeber videre - man forlader kun skaermen, ikke fokus.
  if (back) back.addEventListener('click', () => gaaTil('next'));
  const done = document.getElementById('fpDone');
  if (done) {
    done.addEventListener('click', async () => {
      const id = fokus.itemId;
      stopFokus();
      await fuldfoer(id);
    });
  }
}

function tegnFokus() {
  if (!fokus.itemId) return;
  // Paa selve skaermen er linjen en dublet af det, man allerede kigger paa.
  const paaSkaerm = state.view === 'focus';
  let el = document.getElementById('focusBar');
  if (paaSkaerm && el) { el.remove(); el = null; }
  if (!paaSkaerm && !el) {
    el = document.createElement('div');
    el.className = 'focusbar';
    el.id = 'focusBar';
    document.body.appendChild(el);
  }
  const tegn = () => {
    const sek = Math.floor((Date.now() - fokus.start) / 1000);
    const stor = document.getElementById('focusBig');
    if (stor) stor.textContent = fokusUr(sek);
    const b = document.getElementById('focusBar');
    if (!b) return;
    b.innerHTML = `<span class="focustime">${esc(fokusUr(sek))}</span>
      <span class="focustitle">${esc(fokusTitel())}</span>
      <button class="btn ghost" id="focusDone">Done</button>
      <button class="btn ghost" id="focusStop">Stop</button>`;
    // Titlen foerer tilbage til skaermen - ellers er der ingen vej tilbage,
    // naar man foerst har navigeret vaek.
    b.querySelector('.focustitle').addEventListener('click', () => gaaTil('focus'));
    b.querySelector('#focusStop').addEventListener('click', stopFokus);
    b.querySelector('#focusDone').addEventListener('click', async () => {
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

/* ------------------------------------------- kalender, eksport, import */

async function bindData() {
  const boks = document.getElementById('calBox');
  if (!boks) return;

  const tegnKalender = (token) => {
    if (!token) {
      boks.innerHTML = '<button class="btn" id="calMake">Create subscription address</button>';
      boks.querySelector('#calMake').addEventListener('click', async () => {
        const d = await api('POST', '/api/v1/calendar', {});
        tegnKalender(d.token);
        toast('Address created');
      });
      return;
    }
    const url = `${location.origin}/ical/${token}.ics`;
    boks.innerHTML = `<div class="keyshow" id="calUrl">${esc(url)}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn" id="calCopy">Copy address</button>
        <button class="btn ghost" id="calNew">Replace</button>
        <button class="btn ghost" id="calOff">Turn off</button>
      </div>
      <label class="field" style="margin-top:16px"><span>Remind me</span>
        <select class="input" id="calAlarm" style="max-width:280px">
          ${[['-1', 'No reminder'], ['0', 'At the time'], ['5', '5 minutes before'],
    ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before']]
    .map(([v, n]) => `<option value="${v}"${v === String(state.icalAlarm) ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>
      <p class="gate-note" style="text-align:left">Only tasks with a <strong>time</strong>
      get a reminder — a whole-day task would ring at midnight. This is how doda
      notifies you: your own calendar does it, so it works with the app closed and
      without asking permission for anything.</p>
      <p class="gate-note" style="text-align:left">In Apple Calendar:
      File → New Calendar Subscription, and paste this. On iPhone the subscription
      must have <strong>Remove Alarms</strong> switched off.</p>`;
    boks.querySelector('#calAlarm').addEventListener('change', async (e) => {
      state.icalAlarm = e.target.value;
      await api('POST', '/api/v1/settings', { settings: { ical_alarm: e.target.value } });
      // Kalender-apps henter feedet igen af sig selv - typisk hvert kvarter.
      toast(e.target.value === '-1' ? 'Reminders off'
        : 'Saved — your calendar picks it up at its next refresh');
    });
    boks.querySelector('#calCopy').addEventListener('click', () => kopiér(url));
    boks.querySelector('#calNew').addEventListener('click', async () => {
      const d = await api('POST', '/api/v1/calendar', {});
      tegnKalender(d.token);
      toast('New address — the old one stopped working');
    });
    boks.querySelector('#calOff').addEventListener('click', async () => {
      await api('POST', '/api/v1/calendar', { action: 'revoke' });
      tegnKalender(null);
      toast('Subscription turned off');
    });
  };
  try {
    const s = await api('GET', '/api/v1/settings');
    state.icalAlarm = (s.settings && s.settings.ical_alarm) || '15';
  } catch { state.icalAlarm = '15'; }
  try { tegnKalender((await api('GET', '/api/v1/calendar')).token); }
  catch (ex) { boks.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }

  const hent = (medFiler) => {
    // Browseren henter selv filen; en <a download> med samme oprindelse
    // faar Content-Disposition fra serveren.
    const a = document.createElement('a');
    a.href = `/api/v1/export${medFiler ? '?files=1' : ''}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  document.getElementById('expData').addEventListener('click', () => hent(false));
  document.getElementById('expAll').addEventListener('click', () => hent(true));

  document.getElementById('tdBtn').addEventListener('click', todoistImport);

  const felt = document.getElementById('impFile');
  document.getElementById('impBtn').addEventListener('click', () => felt.click());
  felt.addEventListener('change', async () => {
    const f = felt.files[0];
    felt.value = '';
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (!doc || doc.doda !== 1) { toast('That is not a doda export file.'); return; }
      toast('Importing…');
      const tal = await importerIPortioner(doc);
      await genindlaes();
      tegnSide();
      toast(`Imported ${Object.entries(tal).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } catch (ex) { toast(`Import failed: ${ex.message}`); }
  });
}

/**
 * Sender importen i portioner.
 *
 * En fuld backup overstiger let serverens body-graense. Kokkeris 260 MB-backup
 * blev afvist af serverens egen 25 MB-graense og var i praksis ubrugelig, uden
 * at nogen opdagede det (RUNE-ERFARINGER §4). Derfor: smaa portioner, og
 * strukturen (omraader, projekter, kontekster) FOERST, sa fremmednoeglerne
 * findes, naar elementerne kommer.
 */
async function importerIPortioner(doc) {
  const total = {};
  const laeg = (t) => { for (const [k, v] of Object.entries(t)) total[k] = (total[k] || 0) + v; };

  laeg((await api('POST', '/api/v1/import', {
    areas: doc.areas, contexts: doc.contexts, projects: doc.projects,
    recurrences: doc.recurrences, settings: doc.settings,
  })).imported);

  for (let i = 0; i < (doc.items || []).length; i += 100) {
    laeg((await api('POST', '/api/v1/import', { items: doc.items.slice(i, i + 100) })).imported);
  }
  laeg((await api('POST', '/api/v1/import', { item_contexts: doc.item_contexts })).imported);

  // Filerne kan vaere store - én ad gangen, sa en enkelt aldrig sprænger loftet.
  for (const a of doc.attachments || []) {
    laeg((await api('POST', '/api/v1/import', { attachments: [a] })).imported);
  }
  return total;
}

function kopiér(tekst) {
  try {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(tekst);
    else {
      const t = document.createElement('textarea');
      t.value = tekst;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    toast('Copied');
  } catch { toast('Could not copy — select the text manually'); }
}

/* ------------------------------------------------------ Todoist-import */

/**
 * Todoist eksporterer ét projekt pr. CSV-fil. Man kan traekke dem alle ind
 * pa én gang.
 *
 * Data gaar gennem dodas EGEN fangst-parser, sa datoer, gentagelser og
 * kontekster tolkes af én motor - ikke to, der kan komme i utakt.
 */
async function todoistImport() {
  const felt = document.createElement('input');
  felt.type = 'file';
  felt.accept = '.csv,text/csv';
  felt.multiple = true;
  felt.addEventListener('change', async () => {
    const filer = [...felt.files];
    if (!filer.length) return;

    const laest = [];
    for (const f of filer) {
      laest.push(Object.assign(dodaTodoist.laesProjekt(await f.text(), f.name), { filnavn: f.name }));
    }
    visTodoistForhaandsvisning(laest);
  });
  felt.click();
}

function visTodoistForhaandsvisning(laest) {
  const ialt = laest.reduce((n, f) => n + f.items.length, 0);
  const advarsler = laest.flatMap((f) => f.warnings.map((w) => `${f.filnavn}: ${w}`));
  const brugbare = laest.filter((f) => f.items.length);

  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true">
    <h2>Import from Todoist</h2>
    ${ialt ? `<p class="lead" style="margin:6px 0 16px">${ialt} item${ialt === 1 ? '' : 's'}
      from ${brugbare.length} project${brugbare.length === 1 ? '' : 's'}. Nothing is saved until you confirm.</p>`
    : '<p class="lead" style="margin:6px 0 16px">Nothing to import from those files.</p>'}

    ${brugbare.map((f) => {
    const kontekster = [...new Set(f.items.flatMap((i) => i.contexts))];
    return `<div class="card" style="margin-bottom:8px;padding:14px 18px">
        <div style="font-weight:650">${esc(f.project)}</div>
        <div class="meta" style="text-transform:none;letter-spacing:0;margin-top:4px">
          ${f.items.filter((i) => i.kind === 'task').length} tasks ·
          ${f.items.filter((i) => i.kind === 'note').length} notes
          ${kontekster.length ? ` · contexts: ${kontekster.map((c) => `#${esc(c)}`).join(' ')}` : ''}
          ${f.skipped ? ` · ${f.skipped} skipped` : ''}
        </div>
        <div class="meta" style="text-transform:none;letter-spacing:0;margin-top:8px;opacity:.75">
          ${f.items.slice(0, 3).map((i) => esc(i.title)).join(' · ')}${f.items.length > 3 ? ' …' : ''}
        </div>
      </div>`;
  }).join('')}

    ${advarsler.length ? `<div class="nudge" style="margin-top:8px">${icon('next', 17)}
      <span>${advarsler.map(esc).join('<br>')}</span></div>` : ''}

    <p class="gate-note" style="text-align:left">Todoist's <strong>@labels</strong> become
    doda <strong>#contexts</strong> — the two apps use the symbols the other way round.
    Priorities are dropped on purpose: doda has no priority levels.</p>

    <div class="modal-foot">
      <span style="flex:1"></span>
      <button class="btn" id="tdCancel">Cancel</button>
      <button class="btn primary" id="tdGo"${ialt ? '' : ' disabled'}>Import ${ialt || ''}</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.querySelector('#tdCancel').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  host.querySelector('#tdGo').addEventListener('click', async () => {
    const knap = host.querySelector('#tdGo');
    knap.disabled = true;
    let n = 0;
    let fejl = 0;
    for (const f of brugbare) {
      for (const it of f.items) {
        try {
          // Samme endepunkt som al anden fangst - ingen saerlig importvej
          // ind i dataene.
          await api('POST', '/api/v1/capture', { text: dodaTodoist.somFangst(it), createNew: true });
          n++;
        } catch { fejl++; }
      }
      knap.textContent = `Imported ${n}…`;
    }
    luk();
    await genindlaes();
    tegnSide();
    toast(fejl ? `Imported ${n}, ${fejl} failed` : `Imported ${n} items from Todoist`);
  });
}

/* -------------------------------------------------- genvejsoversigten */

/* Handover §7: "Vis en oversigt over genvejene med ?". Den skal kunne naas
   overalt - ogsaa fra en liste, hvor bogstaverne ellers er optaget. */
const GENVEJE = [
  ['Anywhere', [
    ['any key', 'Start capturing — the palette opens with what you typed'],
    ['↑ ↓', 'Step into the list below, without opening anything'],
    ['?', 'This list'],
    ['esc', 'Close whatever is open'],
    ['⌘ enter', 'Save the open task, project or repeat'],
  ]],
  ['In the palette', [
    ['+', 'New task'], ['*', 'New note'],
    ['/', 'Jump to a project'], ['#', 'Jump to a context'], [':', 'Jump to an area'],
    ['↑ ↓', 'Move between results'], ['enter', 'Create or open'],
    ['backspace', 'Leave the mode when the field is empty'],
  ]],
  ['In a list', [
    ['↑ ↓', 'Move between items (or j / k)'],
    ['esc', 'Leave the list — letters go back to capturing'],
    ['enter', 'Open the item'],
    ['space', 'Mark it done'],
    ['n', 'Next Actions'], ['w', 'Waiting For'], ['s', 'Someday'],
    ['c', 'Set a context'], ['p', 'Set a project'],
    ['x', 'Delete'],
  ]],
];

function visGenveje() {
  if (document.getElementById('shortcutSheet')) return;
  const host = document.createElement('div');
  host.className = 'modal';
  host.id = 'shortcutSheet';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
    <h2>Keyboard shortcuts</h2>
    <p class="lead" style="margin:6px 0 18px">Clarifying the inbox never needs the mouse.</p>
    ${GENVEJE.map(([gruppe, liste]) => `
      <div class="meta" style="margin:16px 0 8px">${esc(gruppe)}</div>
      <table class="shortcuts">${liste.map(([tast, hvad]) =>
    `<tr><td><kbd>${esc(tast)}</kbd></td><td>${esc(hvad)}</td></tr>`).join('')}</table>`).join('')}
    <div class="modal-foot"><span style="flex:1"></span>
      <button class="btn primary" id="scClose">Close</button></div>
  </div>`;
  document.body.appendChild(host);
  const luk = () => host.remove();
  host.querySelector('#scClose').addEventListener('click', luk);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });
  host.querySelector('#scClose').focus();
}

// ? skal virke OVERALT - ogsaa i en liste, hvor bogstaverne er optaget af
// afklaringen. Derfor fanges den her, foer listens egne taster.
document.addEventListener('keydown', (e) => {
  if (!state.user || e.key !== '?') return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  e.preventDefault();
  e.stopPropagation();
  visGenveje();
}, true);

/* ------------------------------------------------------------- noter */

/**
 * Alle noter, grupperet efter projekt.
 *
 * Noter er reference og dukker aldrig op i handlingslisterne (DESIGN.md §3).
 * Uden denne skaerm kunne en note UDEN projekt kun findes ved at soege efter
 * den - den stod bogstaveligt talt ingen steder i menuen.
 *
 * Den hedder "Notes" og ikke GTD's "Reference", fordi appen allerede kalder
 * dem noter overalt: `*` opretter en note, detaljeruden siger "Make it a
 * note", ikonet er en note. To ord for det samme er ét for meget.
 */
async function sideNoter() {
  const host = document.getElementById('pageHost');
  const d = await api('GET', '/api/v1/items?kind=note');
  state.items = d.items;

  const hoved = `<div class="page-head"><h1>Notes</h1>
    <p class="lead">${esc(BESKRIVELSER.notes)}</p></div>`;

  if (!d.items.length) {
    host.innerHTML = `<section class="page">${hoved}
      <div class="empty">${icon('note', 34)}
        <p class="empty-title">No notes yet</p>
        <p>Start a capture with <strong>*</strong> — <code>* wifi password 1234</code> —
        or open a task and press <strong>Make it a note</strong>.</p></div>
    </section>`;
    return;
  }

  // Samme gruppering som Next Actions, bare efter projekt. "No project" er
  // sidst: en note uden projekt er ikke en fejl, bare uplaceret.
  const grupper = new Map();
  for (const it of d.items) {
    const p = it.project_id ? (state.projects.find((x) => x.id === it.project_id) || {}).name : null;
    const noegle = p || 'No project';
    if (!grupper.has(noegle)) grupper.set(noegle, []);
    grupper.get(noegle).push(it);
  }
  const sorteret = [...grupper.entries()].sort((a, b) => {
    if (a[0] === 'No project') return 1;
    if (b[0] === 'No project') return -1;
    return a[0].localeCompare(b[0]);
  });

  let n = 0;
  host.innerHTML = `<section class="page">${hoved}
    <p class="meta" style="margin-bottom:12px">${d.items.length} note${d.items.length === 1 ? '' : 's'}</p>
    <div data-keynav>
      ${sorteret.map(([navn, liste]) => `
        <h2 class="group meta">${esc(navn)} <span class="group-count">${liste.length}</span></h2>
        <div class="list">${liste.map((it) => elementRaekke(it, n++)).join('')}</div>`).join('')}
    </div>
    <p class="hintline meta">↑↓ select · enter open · esc leave</p>
  </section>`;
  bindListe();
}


/* Push-kortet i Settings. Siger hvad der mangler, frem for at vise en knap,
   der ikke kan virke. */
async function bindPush() {
  const boks = document.getElementById('pushBox');
  if (!boks) return;

  const spaerre = pushMuligt();
  if (spaerre) {
    boks.innerHTML = `<p class="lead" style="margin:12px 0 0">${esc(spaerre)}</p>`;
    return;
  }

  const tegn = (d, tilmeldt) => {
    boks.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">
        <button class="btn ${tilmeldt ? '' : 'primary'}" id="pushBtn">
          ${tilmeldt ? 'Turn off on this device' : 'Turn on for this device'}</button>
        <span class="meta">${d.devices} device${d.devices === 1 ? '' : 's'} connected</span>
      </div>
      <label class="field" style="margin-top:14px"><span>Send it</span>
        <select class="input" id="pushLead" style="max-width:260px">
          ${[['0', 'At the time'], ['5', '5 minutes before'], ['15', '15 minutes before'],
    ['30', '30 minutes before'], ['60', '1 hour before']]
    .map(([v, n]) => `<option value="${v}"${Number(v) === d.lead ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>`;

    boks.querySelector('#pushBtn').addEventListener('click', async () => {
      const knap = boks.querySelector('#pushBtn');
      knap.disabled = true;
      try {
        if (tilmeldt) { await slaaPushFra(); toast('Notifications off for this device'); }
        else { await slaaPushTil(); toast('Notifications on — this device will be reminded'); }
        await bindPush();
      } catch (ex) { toast(ex.message); knap.disabled = false; }
    });
    boks.querySelector('#pushLead').addEventListener('change', async (e) => {
      await api('POST', '/api/v1/push', { lead: e.target.value });
      toast('Saved');
    });
  };

  try {
    const d = await api('GET', '/api/v1/push');
    const reg = await navigator.serviceWorker.ready;
    tegn(d, !!(await reg.pushManager.getSubscription()));
  } catch (ex) {
    boks.innerHTML = `<p class="lead" style="margin:12px 0 0">${esc(ex.message)}</p>`;
  }
}

/* Notion-kortet i Settings. Tokenet sendes op, aldrig ned. */
async function bindNotion() {
  const boks = document.getElementById('notionBox');
  if (!boks) return;

  const tegn = (d) => {
    boks.innerHTML = d.connected
      ? `<div class="keyrow" style="margin-top:12px">
           <div class="keyrow-main">
             <div class="keyrow-name">Connected${d.workspace ? ` · ${esc(d.workspace)}` : ''}</div>
             <div class="meta" id="ntSeen">checking what doda can see…</div>
           </div>
           <button class="btn ghost" id="ntOff">Disconnect</button>
         </div>`
      : `<form id="ntForm" class="keyform" style="margin-top:12px">
           <input class="input" id="ntToken" type="password" autocomplete="off"
             placeholder="ntn_… (internal integration secret)" required>
           <button class="btn primary" type="submit">Connect</button>
         </form>
         <p class="gate-error" id="ntErr" hidden></p>`;

    /* Det vigtigste svar paa "hvorfor kan doda ikke finde min side?" er,
       hvor mange sider den overhovedet kan se. En tom soegning giver alt,
       integrationen har adgang til - saa staar tallet der, og man behoever
       ikke gaette paa, om delingen er gaaet igennem. */
    const set = boks.querySelector('#ntSeen');
    if (set) {
      api('GET', '/api/v1/notion/search?q=').then((s) => {
        const n = s.pages.length;
        set.innerHTML = n
          ? `can see ${n}${n >= 12 ? '+' : ''} page${n === 1 ? '' : 's'} · e.g. ${esc(s.pages[0].title)}`
          : 'can see <strong>no pages yet</strong> — share one with the integration in Notion';
      }).catch(() => { set.textContent = 'could not ask Notion right now'; });
    }

    const af = boks.querySelector('#ntOff');
    if (af) {
      af.addEventListener('click', async () => {
        await api('DELETE', '/api/v1/notion', {});
        tegn({ connected: false });
        toast('Notion disconnected');
      });
    }
    const form = boks.querySelector('#ntForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fejl = boks.querySelector('#ntErr');
        fejl.hidden = true;
        try {
          // Serveren proever tokenet mod Notion, FOER den siger ja. Et token,
          // der ikke virker, maa ikke blive liggende og ligne en forbindelse.
          const d2 = await api('POST', '/api/v1/notion', { token: boks.querySelector('#ntToken').value });
          tegn(d2);
          toast(`Connected to Notion${d2.workspace ? ` · ${d2.workspace}` : ''}`);
        } catch (ex) { fejl.textContent = ex.message; fejl.hidden = false; }
      });
    }
  };

  try { tegn(await api('GET', '/api/v1/notion')); }
  catch (ex) { boks.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }
}
