'use strict';
/* doda - kerne: opstart, tema, login, app-skal.
   Denne fil samles til public/app.js af build_rune.py. Redigér aldrig app.js.

   NB: interfacet er ENGELSK (Andreas' oenske - aeoea er besvaerligt at taste),
   men koden, kommentarerne og dokumenterne er dansk. */

const APP_VERSION = 100;

/* Mobilgraensen bor to steder: her og i style.css. Holdes de ikke i trit,
   folder menuknappen sidebaren sammen pa en iPad, hvor CSS'en tror den er
   overlay (RUNE-ERFARINGER §4). */
const SMAL_SKAERM = 900;
const smalSkaerm = () => window.matchMedia(`(max-width: ${SMAL_SKAERM}px)`).matches;

const state = {
  user: null,
  config: { appName: 'doda', needsSetup: false, secureContext: false },
  view: 'next',
  contexts: [],
  projects: [],
  areas: [],
  openProject: null,
  logProject: null,
  review: null,
  counts: {},
  today: '',
  filterContext: null,
  items: [],
  indlaeser: false,
  // Noter kan slaas fra (Settings). Bruger man Notion til reference, er
  // dodas noter ét sted for meget. Standard er TIL - en ny installation skal
  // ikke mangle noget, fordi ingen har taget stilling.
  notesEnabled: true,
  noteCount: 0,
  hideDone: false,
  appBadge: true,
  /*
   * tovo - soesterappen, hvor timerne bor (F10).
   *
   * `timer` er den KOERENDE tidtagning, som tovo kender den: {taskId,
   * startedAt, title, …} eller null. Den hentes i et kald for sig og aldrig
   * som en del af `/api/v1/state`: en rundtur til en fremmed server ved hver
   * optegning er den fejl, Sagu-broen allerede har betalt for.
   *
   * `taskId` er tovos id, ikke dodas. Det er `item.tovo_task_id`, der binder
   * de to sammen - og derfor kan en raekke kun vide, at DEN koerer, hvis
   * opgaven har vaeret startet mindst én gang.
   */
  tovo: { connected: false, timer: null, url: '', projects: [] },
};

/* ------------------------------------------------------------ hjaelpere */

// crypto.randomUUID() findes KUN i secure contexts. Panelet tilgas pa IP:port
// over http, hvor alt der opretter id'er ellers doer stille (RUNE-ERFARINGER §4).
function nyId() {
  if (window.crypto && crypto.randomUUID && window.isSecureContext) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
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

/* Brugernavnet vises med stort - reglen bor i shared/parse.js, fordi ogsaa
   SERVEREN tegner sider, hvor navnet staar (samtykkesiden til en connector).
   Stod den kun her, ville de to flader sige hvert sit om samme konto. */
const visNavn = (n) => (typeof dodaParse !== 'undefined'
  ? dodaParse.visNavn(n)
  : String(n == null ? '' : n).replace(/^./, (c) => c.toUpperCase()));

/**
 * Gor URL'er og [tekst](url) klikbare.
 *
 * Teksten escapes FOERST, sa alt indhold er ufarligt, og der matches derefter
 * kun pa http(s). Det er med vilje: javascript: og data: ma aldrig kunne slippe
 * igennem fra en import, et API-kald eller en MCP-klient (DESIGN.md §3).
 */
/**
 * Ramte klikket et link inde i en raekke?
 *
 * Siden v92 kan en TITEL indeholde et link (`linkify`). En raekke, der aabner
 * opgaven ved klik, maa derfor spoerge foerst - ellers gaar man to steder hen
 * paa én gang: linket aabner, OG opgaven aabner bagved.
 *
 * Det er en navngivet regel og ikke en `if` hvert sted, saa den kan findes
 * med et grep, naar der kommer en raekke mere. Den er med vilje IKKE en
 * delegeret lytter: den eneste maade at stoppe raekken paa fra `document`
 * ville vaere `stopPropagation()` i fangfasen, og saa ville den ogsaa stoppe
 * link-lytteren, som er den, der overhovedet aabner links i en app paa
 * hjemmeskaermen (§7k).
 */
function paaLink(e) {
  return !!(e && e.target && e.target.closest && e.target.closest('a[href]'));
}

function linkify(tekst) {
  let ud = esc(tekst);
  ud = ud.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]{1,500})\)/g,
    (_, navn, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${navn}</a>`);
  ud = ud.replace(/(^|[\s(])(https?:\/\/[^\s<]{1,500})/g, (helt, foer, url) => {
    // Slutpunktum og lukkeparentes hoerer til saetningen, ikke til adressen.
    const hale = url.match(/[.,;:!?)]+$/);
    const ren = hale ? url.slice(0, -hale[0].length) : url;
    const vis = ren.replace(/^https?:\/\//, '').slice(0, 60);
    return `${foer}<a href="${ren}" target="_blank" rel="noopener noreferrer">${vis}</a>${hale ? hale[0] : ''}`;
  });
  return ud;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    // Saet headers EFTER en evt. merge - en shallow merge har foer slettet
    // Authorization, fordi hele header-objektet blev erstattet
    // (RUNE-ERFARINGER, Kokkeri v15).
    opts.headers = { 'Content-Type': 'application/json' };
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // Browserens egen tekst er ubrugelig for et menneske: Safari siger
    // "Load failed", Chrome "Failed to fetch". Femten steder i appen viser
    // ex.message direkte i en toast, saa oversaettelsen hoerer hjemme HER -
    // ét sted - og ikke i hvert kaldssted.
    //
    // Ingen `status`: erNetvaerksfejl() skelner netop paa den, og
    // fangst-koen skal stadig kunne se, at det var nettet og ikke et afslag.
    throw Object.assign(new Error('No connection — this needs the network. Try again when you are back.'),
      { offline: true });
  }
  let data = {};
  try { data = await res.json(); } catch { /* tomt svar er i orden */ }
  // API'et svarer {error: kode, message: laesbar tekst}. Mennesket skal se
  // beskeden; koden er til klienter.
  if (!res.ok) {
    throw Object.assign(new Error(data.message || data.error || `Error ${res.status}`),
      { status: res.status, code: data.error });
  }
  return data;
}

function toast(besked, handling) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(besked)}</span>`;
  if (handling) {
    const knap = document.createElement('button');
    knap.className = 'toast-action';
    knap.textContent = handling.label;
    knap.addEventListener('click', () => { el.remove(); handling.run(); });
    el.appendChild(knap);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), handling ? 8000 : 3200);
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

/* Det tema, man rent faktisk SER. "Follow system" er ikke en tredje farve -
   den er lys eller moerk, afhaengigt af maskinen, og knappen i sidebaren skal
   vise vejen til den modsatte af det, oejet ser. */
function visuelTema() {
  const valg = nuvaerendeTema();
  if (valg === 'light' || valg === 'dark') return valg;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  note: '<path d="M6 4.5h8.5L19 9v10.5H6z"/><path d="M14 4.5V9h5"/><path d="M9 13h7M9 16h4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.8"/>',
  // Stjernen. Samme stregtykkelse som resten - den skal loefte opgaven i
  // listen, ikke raabe fra den.
  star: '<path d="M12 4.2l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.19l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6L6.2 6.2"/>',
  moon: '<path d="M20 14.6A8.6 8.6 0 019.4 4 8.6 8.6 0 1020 14.6z"/>',
  pin: '<path d="M9 3.5h6l-1 5 3 3.5H7l3-3.5z"/><path d="M12 12v8.5"/>',
  out: '<path d="M14.5 4.5H18a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-3.5"/><path d="M4.5 12h10M11 8.5l3.5 3.5-3.5 3.5"/>',
  link: '<path d="M10.5 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1"/>',
  guide: '<path d="M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v12a2 2 0 00-2-2H4z"/><path d="M20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v12a2 2 0 012-2h6z"/>',
  /* Vinklen paa en foldeknap. Den PEGER: nedad naar afsnittet er aabent,
     og drejes til hoejre af CSS, naar det er foldet sammen. */
  chevron: '<path d="M6 9.5l6 6 6-6"/>',
  // Egen pil - IKKE repeat-ikonet, som i denne app betyder "gentagelse".
  sync: '<path d="M19.5 12a7.5 7.5 0 01-12.9 5.3"/><path d="M4.5 12a7.5 7.5 0 0112.9-5.3"/><path d="M17.5 3v4h-4"/><path d="M6.5 21v-4h4"/>',
  /* Billedruden. ORDRET de samme tre streger som i Sagu - naar den ene app
     viser en Sagu-note, skal knapperne over billedet ikke se ud, som om man
     var landet et fremmed sted (RUNE-ERFARINGER §9e). */
  copy: '<path d="M9 9h10v10a1.5 1.5 0 01-1.5 1.5H9z"/><path d="M15 9V4.5A1.5 1.5 0 0013.5 3H5.5A1.5 1.5 0 004 4.5v9A1.5 1.5 0 005.5 15H9"/>',
  luk: '<path d="M6 6l12 12M18 6L6 18"/>',
  tjek: '<path d="M20 6.5L9.5 17 4 11.5"/>',
  /*
   * Tidtagningen (F10). To ikoner, fordi knappen har to BETYDNINGER, og et
   * ikon, der skifter mening uden at skifte form, er en gaette-leg:
   *   `optag`  - start uret. Cirkel med en fyldt prik, som en optageknap.
   *   `stands` - stop det. Samme cirkel med en firkant i.
   * Prikken og firkanten fyldes af CSS (`.timerbtn svg [data-fyld]`), saa de
   * arver knappens farve i begge temaer i stedet for at have en egen.
   */
  optag: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6" data-fyld/>',
  stands: '<circle cx="12" cy="12" r="8.5"/><rect x="9" y="9" width="6" height="6" rx="1" data-fyld/>',
};

