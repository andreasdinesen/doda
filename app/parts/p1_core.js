'use strict';
/* doda - kerne: opstart, tema, login, app-skal, kommandobar.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js. */

const APP_VERSION = 1;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen pa en iPad, hvor CSS'en tror den er
   overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'doda', needsSetup: false, secureContext: false },
  view: 'next',
  omni: '',
};

/* ------------------------------------------------------------ hjaelpere */

// crypto.randomUUID() findes KUN i secure contexts. Panelet tilgas pa IP:port
// over http, hvor alt der opretter id'er ellers doer stille (RUNE-ERFARINGER §4).
function nyId() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256 | 0; });
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    // Sæt headers EFTER en evt. merge - shallow merge har foer slettet
    // Authorization, fordi headers-objektet blev erstattet (RUNE-ERFARINGER, Kokkeri v15).
    opts.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Fejl ${res.status}`), { status: res.status });
  return data;
}

function toast(msg) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* --------------------------------------------------------------- tema */

function anvendTema(valg) {
  if (valg === 'light' || valg === 'dark') document.documentElement.setAttribute('data-theme', valg);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('doda_theme', valg); } catch { /* privat tilstand */ }
}

function nuvaerendeTema() {
  try { return localStorage.getItem('doda_theme') || 'auto'; } catch { return 'auto'; }
}

/* -------------------------------------------------------------- ikoner */

const ICONS = {
  logo: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
  next: '<circle cx="12" cy="12" r="9"/><path d="M9.5 12h6M13 9.5l2.5 2.5-2.5 2.5"/>',
  inbox: '<path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M4.5 13L6.8 5.6A1.5 1.5 0 018.2 4.5h7.6a1.5 1.5 0 011.4 1.1L19.5 13v4.5a2 2 0 01-2 2h-11a2 2 0 01-2-2z"/>',
  waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  someday: '<path d="M4 8.5h16v9.5a2 2 0 01-2 2H6a2 2 0 01-2-2z"/><path d="M4 8.5l1.4-3A1.5 1.5 0 016.8 4.5h10.4a1.5 1.5 0 011.4 1l1.4 3"/><path d="M10 12.5h4"/>',
  projects: '<path d="M6.5 20L12 4l5.5 16"/>',
  contexts: '<path d="M5 9.5h14M5 14.5h14M10.5 4.5L8.5 19.5M15.5 4.5l-2 15"/>',
  repeat: '<path d="M4.5 11a7.5 7.5 0 0112.6-5.4L20 8.5"/><path d="M20 4.5v4h-4"/><path d="M19.5 13a7.5 7.5 0 01-12.6 5.4L4 15.5"/><path d="M4 19.5v-4h4"/>',
  log: '<path d="M5 5.5A1.5 1.5 0 016.5 4H18v16H6.5A1.5 1.5 0 015 18.5z"/><path d="M9 9h6M9 13h4"/>',
  review: '<path d="M4.5 6.5h15v13h-15z"/><path d="M4.5 10h15M9 4.5v3M15 4.5v3"/><path d="M9 14l2 2 3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6L6 18M18 18l-1.4-1.4M7.4 7.4L6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  calm: '<path d="M3 15c3 0 3-3 6-3s3 3 6 3 3-3 6-3"/><circle cx="12" cy="7" r="2.5"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------- sider */

// Raekkefoelgen her er ogsaa sidebarens. Handover §6.
const VIEWS = [
  { id: 'next', label: 'Næste', icon: 'next', group: 1, fase: 'F1' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', group: 1, fase: 'F1' },
  { id: 'waiting', label: 'Venter på', icon: 'waiting', group: 2, fase: 'F7' },
  { id: 'someday', label: 'Engang måske', icon: 'someday', group: 2, fase: 'F7' },
  { id: 'repeat', label: 'Gentagelser', icon: 'repeat', group: 2, fase: 'F4' },
  { id: 'projects', label: 'Projekter', icon: 'projects', group: 3, fase: 'F3' },
  { id: 'contexts', label: 'Kontekster', icon: 'contexts', group: 3, fase: 'F3' },
  { id: 'log', label: 'Logbog', icon: 'log', group: 4, fase: 'F7' },
  { id: 'review', label: 'Gennemgang', icon: 'review', group: 4, fase: 'F7' },
  { id: 'settings', label: 'Indstillinger', icon: 'settings', group: 5, fase: null },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

/* ------------------------------------------------------------ optegning */

function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
}

function gateHtml() {
  const setup = state.config.needsSetup;
  return `
  <div class="gate">
    <div class="card">
      <div class="brand">${icon('logo', 26)} doda</div>
      <p class="lead" style="text-align:center;margin-bottom:22px">
        ${setup ? 'Vælg et brugernavn og et kodeord, så er du i gang.' : 'Log ind for at fortsætte.'}
      </p>
      <p class="gate-error" id="gateError" hidden></p>
      <form id="gateForm">
        <label class="field"><span>Brugernavn</span>
          <input class="input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Kodeord</span>
          <input class="input" id="gatePass" type="password"
            autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
        <button class="btn primary" type="submit" style="width:100%">
          ${setup ? 'Opret og log ind' : 'Log ind'}</button>
      </form>
      ${setup ? '<p class="gate-note">doda er en app til én bruger. Når kontoen er oprettet, lukkes oprettelse permanent.</p>' : ''}
    </div>
  </div>`;
}

function bindGate() {
  const form = document.getElementById('gateForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('gateError');
    err.hidden = true;
    const username = document.getElementById('gateUser').value;
    const password = document.getElementById('gatePass').value;
    try {
      const data = await api('POST', state.config.needsSetup ? '/api/register' : '/api/login', { username, password });
      state.user = data.user;
      state.config.needsSetup = false;
      render();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  document.getElementById('gateUser').focus();
}

function shellHtml() {
  const groups = [...new Set(VIEWS.map((v) => v.group))];
  const nav = groups.map((g) => `<nav class="nav">${VIEWS.filter((v) => v.group === g).map((v) => `
      <button class="nav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon)}<span>${esc(v.label)}</span>
      </button>`).join('')}</nav>`).join('');

  return `
  <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} doda</div>
      ${nav}
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn">${icon('settings')}<span>${esc(state.user.username)}</span></button>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div class="stats meta"><span>version ${APP_VERSION}</span><span>fundament</span></div>
        <div class="omni">
          <span class="omni-icon">${icon('search', 20)}</span>
          <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
            placeholder="Søg, fang eller spring til projekt…" value="${esc(state.omni)}">
        </div>
        <div class="omni-chips" id="omniChips"></div>
      </div>
      ${pageHtml()}
    </main>
  </div>
  <div class="hint"><span class="key">A</span><span class="meta">tryk en tast for at fange</span></div>`;
}

function pageHtml() {
  const view = viewById(state.view);
  if (view.id === 'settings') return settingsHtml();
  return `
  <section class="page">
    <div class="page-head">
      <h1>${esc(view.label)}</h1>
      <p class="lead">${esc(BESKRIVELSER[view.id] || '')}</p>
    </div>
    <div class="empty">
      ${icon('calm', 34)}
      <p class="empty-title">Bygges i ${esc(view.fase)}</p>
      <p>Skallen står klar. Funktionen kommer i den fase.</p>
    </div>
  </section>`;
}

const BESKRIVELSER = {
  next: 'Hvad du kan gøre lige nu, grupperet efter kontekst.',
  inbox: 'Ufordøjede elementer, der venter på afklaring.',
  waiting: 'Uddelegeret — du venter på en anden.',
  someday: 'Parkeret uden forpligtelse.',
  repeat: 'Dine gentagelser, og hvornår de næste gang forfalder.',
  projects: 'Alt der kræver mere end én handling, grupperet efter område.',
  contexts: 'Hvor og hvordan en opgave kan udføres.',
  log: 'Hvad du har udført, i kronologisk orden.',
  review: 'Den ugentlige gennemgang, trin for trin.',
};

function settingsHtml() {
  const tema = nuvaerendeTema();
  const valg = [['auto', 'Følg systemet'], ['light', 'Lyst'], ['dark', 'Mørkt']];
  return `
  <section class="page">
    <div class="page-head">
      <h1>Indstillinger</h1>
      <p class="lead">Udseende, konto og adgang.</p>
    </div>

    <div class="card">
      <h2>Tema</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${valg.map(([v, l]) => `<button class="btn ${tema === v ? 'primary' : ''}" data-tema="${v}">${l}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2>Skift kodeord</h2>
      <p class="gate-error" id="pwMsg" hidden></p>
      <form id="pwForm" style="margin-top:12px">
        <label class="field"><span>Nuværende kodeord</span>
          <input class="input" id="pwCur" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>Nyt kodeord (mindst 8 tegn)</span>
          <input class="input" id="pwNew" type="password" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Skift kodeord</button>
      </form>
      <p class="gate-note" style="text-align:left">
        Alle andre sessioner logges ud, når kodeordet skiftes.
      </p>
    </div>

    <div class="card">
      <h2>Konto</h2>
      <p class="lead" style="margin:6px 0 14px">Logget ind som <strong>${esc(state.user.username)}</strong>.</p>
      <button class="btn" id="logoutBtn">Log ud</button>
    </div>

    <div class="card">
      <h2>Om</h2>
      <p class="lead" style="margin-top:6px">doda version ${APP_VERSION}.
      ${state.config.secureContext ? 'Sikker forbindelse (https).' : 'Almindelig http — passkeys og notifikationer er ikke tilgængelige her.'}</p>
    </div>
  </section>`;
}

/* ---------------------------------------------------------- hændelser */

function bindShell() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
  document.getElementById('userBtn').addEventListener('click', () => gaaTil('settings'));

  const toggle = document.getElementById('navToggle');
  toggle.addEventListener('click', () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click', () => document.body.classList.remove('navopen'));

  const omni = document.getElementById('omni');
  omni.addEventListener('input', () => { state.omni = omni.value; tegnChips(); });
  omni.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { omni.value = ''; state.omni = ''; tegnChips(); omni.blur(); }
    if (e.key === 'Enter') { e.preventDefault(); toast('Fangst og søgning bygges i F1.'); }
  });
  tegnChips();

  if (state.view === 'settings') bindSettings();
}

function bindSettings() {
  document.querySelectorAll('[data-tema]').forEach((el) => {
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); render(); });
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('POST', '/api/logout', {});
    state.user = null;
    render();
  });

  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pwMsg');
    msg.hidden = true;
    try {
      await api('POST', '/api/password', {
        current: document.getElementById('pwCur').value,
        next: document.getElementById('pwNew').value,
      });
      toast('Kodeordet er skiftet.');
      document.getElementById('pwForm').reset();
    } catch (ex) {
      msg.textContent = ex.message;
      msg.hidden = false;
    }
  });
}

function gaaTil(view) {
  const skifter = state.view !== view;
  state.view = view;
  document.body.classList.remove('navopen');
  render();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren
  // op hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter) window.scrollTo(0, 0);
}

/* Chips der viser tolkningen. I F0 er de rent visuelle; parseren kommer i F1. */
function tegnChips() {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const t = state.omni;
  const chips = [];
  if (t.startsWith('*')) chips.push(['Note', true]);
  else if (t.trim()) chips.push(['Opgave → Inbox', true]);
  for (const m of t.matchAll(/#([\p{L}\d_-]+)/gu)) chips.push([`#${m[1]}`, true]);
  for (const m of t.matchAll(/@([\p{L}\d_-]+)/gu)) chips.push([`@${m[1]}`, true]);
  if (/!\s*\S/.test(t)) chips.push(['dato tolkes i F1', false]);
  host.innerHTML = chips.map(([label, aktiv]) =>
    `<span class="chip${aktiv ? '' : ' neutral'}">${esc(label)}</span>`).join('');
}

/* Signaturen: begynd bare at skrive, sa abner kommandobaren.
   Undtagelser er vigtigere end reglen - uden dem stjaeler den tastetryk
   fra ethvert felt i appen. */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

  const omni = document.getElementById('omni');
  if (!omni) return;

  if (e.key === '/') { e.preventDefault(); omni.focus(); return; }
  if (e.key.length !== 1) return;
  e.preventDefault();
  omni.focus();
  omni.value += e.key;
  state.omni = omni.value;
  tegnChips();
});

/* --------------------------------------------------------------- start */

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'doda';
    const me = await api('GET', '/api/me');
    state.user = me.user;
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} doda</div>
       <p class="lead" style="text-align:center">Kunne ikke nå serveren.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
})();