/**
 * Tallet ved et punkt i navigationen.
 *
 * Ét sted, fordi det bruges tre (sidebaren, den foldede sidebar og bundlinjen
 * paa mobil), og et tal, der kun rettes to af stederne, er vaerre end intet.
 *
 * KUN dér, hvor tallet betyder »her er noget at tage stilling til«: Next,
 * Inbox, Waiting For og Someday. Projekter, kontekster, noter, gentagelser og
 * All Tasks er strukturer og oversigter - deres tal aendrer sig sjaeldent og
 * kraever ingenting, og i en menu, hvor alt har et tal, holder man op med at
 * se dem, der betyder noget (Andreas, 26-08-2026). Antallet staar paa selve
 * siden, hvor det er svar paa et spoergsmaal, man lige har stillet.
 *
 * Logbook og Review har aldrig haft et: Logbook vokser for evigt (og staar
 * allerede i toplinjen), og Review er ikke en liste, man kan taelle.
 */
/*
 * Bundlinjen paa mobil viser KUN tal ved Next og Inbox.
 *
 * Seks smaa ikoner paa en telefonbredde, hver med et tal, blev til en raekke
 * badges uden retning - og de fleste af dem taeller noget, man alligevel gaar
 * ind i sidebaren for at se paa. De to her er dem, der siger »der er noget at
 * tage stilling til« (Andreas, 26-08-2026). Sidebaren viser dem alle.
 */
const BUND_TAL = new Set(['next', 'inbox']);

function navAntal(v) {
  return v.tael ? (state.counts[v.tael] || 0) : 0;
}

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------- sider */

// Raekkefoelgen her er ogsaa sidebarens. Handover §6.
const VIEWS = [
  { id: 'next', label: 'Next Actions', icon: 'next', group: 1, tael: 'next' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', group: 1, tael: 'inbox' },
  { id: 'waiting', label: 'Waiting For', icon: 'waiting', group: 2, tael: 'waiting' },
  { id: 'someday', label: 'Someday', icon: 'someday', group: 2, tael: 'someday' },
  { id: 'repeat', label: 'Recurring', icon: 'repeat', group: 2 },
  { id: 'projects', label: 'Projects', icon: 'projects', group: 3 },
  { id: 'contexts', label: 'Contexts', icon: 'contexts', group: 3 },
  // Noter er reference, ikke arbejde - derfor her ved siden af projekter og
  // kontekster, og ikke oppe blandt handlingslisterne.
  { id: 'notes', label: 'Notes', icon: 'note', group: 3 },
  { id: 'log', label: 'Logbook', icon: 'log', group: 4 },
  { id: 'review', label: 'Review', icon: 'review', group: 4 },
  /*
   * Alt, der ikke er afsluttet, i ét billede. De andre lister svarer paa
   * »hvad nu?«; den her svarer paa »hvad har jeg overhovedet?« og er stedet,
   * man leder, naar noget er blevet vaek.
   *
   * Nederst, sammen med Logbook og gennemgangen: den bruges ikke i
   * dagligdagen, og oeverst i menuen trak den opmaerksomhed fra de to lister,
   * man faktisk arbejder i (Andreas, 26-08-2026).
   *
   * Eget ikon og ikke `log`: de to ville staa ved siden af hinanden med samme
   * billede og betyde noget forskelligt.
   *
   * INTET tal i menuen. De andre tal siger »her er noget at tage stilling
   * til«; det her ville bare vaere summen af dem - et stort tal, der aldrig
   * kraever noget, og som trak blikket til det punkt, man netop IKKE skal
   * arbejde i til daglig. Antallet staar paa selve siden, hvor det er svar
   * paa et spoergsmaal, man lige har stillet (Andreas, 26-08-2026).
   */
  { id: 'all', label: 'All Tasks', icon: 'menu', group: 4 },
  // group: 0 = staar IKKE i navigationen. Settings naas fra menuen paa
  // brugerknappen, hvor kontoen i forvejen bor - to indgange til det samme
  // sted er én for meget.
  { id: 'settings', label: 'Settings', icon: 'settings', group: 0 },
  // Guiden naas samme sted som Settings: menuen paa brugerknappen.
  { id: 'guide', label: 'Guide', icon: 'guide', group: 0 },
  // Fokusskaermen naas fra Focus-knappen paa en opgave. Den hoerer ikke i
  // navigationen: uden en opgave i fokus er der ingenting at gaa ind til.
  { id: 'focus', label: 'Focus', icon: 'clock', group: 0 },
];

const viewById = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

// Handover §6: "Pa mobil: de fire-fem vigtigste i bunden, resten i en menu."
// Fangst er ikke med her - den naas fra alle skaerme ved bare at skrive,
// og har sin egen knap i baandet.
const BUND = ['next', 'inbox', 'projects', 'repeat', 'review'];

const BESKRIVELSER = {
  all: 'Everything still open — deadlines first, then newest.',
  next: 'What you can actually do right now, grouped by context.',
  inbox: 'Unprocessed items waiting for clarification.',
  waiting: 'Delegated — you are waiting on someone else.',
  someday: 'Parked without commitment.',
  repeat: 'Your recurring tasks, and when each one is next due.',
  projects: 'Anything that takes more than one step, grouped by area.',
  contexts: 'Where and how a task can be done.',
  notes: 'Everything you keep for reference. Never work you owe anyone.',
  log: 'What you have finished, in chronological order.',
  review: 'The weekly review, step by step.',
  settings: 'Appearance, account and access.',
  guide: 'How doda works — the whole thing, in the order you meet it.',
};

/*
 * Fangst-syntaksen staar bade i Settings og i guiden. Ét sted, ellers driver
 * de fra hinanden - og en legende, der lover mindre end parseren kan, betyder
 * at funktionen i praksis ikke findes (RUNE-ERFARINGER, doda v9).
 *
 * Raekkerne skal matche app/shared/parse.js: + og * er praefikser, # @ / ! ~
 * er markoerer, og " // " skiller beskrivelsen fra.
 */
function syntaksTabel() {
  return `<table class="syntax">
    <tr><td><code>+ text</code></td><td>task (also the default)</td></tr>
    <tr><td><code>* text</code></td><td>note</td></tr>
    <tr><td><code>#context</code></td><td>add a context</td></tr>
    <tr><td><code>@project</code> · <code>/project</code></td><td>file under a project — <code>/"two words"</code></td></tr>
    <tr><td><code>!date</code></td><td><code>!tomorrow</code>, <code>!friday</code>, <code>!3/9</code>, <code>!in 2 weeks</code></td></tr>
    <tr><td><code>~date</code></td><td>hide until that date</td></tr>
    ${/*
      * `%` staar kun, naar tovo er forbundet. Tabellen er en
      * KRAVSPECIFIKATION (guidens regel 1) - en raekke om et ur, der ikke
      * findes, ville vaere et loefte, koden ikke kan holde. Det var praecis
      * det, »/projekt« gjorde i fire versioner.
      */ ''}
    ${state.tovo.connected
    ? '<tr><td><code>%</code></td><td>start the timer in tovo on it right away</td></tr>' : ''}
    <tr><td><code>text // more</code></td><td>everything after <code>//</code> becomes the description</td></tr>
  </table>`;
}

/* ------------------------------------------------------------ optegning */

/** Fuld optegning. Kun ved login/logout - ellers mister kommandobaren fokus. */
function render() {
  const root = document.getElementById('root');
  if (!state.user) { root.innerHTML = gateHtml(); bindGate(); return; }
  root.innerHTML = shellHtml();
  bindShell();
  tegnGennemgangsbaand();
  tegnSide();
}

function gateHtml() {
  const setup = state.config.needsSetup;
  return `
  <div class="gate">
    <div class="card">
      <div class="brand">${icon('logo', 26)} doda</div>
      <p class="lead" style="text-align:center;margin-bottom:22px">
        ${setup ? 'Pick a username and a password, and you are in.' : 'Sign in to continue.'}
      </p>
      <p class="gate-error" id="gateError" hidden></p>
      <form id="gateForm">
        <label class="field"><span>Username</span>
          <input class="input" id="gateUser" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span>
          <input class="input" id="gatePass" type="password"
            autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
        <!-- Andet trin. Skjult, indtil serveren siger, at der er ét mere:
             de fleste logins har det ikke, og et tomt felt, man skal springe
             over, er en gaade hver gang. -->
        <label class="field" id="gateCodeField" hidden><span>Code from your app
          <span class="fieldhint">Six digits — or one of your recovery codes.</span></span>
          <input class="input" id="gateCode" inputmode="text" autocomplete="one-time-code"
            autocapitalize="characters" spellcheck="false"></label>
        <button class="btn primary" type="submit" style="width:100%">
          ${setup ? 'Create account' : 'Sign in'}</button>
      </form>
      ${!setup && state.config.passkeys && state.config.hasPasskeys ? `
        <div class="gate-or"><span>or</span></div>
        <button class="btn" id="gatePasskey" style="width:100%">Sign in with a passkey</button>` : ''}
      ${setup ? '<p class="gate-note">doda is a single-user app. Once this account exists, sign-up closes for good.</p>' : ''}
    </div>
  </div>`;
}

function bindGate() {
  const form = document.getElementById('gateForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('gateError');
    err.hidden = true;
    try {
      const kodeFelt = document.getElementById('gateCodeField');
      const kode = document.getElementById('gateCode');
      const data = await api('POST', state.config.needsSetup ? '/api/register' : '/api/login', {
        username: document.getElementById('gateUser').value,
        password: document.getElementById('gatePass').value,
        code: kode && !kodeFelt.hidden ? kode.value.trim() : undefined,
      });
      /*
       * Kodeordet passede, men der mangler ét trin.
       *
       * Serveren svarer 200 med `needsCode` - ikke en fejl, for der er intet
       * galt. Feltet foldes ud, og markoeren staar i det: den, der lige har
       * tastet sit kodeord, skal ikke ogsaa lede efter, hvor koden skal hen.
       */
      if (data && data.needsCode) {
        kodeFelt.hidden = false;
        kode.focus();
        return;
      }
      state.user = data.user;
      state.config.needsSetup = false;
      if (fortsaetTilConnector()) return;
      await hentState();
      hentSessionsting();
      render();
      // Kommer man fra kalenderen uden at vaere logget ind, skal elementet
      // aabnes NAAR man er - ikke tabes undervejs.
      aabnFraAdressen();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      // Var det KODEN, der var forkert, skal feltet blive staaende - ellers
      // ser det ud, som om kodeordet var galt, og man taster det om.
      if (ex.code === 'bad_code') {
        const kf = document.getElementById('gateCodeField');
        if (kf) { kf.hidden = false; document.getElementById('gateCode').select(); }
      }
    }
  });
  const pk = document.getElementById('gatePasskey');
  if (pk) {
    pk.addEventListener('click', async () => {
      const err = document.getElementById('gateError');
      err.hidden = true;
      try {
        const d = await loginMedPasskey();
        state.user = d.user;
        if (fortsaetTilConnector()) return;
        await hentState();
        hentSessionsting();
        render();
        aabnFraAdressen();
      } catch (ex) {
        // Brugeren afbroed selv - det er ikke en fejl, der skal vises.
        if (ex.name === 'NotAllowedError') return;
        err.textContent = ex.message || 'The passkey did not work';
        err.hidden = false;
      }
    });
  }

  document.getElementById('gateUser').focus();
}

function navHtml() {
  // Slaaet fra betyder: ingen vej IND. Det, der allerede findes, forsvinder
  // ikke - noterne staar stadig paa deres projekt og kan soeges frem.
  const iNav = VIEWS.filter((v) => v.group > 0 && (v.id !== 'notes' || state.notesEnabled));
  const grupper = [...new Set(iNav.map((v) => v.group))];
  return grupper.map((g) => `<nav class="nav">${iNav.filter((v) => v.group === g).map((v) => {
    const antal = navAntal(v);
    return `<button class="nav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon)}<span>${esc(v.label)}</span>
        ${antal ? `<span class="nav-count">${antal}</span>` : ''}
      </button>`;
  }).join('')}</nav>`).join('');
}

function shellHtml() {
  return `
  <button class="btn navtoggle" id="navToggle" aria-label="Menu">${icon('menu')}</button>
  <div class="backdrop" id="backdrop"></div>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${icon('logo', 24)} <span style="flex:1">doda</span>
        <button class="pinbtn" id="pinBtn" aria-label="Hide the menu"
          title="Hide the menu">${icon('pin', 16)}</button></div>
      <div id="navHost">${navHtml()}</div>
      <div class="sidebar-foot">
        <button class="nav-item" id="userBtn"
          ${state.view === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}<span>${esc(visNavn(state.user.username))}</span></button>
        <div class="foot-row" id="footRow">${versionHtml()}${temaKnapHtml()}</div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <!-- Versionslinjen i sidebarens fod har kunnet sige det hele tiden,
             men paa en telefon staar foden BAG hamburgeren, saa man ser den
             aldrig. Beskeden hoerer dér, hvor man er. -->
        <div class="opdater-baand" id="opdaterBaand" hidden>
          ${icon('sync', 15)}
          <span class="baand-tekst"></span>
          <button class="btn" id="opdaterNu">Update</button>
        </div>
        <div class="offline-mark meta" id="offlineMark" hidden></div>
        <div class="toprow">
          <button class="syncbtn meta" id="syncBtn" title="Sync now" aria-label="Sync now">
            ${icon('sync', 14)}<span id="syncLabel">just now</span></button>
          <div class="stats meta" id="statsHost">${statsHtml()}</div>
        </div>
        <div class="omni-card" id="omniCard">
          <div class="omni-field">
            <span class="omni-icon">${icon('search', 22)}</span>
            <span class="omni-mode" id="omniMode" hidden></span>
            <input class="omni-input" id="omni" autocomplete="off" spellcheck="false"
              placeholder="Just type to Capture, Navigate and Find">
          </div>
          <div class="omni-panel" id="omniPanel" hidden></div>
          <div class="omni-legend meta" id="omniLegend"></div>
        </div>
        <div class="omni-chips" id="omniChips"></div>
      </div>
      <div id="reviewNudge"></div>
      <div id="pageHost"></div>
    </main>
  </div>
  <nav class="toc" id="tocRail" aria-label="On this page" hidden></nav>
  <div class="capturehint"><span class="key">A</span><span class="meta">type to capture</span></div>
  <nav class="bottomnav" id="bottomNav">
    ${BUND.map((id) => {
    const v = viewById(id);
    const antal = BUND_TAL.has(v.id) ? navAntal(v) : 0;
    return `<button class="bottomnav-item" data-view="${v.id}" ${v.id === state.view ? 'aria-current="page"' : ''}>
        ${icon(v.icon, 21)}<span>${esc(v.label.split(' ')[0])}</span>
        ${antal ? `<span class="bottomnav-count">${antal}</span>` : ''}
      </button>`;
  }).join('')}
    <button class="bottomnav-item" id="bottomCapture" aria-label="Capture">
      ${icon('plus', 21)}<span>Capture</span></button>
  </nav>`;
}

/*
 * Versionen, altid synlig. Det er SAMME tal som runens version: i panelet -
 * build_rune.py stempler APP_VERSION i index.html, sw.js og runen pa én gang.
 *
 * Serveren melder sit eget tal med i /api/public-config. Er de to forskellige,
 * er app.js i browserens cache aeldre end den, serveren udleverer, og sa er
 * det dét, brugeren skal vide - ikke versionsnummeret alene.
 */
/**
 * Baandet »der er kommet en ny version«.
 *
 * Samme kilde som versionslinjen: serverens tal fra `/api/public-config` mod
 * den `APP_VERSION`, der er bagt ind i den app.js, browseren koerer. Er de
 * forskellige, sidder der en gammel fil i cachen.
 */
function visOpdaterBaand() {
  const b = document.getElementById('opdaterBaand');
  if (!b) return;
  const server = state.config && state.config.version;
  const ny = server && server > APP_VERSION;
  b.hidden = !ny;
  if (!ny) return;
  const t = b.querySelector('.baand-tekst');
  if (t) {
    t.innerHTML = `<strong>doda v${esc(String(server))} is ready.</strong> `
      + `You are running v${esc(String(APP_VERSION))}. Updating reloads the app.`;
  }
}

/**
 * Spoerger serveren, om der er kommet noget nyt.
 *
 * Kaldes naar fanen kommer FREM igen - det er dét oejeblik, en telefon vender
 * tilbage til appen efter en opdatering paa serveren. Uden det ville beskeden
 * foerst dukke op ved naeste genindlaesning, og saa er den overfloedig.
 *
 * Fejler kaldet, sker der ingenting: man er formentlig offline, og saa er en
 * ny version det mindste af det.
 */
async function tjekVersion() {
  try {
    const c = await api('GET', '/api/public-config');
    if (!state.config) state.config = {};
    state.config.version = c.version;
    visOpdaterBaand();
  } catch { /* offline - offline-maerket siger det selv */ }
}

function versionHtml() {
  const server = state.config.version;
  /* Kun NYERE taeller. `!==` var forkert den ene vej: er serverens tal
     LAVERE end det, browseren koerer - en rullet udgivelse, eller en
     serverproces, der ikke er genstartet - stod der »v45 available« ved
     siden af v46, og det er vaas (samme fejl fandt Sagu i sin F17). */
  const gammel = server && server > APP_VERSION;
  if (gammel) {
    return `<button class="version-line meta version-old" id="versionBtn"
      title="Your browser is running v${APP_VERSION}, but the server has v${server}. Click to reload.">
      v${APP_VERSION} · v${server} available — reload</button>`;
  }
  return `<div class="version-line meta">v${esc(String(APP_VERSION))}</div>`;
}

/* Ét klik mellem lyst og moerkt, uden at gaa i Settings. Knappen viser det
   tema, man skifter TIL - ikke det, man er i. Alle tre valg (inklusive
   "Follow system") bliver staaende under Settings. */
function temaKnapHtml() {
  const naeste = visuelTema() === 'dark' ? 'light' : 'dark';
  return `<button class="temabtn" id="temaBtn" data-naeste="${naeste}"
    aria-label="Switch to ${naeste} theme" title="Switch to ${naeste} theme">
    ${icon(naeste === 'dark' ? 'moon' : 'sun', 16)}</button>`;
}

/* Temaet kan skiftes to steder (her og i Settings), og knappen skal foelge
   med begge veje - ellers viser den vej til det tema, man allerede er i. */
function opdaterTemaKnap() {
  const gammel = document.getElementById('temaBtn');
  if (!gammel) return;
  gammel.outerHTML = temaKnapHtml();
  bindTemaKnap();
}

function bindTemaKnap() {
  const el = document.getElementById('temaBtn');
  if (!el) return;
  el.addEventListener('click', () => {
    anvendTema(el.dataset.naeste);
    opdaterTemaKnap();
    // Er man PAA indstillingssiden, skal de tre knapper der ogsaa foelge med.
    if (state.view === 'settings') tegnSide();
  });
}

function statsHtml() {
  const c = state.counts;
  const dele = [];
  if (c.inbox) dele.push(`${c.inbox} captured`);
  if (c.next) dele.push(`${c.next} next`);
  dele.push(`${state.projects.length} projects`);
  /* En taeller, der kun kan vokse, er for nogle en paamindelse og for andre
     stoej. Andreas bad om at kunne slaa den fra 25-08-2026 - KUN tallet i
     toplinjen; Logbook og Done-afsnittene bliver staaende. */
  if (c.done && !state.hideDone) dele.push(`${c.done} done`);
  return dele.map((d) => `<span>${esc(d)}</span>`).join('');
}

/* Et roligt baand, ikke en advarsel. Ingen roed farve, ingen tvang - og det
   kan lukkes for i dag med ét klik (handover princip 1). */
function tegnGennemgangsbaand() {
  const host = document.getElementById('reviewNudge');
  if (!host) return;
  let lukket = null;
  try { lukket = localStorage.getItem('doda_review_nudge'); } catch { /* privat */ }
  if (!state.reviewDue || state.view === 'review' || lukket === state.today) { host.innerHTML = ''; return; }

  const dag = new Date(`${state.today}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
  host.innerHTML = `<div class="nudge review-nudge">${icon('review', 17)}
    <span>It is ${esc(dag)} — the day you set aside for your weekly review.</span>
    <button class="btn ghost" id="nudgeGo">Start</button>
    <button class="btn ghost" id="nudgeNo">Not now</button></div>`;
  host.querySelector('#nudgeGo').addEventListener('click', () => gaaTil('review'));
  host.querySelector('#nudgeNo').addEventListener('click', () => {
    try { localStorage.setItem('doda_review_nudge', state.today); } catch { /* privat */ }
    host.innerHTML = '';
  });
}

function opdaterNav() {
  const host = document.getElementById('navHost');
  if (host) { host.innerHTML = navHtml(); bindNav(); }
  // Settings staar ikke i navigationen laengere - brugerknappen er indgangen,
  // og saa skal den ogsaa vise, naar man er der. Ellers er INTET markeret.
  const bruger = document.getElementById('userBtn');
  if (bruger) {
    if (state.view === 'settings') bruger.setAttribute('aria-current', 'page');
    else bruger.removeAttribute('aria-current');
  }
  // Bundlinjen har sin egen markering af den aktive side og sit eget tal.
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    if (el.dataset.view === state.view) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
    const t = el.querySelector('.bottomnav-count');
    const v = viewById(el.dataset.view);
    const antal = BUND_TAL.has(v.id) ? navAntal(v) : 0;
    if (t && !antal) t.remove();
    else if (t) t.textContent = antal;
    else if (antal) el.insertAdjacentHTML('beforeend', `<span class="bottomnav-count">${antal}</span>`);
  });
  const stats = document.getElementById('statsHost');
  if (stats) stats.innerHTML = statsHtml();
  opdaterIkonTal();
}

/*
 * Tallet paa app-ikonet - Next Actions, som Todoist viser sine (Andreas,
 * 25-09-2026).
 *
 * Det saettes HER, fordi opdaterNav er dér, alle taellere ender: efter
 * hentState, efter en ny opgave, efter en fuldfoert. Mens doda er lukket,
 * bringer pushen tallet med sig (`app_badge`, se push.js) - andre veje har
 * en webapp paa iOS ikke.
 *
 * iOS kraever, at notifikationer er tilladt; ellers afvises kaldet stille.
 * Det samme tal to gange i traek sendes ikke igen.
 */
let sidsteIkonTal = null;
function opdaterIkonTal() {
  if (!('setAppBadge' in navigator) || !state.user) return;
  const n = state.appBadge ? (state.counts.next || 0) : 0;
  if (n === sidsteIkonTal) return;
  sidsteIkonTal = n;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => { sidsteIkonTal = null; });
}

function bindNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
}

function bindShell() {
  bindNav();
  document.getElementById('userBtn').addEventListener('click', visBrugerMenu);
  document.getElementById('syncBtn').addEventListener('click', () => synk(true));
  saetNavSkjult(navErSkjult());
  document.getElementById('pinBtn').addEventListener('click', () => {
    const skjul = !document.body.classList.contains('navskjult');
    saetNavSkjult(skjul);
    // Foldes den vaek, mens man staar i den, skal overlayet ogsaa lukke.
    if (skjul) document.body.classList.remove('navopen');
  });
  document.querySelectorAll('.bottomnav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => gaaTil(el.dataset.view));
  });
  // "Fangst skal kunne naas fra alle skaerme med ét tryk" (handover §6).
  document.getElementById('bottomCapture').addEventListener('click', () => {
    const o = omniEl();
    if (o) { o.scrollIntoView({ block: 'start' }); o.focus(); }
  });
  // Er serverens version nyere end den indlaeste, sidder der en gammel
  // app.js i service workerens cache. Ryd den FOER genindlaesningen -
  // ellers serverer den bare den samme gamle fil igen.
  bindTemaKnap();
  const bNu = document.getElementById('opdaterNu');
  if (bNu) {
    bNu.addEventListener('click', async () => {
      bNu.disabled = true;
      bNu.textContent = 'Updating…';
      // Samme oprydning som versionslinjen: uden den serverer service
      // workeren bare den samme gamle app.js igen.
      try {
        if (navigator.serviceWorker) {
          const alle = await navigator.serviceWorker.getRegistrations();
          for (const r of alle) await r.update();
        }
        if (window.caches) await Promise.all((await caches.keys()).map((n2) => caches.delete(n2)));
      } catch { /* uden cache-api er der ikke noget at rydde */ }
      location.reload();
    });
  }

  const vBtn = document.getElementById('versionBtn');
  if (vBtn) {
    vBtn.addEventListener('click', async () => {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage('ryd');
        }
        if (window.caches) await Promise.all((await caches.keys()).map((n) => caches.delete(n)));
      } catch { /* uden cache-api er der ikke noget at rydde */ }
      location.reload();
    });
  }
  document.getElementById('navToggle').addEventListener('click', () => document.body.classList.toggle('navopen'));
  document.getElementById('backdrop').addEventListener('click', () => document.body.classList.remove('navopen'));
  bindOmni();
  registrerRullevagt();
  registrerBilledvagt();
}

/*
 * Rulning: SPOERG efter containeren, gaa aldrig ud fra vinduet.
 *
 * Under mobilgraensen er det BODY, der scroller: `html, body { overflow-x:
 * hidden }` (nettet mod vandret scroll) og `height: 100%` goer tilsammen body
 * til en scroll-boks (DESIGN §6c). Saa er `window.scrollY` altid 0, og
 * `window.scrollTo()` goer ingenting - netop paa telefonen.
 *
 * Det ramte to ting stille: traek-for-at-genindlaese troede, ethvert traek kom
 * fra toppen, og »op til toppen ved sideskift« virkede slet ikke, saa man
 * landede midt i den nye side.
 *
 * Begge saetter/laeser alle tre. Det er billigere end at gaette rigtigt.
 */
const rulletNed = () => Math.max(
  window.scrollY || 0,
  document.body.scrollTop || 0,
  document.documentElement.scrollTop || 0,
);

function tilToppen() {
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}

/*
 * Eksterne links, naar doda koerer som app paa hjemmeskaermen.
 *
 * iOS aabner IKKE `target="_blank"` fra en PWA i standalone: linket ser
 * rigtigt ud, man trykker, og der sker INGENTING - hverken i appen eller i
 * Safari. Andreas fandt det 24-08-2026 paa Notes-skaermens Sagu-kort, men det
 * gjaldt ALLE tolv eksterne links i doda; de andre var bare ikke blevet
 * proevet fra telefonen.
 *
 * ÉN delegeret lytter frem for en handler pr. link: siderne tegnes om hele
 * tiden, og et link, der bliver tilfoejet i morgen, skal virke, uden at nogen
 * husker at binde det.
 *
 * `href` og `target` bliver staaende. De giver hoejrekliksmenuen, »aabn i ny
 * fane« og en adresse, man kan se - og i en almindelig browser er det dem,
 * der goer arbejdet. Lytteren roerer kun sagen, hvor browseren giver op.
 */
const iStandalone = () => window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

document.addEventListener('click', (e) => {
  if (!iStandalone()) return;
  const a = e.target.closest && e.target.closest('a[target="_blank"]');
  if (!a || !a.href) return;
  // Kun http(s). `mailto:` og `tel:` skal gaa deres egen vej - dem klarer
  // systemet selv, ogsaa i standalone.
  if (a.protocol !== 'http:' && a.protocol !== 'https:') return;
  e.preventDefault();
  const vindue = window.open(a.href, '_blank', 'noopener');
  /*
   * Sidste udvej. Bliver ogsaa `window.open` afvist, er det bedre at gaa
   * derhen i appen end at lade knappen vaere doed - man kan swipe tilbage.
   */
  if (!vindue) window.location.href = a.href;
});

/**
 * »body.rullet« - er siden rullet ned?
 *
 * Bjaelken klaeber (v57), men en bjaelke, der bare klaeber, tager en femtedel
 * af en telefonskaerm med sig ned gennem hele listen. Naar der er rullet,
 * folder alt andet end selve feltet sig sammen: tallene og legenden laeser man
 * én gang, feltet vil man kunne naa hele tiden. Andreas bad om det
 * 23-08-2026 med Sagu som forbillede - Sagu loeste det samme oenske i F20.
 *
 * Observeren sidder paa VAGTPOSTEN, ikke paa bjaelken selv: en observer paa et
 * element, der ER sticky, udloeser aldrig - det forlader jo aldrig skaermen.
 *
 * Vagten staar FOER bjaelken. Naar bjaelken folder sig sammen, rykker alt
 * EFTER den op - stod vagten under, kunne den komme til syne igen af selve
 * sammenfoldningen og saette klassen i et blink frem og tilbage.
 */
/*
 * To taerskler, ikke én. Uden dem FLIMRER siden.
 *
 * Folder bjaelken sig sammen, bliver dokumentet kortere - den vinder jo plads.
 * Er der mindre tilbage at rulle i end den hoejde, bjaelken lige gav slip paa,
 * tvinger browseren rullepositionen op igen, klassen ryger af, bjaelken vokser,
 * og saa forfra. Andreas saa det som »hele billedet flimrer, som om den gaar i
 * hak« 26-08-2026 - paa en kort side med fire opgaver, hvor der var praecis 0
 * px tilbage at rulle i, mens bjaelken gav 60 px slip.
 *
 * Derfor skal AFSTANDEN mellem de to taerskler vaere stoerre end det, bjaelken
 * krymper (60 px paa desktop, 93 px paa mobil). Saa kan browserens justering
 * ikke naa ned under den nedre, og loekken er brudt.
 *
 * En `IntersectionObserver` paa en vagtpost kan ikke det her: den har ét
 * skifte, ikke to. Og en rulle-lytter er nu forsvarlig, fordi `rulletNed()`
 * ved, hvem der ruller (§6c) - det var netop dét, der gjorde den skroebelig,
 * da vagtposten blev valgt.
 */
const RULLET_TIL = 120;   // folder sammen efter saa mange px
const RULLET_FRA = 8;     // og folder foerst ud igen her
/*
 * Og kun hvis der er RIGELIGT at rulle i.
 *
 * To taerskler alene raekker ikke: paa en kort side kan man aldrig naa de 120
 * px, og saa foldede bjaelken sig aldrig sammen. Maalt paa en side med fire
 * opgaver var der 29 px at rulle i, mens bjaelken gav 60 px slip.
 *
 * 200 px er stoerre end det, bjaelken krymper (60 paa desktop, 93 paa mobil),
 * plus den oevre taerskel. Er der mindre, er der heller ikke plads at vinde -
 * og saa er det rigtige svar at lade bjaelken staa.
 */
const RULLET_PLADS = 200;

function registrerRullevagt() {
  let rullet = false;
  const rulleplads = () => Math.max(
    document.body.scrollHeight, document.documentElement.scrollHeight,
  ) - window.innerHeight;

  const tjek = () => {
    const y = rulletNed();
    if (!rullet && y > RULLET_TIL && rulleplads() > RULLET_PLADS) {
      rullet = true;
      document.body.classList.add('rullet');
    } else if (rullet && y < RULLET_FRA) {
      rullet = false;
      document.body.classList.remove('rullet');
    }
  };
  // Begge: under mobilgraensen er det body, der ruller, ellers vinduet (§6c).
  window.addEventListener('scroll', tjek, { passive: true });
  document.body.addEventListener('scroll', tjek, { passive: true });
  tjek();
}

/*
 * At gaa til en skaerm betyder at se den REN.
 *
 * Nulstillingen laa foer bag `if (skifter)`, og det gjorde et projekt til en
 * blindgyde: staar man inde i ét, er `state.view` allerede 'projects', saa
 * hverken sidebaren eller »← Projects« aendrede noget - `openProject` blev
 * staaende, og siden tegnede sig selv igen. Der skete tilsyneladende
 * ingenting. Samme fejl ramte et kontekstfilter i Next Actions og et
 * projektfilter i logbogen.
 *
 * Reglen nu: gaaTil() rydder ALTID undertilstanden, og `opt` saetter det, der
 * er ment. Et filter er noget, man vaelger - ikke noget, man arver.
 */
function gaaTil(view, opt) {
  const skifter = state.view !== view;
  // Var der noget at rydde, er skaermen aendret, selv om `view` er den samme.
  const havdeFilter = !!(state.openProject || state.filterContext
    || state.filterArea || state.logProject);
  state.view = view;
  state.openProject = null;
  state.filterContext = null;
  state.filterArea = null;
  state.logProject = null;
  if (opt && opt.context !== undefined) state.filterContext = opt.context;
  if (opt && opt.area !== undefined) state.filterArea = opt.area;
  document.body.classList.remove('navopen');
  opdaterNav();
  tegnGennemgangsbaand();
  tegnSide();
  // Scroll kun til toppen ved reelt sideskift - ellers kastes brugeren op,
  // hver gang en inline-redigering gentegner (RUNE-ERFARINGER §4).
  if (skifter || havdeFilter) tilToppen();
}

/** Henter state og gentegner NAV og SIDE, men aldrig hele skallen. */
async function genindlaes() {
  await hentState();
  opdaterNav();
  tegnGennemgangsbaand();
  await tegnSide();
}

/**
 * Det, der hentes ÉN gang pr. session - ikke ved hver optegning.
 *
 * Begge ting er ja/nej-spoergsmaal til en anden app, og begge styrer, om der
 * overhovedet er en knap: Sagu giver `*` en raekke mere i paletten, tovo
 * giver opgaverne deres optageknap.
 *
 * Helperen findes, fordi der er TRE veje ind i en session - opstart med en
 * gyldig cookie, kodeordslogin og passkey-login - og de to sidste havde ikke
 * kaldet noget af det. Efter et frisk login manglede baade Sagu-raekken og
 * tidtagningen, indtil man genindlaeste siden; og det ser ud som en fejl i
 * forbindelsen, ikke som en manglende linje. Ét sted at kalde fra, saa en
 * fjerde vej ind ikke kan glemme den ene af dem.
 *
 * Ingen `await`: en fremmed server, der ikke svarer, maa ikke kunne holde
 * appen tilbage. Begge tegner selv det, de skal, naar svaret kommer.
 */
function hentSessionsting() {
  if (!state.user) return;
  tjekSagu();
  hentTovo();
}

async function hentState() {
  try {
    const d = await api('GET', '/api/v1/state');
    state.contexts = d.contexts;
    state.projects = d.projects;
    state.areas = d.areas || [];
    state.counts = d.counts;
    state.today = d.today;
    state.reviewDue = d.reviewDue;
    if (d.notesEnabled !== undefined) state.notesEnabled = d.notesEnabled;
    if (d.noteCount !== undefined) state.noteCount = d.noteCount;
    if (d.hideDone !== undefined) state.hideDone = d.hideDone;
    if (d.appBadge !== undefined) state.appBadge = d.appBadge;
    opdaterIkonTal();
  } catch (ex) {
    if (ex.status !== 401) toast(ex.message);
  }
}

/* ------------------------------------------------------------- tovo */

/*
 * Broen til tidsregistreringen (F10).
 *
 * Reglerne, det hele hviler paa:
 *
 *  - **Ét kald, ikke ét pr. raekke.** Den koerende timer hentes én gang og
 *    ligger i `state.tovo.timer`. Listerne slaar op i den; de spoerger
 *    aldrig selv.
 *  - **Ikonet viser TILSTAND.** tovo tillader kun ÉN koerende timer
 *    (databasen haandhaever det), saa et tryk paa opgave B stopper uret paa
 *    A. Det skal kunne ses FOER man trykker, ellers er knappen en faelde.
 *  - **Timeren gaar aldrig i offline-koen.** En »start«, der sendes 40
 *    minutter senere, registrerer et forkert starttidspunkt og ser rigtig
 *    ud. Uden net siger vi det i stedet.
 */

/** Koerer der en timer, og er det paa DENNE doda-opgave? */
function tovoKoererPaa(item) {
  const t = state.tovo.timer;
  return !!(t && item && item.tovo_task_id && t.taskId === item.tovo_task_id);
}

/** Skal opgaven overhovedet have en knap? Noter er reference, ikke arbejde. */
function tovoKanTage(item) {
  // `dropped` taeller med som afsluttet. Focus-knappen ved siden af ser kun
  // efter `done` - men en droppet opgave er ogsaa faerdig, og en optageknap
  // paa noget, man har besluttet ikke at lave, er et tilbud om at gore det
  // forkerte.
  return !!(state.tovo.connected && item && item.kind === 'task'
    && item.status !== 'done' && item.status !== 'dropped');
}

/**
 * Knappen, i den tilstand opgaven er i.
 *
 * Tre tilstande, tre forklaringer - `title` er ikke pynt her, den er det
 * eneste sted, den anden opgaves navn kan staa.
 */
function timerKnapHtml(item, stoerrelse = 15, ekstraKlasse = '') {
  if (!tovoKanTage(item)) return '';
  const denne = tovoKoererPaa(item);
  const anden = !denne && state.tovo.timer;
  const klasse = `timerbtn${denne ? ' koerer' : ''}${anden ? ' optaget' : ''}${ekstraKlasse ? ` ${ekstraKlasse}` : ''}`;
  const titel = denne ? 'Stop the timer'
    : anden ? `Start the timer — this stops "${state.tovo.timer.title}"`
      : 'Start the timer';
  // Stoerrelse og ekstra klasse haenger PAA knappen, saa `opdaterTimerIkoner`
  // kan tegne den samme knap igen uden at kende kaldsstedet.
  return `<button class="${klasse}" data-timer="${esc(item.id)}" data-stop
    data-timer-str="${stoerrelse}" data-timer-klasse="${esc(ekstraKlasse)}"
    aria-label="${esc(titel)}" title="${esc(titel)}">${icon(denne ? 'stands' : 'optag', stoerrelse)}${
  denne ? `<span class="timertid" data-timertid>${esc(forloebet())}</span>` : ''}</button>`;
}

/**
 * Opgaven bag et `data-timer`-id.
 *
 * Fokusskaermen er den ene flade, hvor opgaven IKKE staar i `state.items`:
 * den henter kun den aktuelle skaerms elementer, og fokus overlever, at man
 * navigerer vaek (det er hele pointen med den). `fokus` baerer derfor selv
 * det, knappen skal bruge - og en opgave i fokus er pr. definition en aaben
 * opgave, saa der er ikke en status at slaa op.
 */
function timerItemFor(id) {
  const fra = state.items.find((x) => x.id === id);
  if (fra) return fra;
  if (fokus.itemId !== id) return null;
  return { id, kind: 'task', status: 'next', tovo_task_id: fokus.tovoTaskId || null };
}

/**
 * Minutter som »2h 15m«.
 *
 * FORMATERING, ikke udregning. Tallet kommer faerdigt fra tovo, som har
 * afrundet det efter sin egen indstilling; doda skriver det bare paa engelsk.
 * Det er derfor ikke en anden sandhed - der regnes ikke noget her.
 */
function visMinutter(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  const t = Math.floor(n / 60);
  const rest = n % 60;
  if (!t) return `${rest}m`;
  return rest ? `${t}h ${rest}m` : `${t}h`;
}

/**
 * Henter den registrerede tid og skriver den ind i en aaben rude.
 *
 * ÉT kald, naar ruden aabnes - aldrig pr. raekke i en liste. Og kun naar
 * opgaven overhovedet har et modstykke i tovo: har den ikke, er der ingen
 * maaling at vise, og »0m« ville se ud som en.
 *
 * Fejler kaldet, sker der ingenting. En rude, der aabner med en roed besked,
 * fordi en anden server ikke svarede, er vaerre end en rude uden et tal.
 */
async function hentForbrug(item, vaert) {
  if (!vaert || !state.tovo.connected || !item.tovo_task_id) return;
  try {
    const d = await api('GET', `/api/v1/tovo/spent?id=${encodeURIComponent(item.id)}`);
    if (d.minutes === null || d.minutes === undefined) return;
    // Ruden kan vaere lukket imens - saa er der ikke noget at skrive i.
    if (!vaert.isConnected) return;
    const koerer = tovoKoererPaa(item);
    vaert.textContent = `${visMinutter(d.minutes)} tracked in tovo${koerer ? ' — running now' : ''}`;
    vaert.hidden = false;
  } catch { /* en tovo, der ikke svarer, maa ikke kunne spolere ruden */ }
}

/** Sekunder siden start, som ur. Samme form som fokusuret, saa de to stemmer. */
function forloebet() {
  const t = state.tovo.timer;
  if (!t) return '';
  return fokusUr(Math.max(0, Math.floor(Date.now() / 1000 - t.startedAt)));
}

/**
 * Start eller stop - ét sted, saa raekken, ruden og fokusskaermen ikke kan
 * komme til at goere hver sit.
 */
/**
 * Stopper uret. UBETINGET - ingen vurdering af, hvad der koerer.
 *
 * Egen funktion, fordi `slaaTimer` er en VIPPE: den afgoer ud fra tilstanden,
 * om der skal startes eller stoppes. Kalder man den et sted, hvor tilstanden
 * er ryddet, gaetter den forkert og STARTER et ur. Det skete i `stopFokus`,
 * som nulstiller `fokus`, foer den beder om at stoppe - og saa kunne »Stop«
 * paa fokuslinjen saette tidtagningen i gang i stedet (fundet ved at laese
 * min egen diff, 18-09-2026).
 *
 * Reglen: er svaret »stop« allerede afgjort af kaldsstedet, saa brug DEN
 * her. En vippe skal kun bruges, hvor man faktisk mener »skift«.
 */
async function stopTimerNu() {
  try {
    await api('POST', '/api/v1/tovo/stop', {});
    state.tovo.timer = null;
    toast('Timer stopped — the task stays open');
  } catch (ex) {
    toast(erNetvaerksfejl(ex)
      ? 'No connection — the timer is still running in tovo.'
      : ex.message);
  }
  opdaterTimerIkoner();
  tegnFokus();
}

async function slaaTimer(itemId) {
  const item = timerItemFor(itemId);
  const stopper = item ? tovoKoererPaa(item) : false;
  try {
    if (stopper) {
      await api('POST', '/api/v1/tovo/stop', {});
      state.tovo.timer = null;
      toast('Timer stopped — the task stays open');
    } else {
      const d = await api('POST', '/api/v1/tovo/start', { id: itemId });
      state.tovo.timer = d.timer;
      // Foerste gang paa en opgave far den sit modstykke i tovo. Uden at
      // skrive id'et tilbage i den liste, vi allerede har tegnet, ville
      // ikonet ikke kunne se, at det er DENNE opgave, der koerer.
      const raekke = state.items.find((x) => x.id === itemId);
      if (raekke && d.taskId) raekke.tovo_task_id = d.taskId;
      if (fokus.itemId === itemId && d.taskId) fokus.tovoTaskId = d.taskId;
      toast(d.stopped ? 'Timer started — the one that was running has been stopped' : 'Timer started');
    }
  } catch (ex) {
    // Netvaerksfejl faar IKKE en plads i koen (se ovenfor) - kun en aerlig
    // besked. Alt andet er tovos egen, og den siger allerede hvorfor.
    toast(erNetvaerksfejl(ex)
      ? 'No connection — a timer has to be started while you are online.'
      : ex.message);
  }
  opdaterTimerIkoner();
  tegnFokus();
}

/**
 * Henter den koerende timer og tegner ikonerne om.
 *
 * Kaldes ved opstart og hver gang fanen kommer frem. tovo har SSE og opdager
 * selv en timer startet fra telefonen; doda har ikke, og en poll ville koste
 * en rundtur i minuttet doegnet rundt for noget, der kun betyder noget, naar
 * man kigger. `visibilitychange` er svaret.
 */
async function hentTovo() {
  const varForbundet = state.tovo.connected;
  try {
    const d = await api('GET', '/api/v1/tovo/timer');
    state.tovo.connected = !!d.connected;
    state.tovo.timer = d.timer || null;
    state.tovo.url = d.url || '';
    state.tovo.projects = d.projects || [];
  } catch {
    /*
     * En tovo, der ikke svarer, giver ingen fejlbesked: kaldet sker ved hver
     * opstart og hvert faneskift, og en roed besked dér ville vaere stoej om
     * noget, brugeren ikke bad om.
     *
     * Og den kendte timer ryddes IKKE. Det var den foerste udgave, og den var
     * forkert: tovo koerer stadig sin tidtagning - det er kun forbindelsen,
     * der er vaek - saa et ikon, der falder tilbage til »ingenting koerer«,
     * lyver. Vaerre: naeste tryk ville saa vaere en START paa en opgave, der
     * allerede loeb, og tovo ville lukke posten og aabne en ny. Én
     * tidtagning blev til to.
     *
     * Det, vi sidst vidste, er stadig det rigtige svar - og uret taeller fra
     * et starttidspunkt, saa tallet bliver ved med at passe.
     */
  }
  tikTimer();
  // En fokus-session, der er genskabt fra localStorage, kender endnu ikke sin
  // tovo-opgave. Nu er svaret her.
  tovoKnytFokus();
  /*
   * Skiftede svaret paa »er tovo forbundet«, er det ikke nok at rette de
   * knapper, der staar - der staar ingen. Siden blev tegnet, FOER svaret kom
   * (kaldet venter vi med vilje ikke paa), og `opdaterTimerIkoner()` kan kun
   * rette noget, der allerede findes. Uden den her gren dukkede ikonerne
   * foerst op ved naeste sideskift.
   */
  if (state.tovo.connected !== varForbundet && state.user && document.getElementById('pageHost')) {
    tegnSide();
    return;
  }
  opdaterTimerIkoner();
}

/**
 * Retter ikonerne i den side, der allerede staar - i stedet for at tegne
 * hele siden om.
 *
 * En fuld optegning ville sende fokus tilbage til toppen og lukke en aaben
 * inline-redigering, hver gang et svar fra tovo landede. Samme greb som
 * tovos egen `opdaterStjerneKnapper()`.
 */
function opdaterTimerIkoner() {
  document.querySelectorAll('[data-timer]').forEach((el) => {
    const id = el.dataset.timer;
    const item = timerItemFor(id);
    if (!item) return;
    const ny = timerKnapHtml(item, Number(el.dataset.timerStr || 15), el.dataset.timerKlasse || '');
    if (!ny) { el.remove(); return; }
    const skabelon = document.createElement('div');
    skabelon.innerHTML = ny;
    const frisk = skabelon.firstElementChild;
    // Kun klasse, tekst og indhold skiftes. Erstattede vi HELE knappen, ville
    // dens hændelseslytter forsvinde med den, og der ville staa et ikon uden
    // en knap bagved (Sagu, 21-08-2026).
    el.className = frisk.className;
    el.title = frisk.title;
    el.setAttribute('aria-label', frisk.getAttribute('aria-label'));
    el.innerHTML = frisk.innerHTML;
  });
}

/*
 * Sekunderne paa en koerende knap.
 *
 * Ét interval for hele appen, ikke ét pr. knap - og det STOPPES, naar der
 * ikke koerer noget. En timer, der tikker videre uden noget at vise, er den
 * slags, man opdager som et fladt batteri.
 */
let timerTik = null;
function tikTimer() {
  clearInterval(timerTik);
  timerTik = null;
  if (!state.tovo.timer) return;
  timerTik = setInterval(() => {
    if (!state.tovo.timer) { clearInterval(timerTik); timerTik = null; return; }
    const tekst = forloebet();
    document.querySelectorAll('[data-timertid]').forEach((el) => { el.textContent = tekst; });
  }, 1000);
}

/** Binder knapperne i den side, der lige er tegnet. */
function bindTimerKnapper(rod) {
  (rod || document).querySelectorAll('[data-timer]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      slaaTimer(el.dataset.timer);
    });
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user && state.tovo.connected) hentTovo();
});

/* ------------------------------------------------------ sidebaren */

/*
 * Sidebaren kan foldes helt vaek, sa der kun staar en hamburger tilbage
 * (som i tingdo). Skjult ligger den som et overlay over indholdet i stedet
 * for at skubbe det - ellers ville hele siden hoppe, hver gang man kiggede
 * i menuen.
 *
 * Valget huskes. Pa mobil styrer mediegraensen det i forvejen, og der
 * roerer flaget ingenting.
 */
function navErSkjult() {
  try { return localStorage.getItem('doda_nav_skjult') === '1'; } catch { return false; }
}

function saetNavSkjult(skjult) {
  try { localStorage.setItem('doda_nav_skjult', skjult ? '1' : '0'); } catch { /* privat */ }
  document.body.classList.toggle('navskjult', skjult);
  if (!skjult) document.body.classList.remove('navopen');
  // Brugermenuen haenger fast pa brugerknappen. Foldes sidebaren vaek, mens
  // menuen staar aaben, ville den blive svaevende tilbage over ingenting.
  const menu = document.getElementById('userMenu');
  if (menu) menu.remove();
  const knap = document.getElementById('pinBtn');
  if (knap) {
    const tekst = skjult ? 'Keep the menu open' : 'Hide the menu';
    knap.setAttribute('aria-label', tekst);
    knap.title = tekst;
    knap.classList.toggle('off', skjult);
  }
}

/* ----------------------------------------------------- foldegrupper */

/*
 * »Hvilke gruppeoverskrifter er foldet sammen?«
 *
 * Samme slags valg som sidebaren og `faerdigeFoldet()`: en vane ved DENNE
 * skaerm, ikke en indstilling der skal folge med til telefonen. Derfor
 * localStorage, ikke serveren.
 *
 * Vi gemmer de SAMMENFOLDEDE navne - ikke de udfoldede. Sa dukker en ny
 * kontekst (eller et nyt omraade) altid op udfoldet: det, man lige har
 * lavet, skal kunne ses uden at man forst skal finde ud af, hvor det gemte
 * sig. Og forsvinder en kontekst, ligger dens navn bare tilbage uden at
 * skygge for noget.
 */
function foldedeGrupper(noegle) {
  try {
    const raa = JSON.parse(localStorage.getItem(`doda_fold_${noegle}`) || '[]');
    return new Set(Array.isArray(raa) ? raa : []);
  } catch { return new Set(); }
}

function saetGruppeFoldet(noegle, id, foldet) {
  const sat = foldedeGrupper(noegle);
  if (foldet) sat.add(id); else sat.delete(id);
  try { localStorage.setItem(`doda_fold_${noegle}`, JSON.stringify([...sat])); } catch { /* privat */ }
}

/* Loebenummer til `aria-controls`. Knappen og dens liste skal kunne pege pa
   hinanden, og et gruppenavn duer ikke som DOM-id: det kan indeholde hvad
   som helst, og to skaerme kan tegne den samme gruppe. */
let foldNr = 0;

/**
 * Giver en funktion, der tegner foldbare grupper for ÉN skaerm.
 *
 * `noegle` er skaermens navn i localStorage (fx 'next'), og de foldede
 * navne laeses ÉN gang - ikke en gang pr. gruppe.
 *
 * Overskriften ser ud praecis som `h2.group`; CSS'en under
 * `button.group.foldknap` gentager reglerne, sa listerne ikke skifter
 * udseende, bare fordi overskrifterne blev knapper. Tallet bliver staaende,
 * nar gruppen er foldet sammen - det er hele pointen: man vil vide HVOR
 * MEGET der ligger, uden at se det.
 *
 * Raekkerne bliver STAAENDE i dokumentet (bare `hidden`), som Done-afsnittet
 * pa et projekt. Sa er foldningen ojeblikkelig, og nummereringen i `data-i`
 * holder.
 */
function foldGrupper(noegle) {
  const foldede = foldedeGrupper(noegle);
  return (id, navn, antal, indhold, klasse = 'list') => {
    const foldet = foldede.has(id);
    const domId = `grp${++foldNr}`;
    return `<button class="group meta foldknap" data-fold="${esc(noegle)}" data-foldid="${esc(id)}"
      aria-expanded="${foldet ? 'false' : 'true'}" aria-controls="${domId}">
      ${icon('chevron', 13)} ${esc(navn)} <span class="group-count">${antal}</span>
    </button>
    <div class="${klasse}" id="${domId}"${foldet ? ' hidden' : ''}>${indhold}</div>`;
  };
}

/*
 * Klikket haandteres ÉT sted for hele appen.
 *
 * En foldeknap tegnes om, hver gang listen gor det - og `bindListe()` kores
 * ogsa, nar en ENKELT raekke er tegnet om (`gentegnRaekke`). En lytter pr.
 * knap ville derfor hobe sig op og folde gruppen frem og tilbage ved ét klik.
 * Boblefasen er nok her: knappen ligger ikke inde i en raekke, sa den slas
 * ikke med de lyttere, §7k handler om.
 */
document.addEventListener('click', (e) => {
  const knap = e.target.closest && e.target.closest('.foldknap[data-fold]');
  if (!knap) return;
  const skalFoldes = knap.getAttribute('aria-expanded') === 'true';
  knap.setAttribute('aria-expanded', skalFoldes ? 'false' : 'true');
  const krop = document.getElementById(knap.getAttribute('aria-controls'));
  if (krop) krop.hidden = skalFoldes;
  saetGruppeFoldet(knap.dataset.fold, knap.dataset.foldid, skalFoldes);
});

/**
 * Raekkerne, man kan hoppe til med piletasterne.
 *
 * En raekke i en sammenfoldet gruppe er stadig i dokumentet, men den kan
 * ikke ses - og tastaturet ma ikke kunne lande pa noget usynligt. Vi
 * spoerger efter `[hidden]` frem for at male geometri: det er praecis det
 * flag, foldningen saetter.
 */
function synligeRaekker(vaelger = '.item-row') {
  return [...document.querySelectorAll(vaelger)].filter((r) => !r.closest('[hidden]'));
}

/* ------------------------------------------------------- gem-genvejen */

/*
 * ⌘+Enter (Ctrl+Enter) gemmer en aaben rude, saa man ikke skal efter musen
 * for at afslutte en redigering, man har tastet sig igennem.
 *
 * Genvejen bindes paa den ENKELTE rude med DENS knap - ikke globalt paa
 * `.modal .btn.primary`. Et spoergsmaal som »denne gang eller alle
 * fremtidige?« har ogsaa en primaer knap, og den maa et tastetryk ikke kunne
 * svare paa ved et uheld: den ville aendre hele serien. En rude, der ikke
 * gemmer noget, kalder simpelthen ikke det her.
 *
 * `preventDefault` er ikke pynt - uden den lægger beskrivelsesfeltet et
 * linjeskift ind i samme ombæring.
 */
function bindGemGenvej(host, knap) {
  if (!host || !knap) return;
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    knap.click();
  });
}

/* --------------------------------------------------- brugermenuen */

/* Log ud skal kunne naas uden at gaa i indstillingerne. Menuen er en lille
   popover over brugerknappen - samme sted, man i forvejen klikker. */
function visBrugerMenu() {
  const gammel = document.getElementById('userMenu');
  if (gammel) { gammel.remove(); return; }
  const anker = document.getElementById('userBtn');
  if (!anker) return;

  const host = document.createElement('div');
  host.className = 'usermenu';
  host.id = 'userMenu';
  host.innerHTML = `
    <div class="usermenu-head">
      <div class="usermenu-name">${esc(visNavn(state.user.username))}</div>
      <div class="meta">Signed in${state.config.secureContext ? '' : ' · plain http'}</div>
    </div>
    <button class="usermenu-item" data-go="guide">${icon('guide', 17)}<span>Guide</span></button>
    <button class="usermenu-item" data-go="settings">${icon('settings', 17)}<span>Settings</span></button>
    <button class="usermenu-item" data-go="shortcuts">${icon('log', 17)}<span>Keyboard shortcuts</span></button>
    <button class="usermenu-item danger" data-go="logout">${icon('out', 17)}<span>Log out</span></button>`;

  const r = anker.getBoundingClientRect();
  host.style.left = `${Math.round(r.left)}px`;
  host.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
  document.body.appendChild(host);

  const luk = () => host.remove();
  host.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hvad = el.dataset.go;
      luk();
      if (hvad === 'settings') gaaTil('settings');
      else if (hvad === 'guide') gaaTil('guide');
      else if (hvad === 'shortcuts') visGenveje();
      else {
        await api('POST', '/api/logout', {});
        state.user = null;
        // Koen og fokus hoerer til den bruger, der lige gik.
        try { localStorage.removeItem('doda_focus'); } catch { /* privat */ }
        render();
      }
    });
  });
  // Ét klik udenfor lukker igen. setTimeout, sa klikket der AABNEDE menuen
  // ikke lukker den med det samme.
  setTimeout(() => {
    document.addEventListener('click', function udenfor(e) {
      if (host.isConnected && !host.contains(e.target) && e.target !== anker) {
        luk();
        document.removeEventListener('click', udenfor);
      }
    });
  }, 0);
}

/* --------------------------------------------------- sideoversigten */

/*
 * Notion-agtig oversigt i hoejre side: en stak streger, én pr. afsnit, som
 * folder sig ud med teksten, naar musen er over den.
 *
 * Den bor i <body>, ikke i #pageHost. Alt inde i pageHost bliver skiftet ud
 * ved hver optegning, og sa ville oversigten forsvinde - samme grund som
 * fokusbjaelken ligger fast i body (RUNE-ERFARINGER, F8).
 */
const tocState = { punkter: [], aktiv: -1 };

function byggToc() {
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  const host = document.getElementById('pageHost');
  /*
   * Kun sidens egne afsnit. En modal har ogsaa h2'er, men den ligger i body og
   * bliver derfor ikke fanget her.
   *
   * Og kun dem, der faktisk SES: indstillingerne tegner alle faner og skjuler
   * de andre med `hidden` (§9f). Uden filteret listede oversigten alle seksten
   * afsnit, uanset hvilken fane man stod paa - og klikkede man paa et af dem,
   * skete der ingenting, fordi maalet var skjult (Andreas, 02-09-2026).
   *
   * `closest('[hidden]')` og ikke `offsetParent`: sidst i en optegning kan
   * elementer endnu ikke have en layout-kasse, og saa ville ALT se skjult ud.
   */
  const fundne = host
    ? [...host.querySelectorAll('h2')].filter((h) => !h.closest('[hidden]'))
    : [];

  // Under to afsnit er der ingen oversigt at lave, og pa en telefon ville
  // en fast stribe i hoejre side ligge oven i indholdet.
  if (fundne.length < 2 || smalSkaerm()) {
    rail.hidden = true;
    rail.innerHTML = '';
    tocState.punkter = [];
    return;
  }

  tocState.punkter = fundne.map((el, i) => {
    if (!el.id) el.id = `afsnit-${i}`;
    // Tallet i .group-count hoerer til overskriften, ikke til navnet.
    const taeller = el.querySelector('.group-count');
    const navn = (taeller ? el.textContent.replace(taeller.textContent, '') : el.textContent).trim();
    return { el, navn: navn || `Section ${i + 1}` };
  });
  tocState.aktiv = -1;

  rail.innerHTML = tocState.punkter.map((p, i) => `
    <button class="toc-item" data-toc="${i}" title="${esc(p.navn)}">
      <span class="toc-dash"></span><span class="toc-tekst">${esc(p.navn)}</span>
    </button>`).join('');
  rail.hidden = false;

  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.addEventListener('click', () => {
      const p = tocState.punkter[Number(el.dataset.toc)];
      if (p) p.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  markerToc();
}

/** Afsnittet, der lige er rullet forbi toppen, er det man er i. */
function markerToc() {
  if (!tocState.punkter.length) return;
  let i = 0;
  for (let n = 0; n < tocState.punkter.length; n++) {
    if (tocState.punkter[n].el.getBoundingClientRect().top <= 140) i = n;
  }
  if (i === tocState.aktiv) return;
  tocState.aktiv = i;
  const rail = document.getElementById('tocRail');
  if (!rail) return;
  rail.querySelectorAll('[data-toc]').forEach((el) => {
    el.classList.toggle('on', Number(el.dataset.toc) === i);
  });
}

// Én rAF pr. rulning: getBoundingClientRect pa hvert afsnit ved hvert
// scroll-tick ville ellers laese layout hundredvis af gange i sekundet.
let tocVenter = false;
const tocRullet = () => {
  if (tocVenter || !tocState.punkter.length) return;
  tocVenter = true;
  requestAnimationFrame(() => { tocVenter = false; markerToc(); });
};
// Begge, som registrerRullevagt(): under mobilgraensen er det body, der ruller
// (§6c), og rulle-haendelser bobler ikke op til window. I dag skjuler byggToc()
// oversigten dér, men den dag den vises pa en telefon, skal den kunne foelge med.
window.addEventListener('scroll', tocRullet, { passive: true });
document.body.addEventListener('scroll', tocRullet, { passive: true });

// Skiftes der mellem telefon og desktop, skal oversigten med.
window.addEventListener('resize', () => { byggToc(); });

/* ------------------------------------------------------------ connector */

/**
 * Adressen at vende tilbage til, naar man er logget ind.
 *
 * Serveren sender ?next=/oauth/authorize?... hertil, naar en connector beder
 * om samtykke og der ingen session er. KUN den ene sti accepteres - alt andet
 * ville vaere en aaben viderestilling, og en connector-godkendelse er
 * praecis det sted, hvor man ikke skal kunne lokkes videre.
 */
function oauthNaeste() {
  try {
    const n = new URLSearchParams(location.search).get('next') || '';
    return n.startsWith('/oauth/authorize?') ? n : null;
  } catch { return null; }
}

/**
 * ?item=<id> aabner ét bestemt element.
 *
 * Kalenderfeedet peger herind, saa man kan springe fra en deadline i sin
 * kalender til opgaven i doda. Adressen ryddes bagefter: en genindlaesning
 * skal ikke aabne ruden igen, og id'et hoerer ikke hjemme i historikken.
 */
async function aabnFraAdressen() {
  let id = null;
  let visning = null;
  try {
    const q = new URLSearchParams(location.search);
    id = q.get('item');
    visning = q.get('view');
  } catch { id = null; }

  /*
   * `?view=review` - dét, en push om den ugentlige gennemgang lander paa.
   *
   * Uden den ville notifikationen aabne forsiden, og saa skulle man klikke
   * »Start« i baandet bagefter. En besked, der beder om en handling, skal
   * lande dér, hvor handlingen sker.
   */
  if (visning === 'review' && state.user) {
    try { history.replaceState(null, '', location.pathname); } catch { /* ligegyldigt */ }
    gaaTil('review');
    return;
  }

  if (!id || !state.user) return;
  try { history.replaceState(null, '', location.pathname); } catch { /* ligegyldigt */ }
  try {
    const d = await api('GET', `/api/v1/items/${encodeURIComponent(id)}`);
    // state.items skal kende elementet: detaljeruden slaar op i den, naar
    // den gemmer og gentegner.
    if (!state.items.some((x) => x.id === d.item.id)) state.items = [d.item, ...state.items];
    aabnElement(d.item);
  } catch (ex) {
    // Slettet, eller et id fra en gammel kalenderpost. Sig det roligt.
    toast(ex.status === 404 ? 'That item is gone — it was deleted.' : ex.message);
  }
}

/** Kaldes efter login. Returnerer true, hvis siden er paa vej et andet sted hen. */
function fortsaetTilConnector() {
  const n = oauthNaeste();
  if (!n) return false;
  location.replace(n);
  return true;
}

/* --------------------------------------------------------------- start */

(async function start() {
  anvendTema(nuvaerendeTema());
  try {
    state.config = await api('GET', '/api/public-config');
    document.title = state.config.appName || 'doda';
    const me = await api('GET', '/api/me');
    state.user = me.user;
    // Var jeg allerede logget ind, da connectoren sendte mig herhen, skal
    // jeg slet ikke se appen - kun samtykkesiden.
    if (state.user && fortsaetTilConnector()) return;
    if (state.user) await hentState();
    hentSessionsting();
  } catch (ex) {
    document.getElementById('root').innerHTML =
      `<div class="gate"><div class="card"><div class="brand">${icon('logo', 26)} doda</div>
       <p class="lead" style="text-align:center">Could not reach the server.<br>${esc(ex.message)}</p></div></div>`;
    return;
  }
  render();
  registrerSW();
  lytPaaForbindelse();
  gendanFokus();
  aabnFraAdressen();
})();
