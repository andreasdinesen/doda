'use strict';
/* doda - kommandopaletten. Ét felt der bade soeger, opretter og navigerer.
   Oprettelse star altid oeverst og kan altid nas med Enter: soegning ma
   aldrig komme i vejen for fangst (handover §5.1). */

/* Foerste tegn vaelger en TILSTAND. Pillen inde i feltet og legenden i bunden
   viser hvilken - sa man aldrig er i tvivl om, hvad Enter kommer til at gore. */
/*
 * Er Sagu forbundet? Hentes ÉN gang, naar appen er tegnet.
 *
 * Ikke pr. tastetryk og ikke pr. optegning: svaret aendrer sig kun, naar man
 * selv har vaeret i Settings, og et kald pr. bogstav ville vaere en rundtur
 * for et ja/nej, der stod fast (RUNE-ERFARINGER, doda v27).
 */
let saguKlar = false;

async function tjekSagu() {
  try { saguKlar = !!(await api('GET', '/api/v1/sagu')).connected; } catch { saguKlar = false; }
}

const MODER = {
  // Legenden skal naevne ALT, parseren kan i den tilstand. Naevner den mindre,
  // findes funktionen i praksis ikke - det var praecis derfor "/projekt" var
  // ubrugt indtil v4, selv om paletten lovede det.
  '+': { id: 'task', pil: '+ New Task', ph: 'Task title… try !tomorrow at 9',
    legend: ['/ project', '# context', '! date', '~ hide until'], enter: 'Create' },
  '*': { id: 'note', pil: '* New Note', ph: 'Note title…', legend: ['/ project', '# context'], enter: 'Create' },
  '/': { id: 'project', pil: '/ Projects', ph: 'Find or create a project…', legend: [], enter: 'Open' },
  '#': { id: 'context', pil: '# Contexts', ph: 'Find or create a context…', legend: [], enter: 'Open' },
  ':': { id: 'area', pil: ': Areas', ph: 'Find or create an area…', legend: [], enter: 'Open' },
};

/* De tre navigations-tilstande er ens pa alt andet end hvad de hedder og
   hvor de gemmer. Ét sted, sa en ny slags ikke skal tilfoejes fem steder. */
const NAVIGATION = {
  '/': { kilde: () => state.projects, hvad: 'project', flertal: 'projects', ikon: 'projects', sti: '/api/v1/projects', felt: 'project' },
  '#': { kilde: () => state.contexts, hvad: 'context', flertal: 'contexts', ikon: 'contexts', sti: '/api/v1/contexts', felt: 'context' },
  ':': { kilde: () => state.areas, hvad: 'area', flertal: 'areas', ikon: 'someday', sti: '/api/v1/areas', felt: 'area' },
};

/* Legenden er en kravspecifikation (doda v9): naevner den "* note", skal den
   tilstand findes. Derfor bygges den efter tilstanden, ikke som en konstant. */
const standardLegend = () => ['+ task']
  .concat(state.notesEnabled ? [saguKlar ? '* note in Sagu' : '* note'] : [])
  .concat(['/ projects', '# contexts', ': areas']);

const omniState = {
  mode: null,          // et tegn fra MODER, eller null
  tolket: null,
  resultater: [],
  valgt: 0,
  raekker: [],
  bekraeft: null,      // {contexts:[], project} - ukendte navne der skal godkendes
  soegeTimer: null,
  soegeToken: 0,
  // Filer, der er trukket ind, men endnu ikke sendt. De VENTER paa titlen:
  // en fil maa ikke oprette noget bag om brugeren, og et Esc skal kunne
  // fortryde det hele uden at efterlade en opgave, ingen bad om.
  filer: [],
};

function omniEl() { return document.getElementById('omni'); }
function omniKort() { return document.getElementById('omniCard'); }

/* Tolkningen sker LOKALT med den samme parser, serveren bruger. Ingen
   netvaerkskald pr. tastetryk - chipsene skal foelge fingrene. */
function tolkNu(tekst) {
  const p = (typeof dodaParse !== 'undefined') ? dodaParse : null;
  if (!p) return null;
  // I note-tilstand tolkes teksten, som om praefikset stod der.
  return p.tolkFangst(omniState.mode === '*' ? `* ${tekst}` : tekst);
}

/* ------------------------------------------------ forslag mens man skriver */

/*
 * Skriver man `/dod` midt i en linje, skal de projekter, der matcher, kunne
 * ses - ellers er den eneste vej til det rigtige navn at huske det.
 *
 * Det er ikke en soegning: den kigger paa den MARKOER, markoeren staar i.
 * Reglerne foelger parseren (app/shared/parse.js), for ellers ville paletten
 * foreslaa noget, teksten bagefter bliver tolket anderledes:
 *   - markoeren skal staa ved linjestart eller efter et mellemrum
 *     (ellers ville "navn@eksempel.dk" udloese en projektliste)
 *   - navnet er ét ord af bogstaver, tal, _ og -
 *   - der maa ikke vaere naaet et mellemrum efter markoeren
 */
const MARKOER_KILDE = {
  '/': { hvad: 'project', kilde: () => state.projects, ikon: 'projects' },
  '@': { hvad: 'project', kilde: () => state.projects, ikon: 'projects' },
  '#': { hvad: 'context', kilde: () => state.contexts, ikon: 'contexts' },
};

/** Hvilken markoer staar markoeren (caret'en) i? Null, hvis ingen. */
function markoerVedCaret() {
  const el = omniEl();
  if (!el) return null;
  // Navigations-tilstandene har deres egen liste; der er intet inline at gaette paa.
  if (omniState.mode && !'+*'.includes(omniState.mode)) return null;
  const pos = el.selectionStart;
  if (pos === null || pos === undefined) return null;
  const foer = el.value.slice(0, pos);
  const m = foer.match(/(^|\s)([/@#])([\p{L}\p{N}_-]*)$/u);
  if (!m) return null;
  return { tegn: m[2], delvist: m[3], start: pos - m[3].length - 1, slut: pos };
}

/** Rækker til paletten: de navne, der matcher det halvskrevne. */
function forslagsRaekker() {
  const t = markoerVedCaret();
  if (!t) return [];
  const k = MARKOER_KILDE[t.tegn];
  if (!k) return [];
  const q = t.delvist.toLowerCase();
  // Det, der BEGYNDER med det skrevne, foerst. Med ren "indeholder"-sortering
  // foreslog "/hus" projektet Sommerhus foer "Hus og have" - og Tab satte det
  // forkerte navn ind. Naar man fuldfoerer et navn, vejer begyndelsen tungest.
  return k.kilde()
    .filter((x) => !q || x.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aa - bb || a.name.localeCompare(b.name);
    })
    .slice(0, 6)
    .map((x) => ({ type: 'forslag', navn: x.name, tegn: t.tegn, ikon: k.ikon, hvad: k.hvad, token: t }));
}

/**
 * Saetter det fulde navn ind i stedet for det halvskrevne.
 *
 * Navne med mellemrum saettes i anfoerselstegn - parseren laeser `@"To ord"`,
 * og uden dem ville kun det foerste ord blive til projektet.
 */
function fuldfoerMarkoer(raekke) {
  const el = omniEl();
  const t = raekke.token;
  const navn = /[\s]/.test(raekke.navn) ? `"${raekke.navn}"` : raekke.navn;
  const ind = `${t.tegn}${navn} `;
  el.value = el.value.slice(0, t.start) + ind + el.value.slice(t.slut);
  const nyPos = t.start + ind.length;
  el.focus();
  el.setSelectionRange(nyPos, nyPos);
  omniState.valgt = 0;
  opdaterOmni();
}

function ukendteNavne(tolket) {
  if (!tolket) return { contexts: [], project: null };
  const kendteK = new Set(state.contexts.map((c) => c.name.toLowerCase()));
  const kendteP = new Set(state.projects.map((p) => p.name.toLowerCase()));
  return {
    contexts: tolket.contexts.filter((n) => !kendteK.has(n.toLowerCase())),
    project: tolket.project && !kendteP.has(tolket.project.toLowerCase()) ? tolket.project : null,
  };
}

/* ------------------------------------------------------------ tilstand */

function saetMode(tegn) {
  // Er noter slaaet fra, findes note-tilstanden ikke. Uden det her ville
  // "*" aabne en tilstand, hvis resultat man bagefter ikke kunne finde.
  if (tegn === '*' && !state.notesEnabled) tegn = null;
  omniState.mode = tegn;
  const el = omniEl();
  const pil = document.getElementById('omniMode');
  if (!el || !pil) return;
  const m = tegn ? MODER[tegn] : null;
  pil.hidden = !m;
  pil.textContent = m ? m.pil : '';
  el.placeholder = m ? m.ph : 'Just type to Capture, Navigate and Find';
  omniKort().classList.toggle('moded', !!m);
}

function tegnLegend() {
  const host = document.getElementById('omniLegend');
  if (!host) return;
  const m = omniState.mode ? MODER[omniState.mode] : null;
  const dele = m ? m.legend : standardLegend();
  const enter = m ? m.enter : 'Select';
  host.innerHTML = `
    <span class="legend-keys">${dele.map((d) => {
    const mellemrum = d.indexOf(' ');
    return `<span class="legend-item"><kbd>${esc(d.slice(0, mellemrum))}</kbd>${esc(d.slice(mellemrum + 1))}</span>`;
  }).join('<span class="legend-dot">·</span>')}</span>
    <span class="legend-nav"><span class="legend-item">↑ ↓ Navigate</span>
      <span class="legend-item">↵ ${esc(enter)}</span></span>`;
}

/* ------------------------------------------------------------- chips */

function tegnChips() {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const t = omniState.tolket;
  const raa = omniEl() ? omniEl().value.trim() : '';
  // Navigations-tilstandene har ingen tolkning at vise.
  if ((!raa && !omniState.filer.length) || (omniState.mode && !'+*'.includes(omniState.mode))) { host.innerHTML = ''; return; }
  if (!t) { host.innerHTML = omniState.filer.map((f) =>
    `<span class="chip">${esc(`📎 ${f.name}`)}</span>`).join(''); return; }

  const chips = [];
  // Ventende filer staar foerst: de er det mest overraskende i feltet.
  for (const f of omniState.filer) chips.push([`📎 ${f.name}`, 'accent']);
  /* Udfylder skaermen noget, skal det staa HER, foer man trykker Enter -
     ellers sker det bag om ryggen paa brugeren, og det er praecis den slags
     tavse hjaelpsomhed, en chip-raekke findes for at afsloere.
     Teksten vinder, saa chippen udebliver, naar man selv har skrevet det. */
  const skaerm = skaermensUdfyldning();
  if (skaerm && t.kind !== 'note'
    && !(skaerm.project && t.project) && !(skaerm.context && t.contexts.length)) {
    chips.push([`→ ${skaerm.vis}`, 'neutral']);
  }
  for (const c of t.contexts) chips.push([`#${c}`, 'accent']);
  if (t.project) chips.push([`@${t.project}`, 'accent']);
  if (t.due) chips.push([`⏰ ${visDato(t.due.dato)}${t.due.tid ? ` ${t.due.tid}` : ''}`, 'accent']);
  if (t.defer) chips.push([`hidden until ${visDato(t.defer)}`, 'neutral']);
  if (t.note) chips.push(['+ description', 'neutral']);

  // Gentagelsen skal staa SKREVET UD. Forskellen mellem "fast plan" og "fra
  // fuldfoerelse" er ét udrabstegn i teksten - chippen er det eneste sted,
  // valget bliver tydeligt for brugeren (DESIGN.md §3, handover §5.6).
  if (t.recurrenceText) {
    const g = (typeof dodaParse !== 'undefined') ? dodaParse.tolkGentagelse(t.recurrenceText) : null;
    chips.push(g ? [`↻ ${dodaParse.beskrivGentagelse(g)}`, 'accent']
      : [`↻ didn't understand "${t.recurrenceText}"`, 'neutral']);
  }
  for (const w of t.warnings) {
    if (w !== 'gentagelse') chips.push([w.replace('forstod ikke datoen', "didn't understand the date"), 'neutral']);
  }

  host.innerHTML = chips.map(([tekst, slags]) =>
    `<span class="chip${slags === 'neutral' ? ' neutral' : ''}">${esc(tekst)}</span>`).join('');
}

function visDato(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dato = new Date(y, m - 1, d);
  const iDag = new Date(state.today ? `${state.today}T00:00:00` : Date.now());
  const dage = Math.round((dato - new Date(iDag.getFullYear(), iDag.getMonth(), iDag.getDate())) / 86400000);
  if (dage === 0) return 'today';
  if (dage === 1) return 'tomorrow';
  if (dage === -1) return 'yesterday';
  if (dage > 1 && dage < 7) return dato.toLocaleDateString('en-GB', { weekday: 'long' });
  return dato.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------ raekker */

function byggRaekker() {
  const raa = omniEl().value.trim();
  const raekker = [];
  const mode = omniState.mode;

  // Navigation: vis det, man kan springe til - og tilbyd at oprette det,
  // der ikke findes endnu.
  if (NAVIGATION[mode]) {
    const n = NAVIGATION[mode];
    const kilde = n.kilde();
    const traf = kilde.filter((x) => !raa || x.name.toLowerCase().includes(raa.toLowerCase()));
    for (const x of traf.slice(0, 12)) {
      raekker.push({
        type: 'goto', mode, id: x.id, titel: x.name,
        under: mode === '/' ? `${x.open_count || 0} open` : n.hvad,
        ikon: n.ikon,
      });
    }

    // Oprettelsen staar NEDERST her, modsat fangst-tilstanden. I fangst er
    // det nye det normale; her er det at springe hen til noget, man har.
    // Med oprettelsen oeverst ville Enter lave en dublet, hver gang man
    // skrev de foerste bogstaver af et navn, der allerede findes.
    const findes = raa && kilde.some((x) => x.name.toLowerCase() === raa.toLowerCase());
    if (raa && !findes) raekker.push({ type: 'nyt', mode, navn: raa, ikon: n.ikon, hvad: n.hvad });

    if (!raekker.length) {
      raekker.push({ type: 'tom', titel: `No ${n.flertal} yet`,
        under: `Type a name to create your first one` });
    }
    return raekker;
  }

  if (!raa) return raekker;

  if (omniState.bekraeft) {
    const b = omniState.bekraeft;
    const nye = [...b.contexts.map((n) => `#${n}`), ...(b.project ? [`@${b.project}`] : [])];
    raekker.push({
      type: 'confirm',
      titel: `Create ${nye.join(' and ')}?`,
      under: 'Press Enter again to create them along with the task.',
    });
  } else {
    const t = omniState.tolket;
    /*
     * Er Sagu forbundet, er `*` en note I SAGU - ikke et valg mellem to steder.
     *
     * Frem til v43 stod Sagu-noten som en raekke MERE, saa foerste plads var
     * uroert og ét Enter fangede det samme som i gaar (handover §5.1). Men
     * naar noterne bor i Sagu, er to raekker to steder at lede efter den
     * samme note bagefter, og valget skal traeffes forfra hver gang. Andreas
     * bad om det 21-08-2026: er der koblet en note-app paa, hoerer noterne
     * DERTIL.
     *
     * De noter, der allerede ligger i doda, bliver liggende og kan stadig
     * naas under Notes - det er kun VEJEN IND, der lukkes (DESIGN §v35).
     */
    const iSagu = mode === '*' && saguKlar && (t && t.title ? t.title : raa).trim();
    if (!iSagu) {
      raekker.push({
        type: 'create',
        titel: t && t.title ? t.title : raa,
        under: mode === '*' ? 'NEW NOTE' : mode === '+' ? 'NEW TASK' : 'QUICK CAPTURE',
      });
    } else {
      raekker.push({
        type: 'sagunote',
        titel: t && t.title ? t.title : raa,
        under: 'NEW NOTE IN SAGU · linked both ways',
      });
    }
  }

  // Forslagene staar UNDER oprettelsen. Ét Enter skal stadig fange - det er
  // appens aeldste regel (handover §5.1) - saa listen maa aldrig skubbe
  // oprettelsen ned fra foerste plads. Tab tager det oeverste forslag.
  for (const f of forslagsRaekker()) raekker.push(f);

  for (const item of omniState.resultater) raekker.push({ type: 'item', item });
  return raekker;
}

function tegnPanel() {
  const panel = document.getElementById('omniPanel');
  if (!panel) return;
  omniState.raekker = byggRaekker();
  if (!omniState.raekker.length) { panel.hidden = true; panel.innerHTML = ''; return; }
  if (omniState.valgt >= omniState.raekker.length) omniState.valgt = 0;

  panel.innerHTML = omniState.raekker.map((r, i) => {
    const valgt = i === omniState.valgt ? ' aria-selected="true"' : '';
    if (r.type === 'item') {
      const it = r.item;
      const faerdig = it.status === 'done' || it.status === 'dropped';
      return `<button class="omni-row${faerdig ? ' dim' : ''}"${valgt} data-i="${i}">
        ${icon(it.kind === 'note' ? 'note' : 'next')}
        <span class="omni-row-main"><span class="omni-row-title">${esc(it.title)}</span>
        <span class="omni-row-sub">${esc(statusNavn(it.status))}${it.contexts.length ? ` · ${it.contexts.map((c) => `#${c.name}`).join(' ')}` : ''}</span></span>
      </button>`;
    }
    if (r.type === 'tom') {
      return `<div class="omni-row empty-row"><span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></div>`;
    }
    if (r.type === 'goto') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon(r.ikon)}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.titel)}</span>
        <span class="omni-row-sub">${esc(r.under)}</span></span></button>`;
    }
    if (r.type === 'forslag') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon(r.ikon)}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.tegn)}${esc(r.navn)}</span>
        <span class="omni-row-sub">${esc(r.hvad)} · tab to insert</span></span></button>`;
    }
    if (r.type === 'nyt') {
      return `<button class="omni-row"${valgt} data-i="${i}">
        ${icon('plus')}<span class="omni-row-main">
        <span class="omni-row-title">${esc(r.navn)}</span>
        <span class="omni-row-sub">NEW ${esc(r.hvad.toUpperCase())}</span></span></button>`;
    }
    // Quick Capture: den store, fremhaevede raekke.
    return `<button class="omni-row big${r.type === 'confirm' ? ' confirm' : ''}"${valgt} data-i="${i}">
      <span class="omni-plus">${icon(r.type === 'confirm' ? 'next' : 'plus', 20)}</span>
      <span class="omni-row-main"><span class="omni-row-title">${esc(r.titel)}</span>
      ${r.type === 'confirm' ? `<span class="omni-row-sub">${esc(r.under)}</span>` : ''}</span>
      ${r.type === 'confirm' ? '' : `<span class="omni-badge">${esc(r.under)}</span>`}
    </button>`;
  }).join('');
  panel.hidden = false;

  panel.querySelectorAll('button.omni-row').forEach((el) => {
    el.addEventListener('mouseenter', () => { omniState.valgt = Number(el.dataset.i); markerValgt(); });
    el.addEventListener('mousedown', (e) => e.preventDefault());   // behold fokus i feltet
    el.addEventListener('click', () => { omniState.valgt = Number(el.dataset.i); aktiver(); });
  });
}

function markerValgt() {
  document.querySelectorAll('#omniPanel .omni-row').forEach((el, i) => {
    if (i === omniState.valgt) el.setAttribute('aria-selected', 'true');
    else el.removeAttribute('aria-selected');
  });
}

const STATUS_NAVNE = {
  inbox: 'Inbox', next: 'Next', queued: 'Queued', waiting: 'Waiting for',
  someday: 'Someday', done: 'Done', dropped: 'Dropped',
};
const statusNavn = (s) => STATUS_NAVNE[s] || s;

/* ------------------------------------------------------------ soegning */

function planlaegSoegning() {
  clearTimeout(omniState.soegeTimer);
  /*
   * Soeg paa den TOLKEDE titel, ikke paa den raa linje.
   *
   * Skrev man "test /dod", blev hele strengen sendt afsted - og de
   * resultater, der stod der, mens man skrev "test", forsvandt i samme
   * oejeblik man begyndte paa projektet. Markoererne hoerer til tolkningen,
   * ikke til det, man leder efter; brugeren har stadig kun skrevet "test".
   */
  const t = omniState.tolket;
  const q = ((t && t.title) || omniEl().value).trim();
  // Navigation soeger lokalt; kun fritekst og opgave-tilstand spoerger serveren.
  if (q.length < 2 || (omniState.mode && omniState.mode !== '+')) {
    omniState.resultater = [];
    tegnPanel();
    return;
  }
  omniState.soegeTimer = setTimeout(async () => {
    const token = ++omniState.soegeToken;
    try {
      const d = await api('GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
      // Et aeldre svar ma aldrig overskrive et nyere - ellers blinker
      // resultaterne tilbage til noget, brugeren er holdt op med at skrive.
      if (token !== omniState.soegeToken) return;
      omniState.resultater = d.items;
      tegnPanel();
    } catch { /* soegning ma aldrig staa i vejen for fangst */ }
  }, 140);
}

/* ------------------------------------------------------------ handling */

async function aktiver() {
  const raekke = omniState.raekker[omniState.valgt];
  if (!raekke) return;

  if (raekke.type === 'item') { aabnElement(raekke.item); luk(); return; }
  if (raekke.type === 'tom') return;
  if (raekke.type === 'goto') { luk(); gaaTilNavigation(raekke.mode, raekke.id); return; }
  if (raekke.type === 'nyt') { await opretNavigation(raekke); return; }
  if (raekke.type === 'forslag') { fuldfoerMarkoer(raekke); return; }
  if (raekke.type === 'sagunote') { await opretSaguNote(raekke.titel); return; }
  await fangstNu(raekke.type === 'confirm');
}

/**
 * Opretter en note i SAGU - og en opgave i doda, der peger paa den.
 *
 * »Link begge veje« er ikke pynt: uden opgaven er noten en oe, og uden noten
 * er opgaven en titel. Raekkefoelgen er valgt: **noten foerst.** Fejler Sagu,
 * er der ikke oprettet noget, og brugeren kan proeve igen - den modsatte
 * raekkefoelge ville efterlade en opgave, der lover et link, den ikke har
 * (RUNE-ERFARINGER, MsGraphBud: vaelg hvilken vej du vil fejle).
 */
async function opretSaguNote(raaTitel) {
  const titel = String(raaTitel || '').trim();
  if (!titel) return;
  try {
    const d = await api('POST', '/api/v1/sagu/note', {
      title: titel,
      backUrl: location.origin,
      backTitle: titel,
    });
    // Opgaven i doda peger paa noten. `link_url` er generisk - det er dét,
    // der goer, at Sagu kan bruge det samme felt som Notion.
    const svar = await api('POST', '/api/v1/capture', { text: titel, createNew: true });
    const it = svar.item;
    if (it) {
      await api('POST', `/api/v1/items/${it.id}`, {
        link_url: d.page.url,
        link_title: d.page.title,
      });
    }
    luk();
    await genindlaes();
    toast('Note created in Sagu', {
      label: 'Open',
      run: () => window.open(d.page.url, '_blank', 'noopener'),
    });
  } catch (ex) {
    /*
     * En fejlet forbindelse er ikke en fejlet fangst: feltet staar uroert, saa
     * man kan trykke igen.
     *
     * Foer v44 stod der ogsaa »eller vaelg den almindelige note ovenover« -
     * men den raekke findes ikke laengere, naar Sagu er forbundet. Uden en vej
     * ud ville en note vaere UMULIG at gemme, mens Sagu er nede, og teksten
     * ville staa i feltet uden noget sted at gaa hen. Derfor tilbydes doda som
     * det, den nu er: en noedudgang, ikke et valg, man skal traeffe hver gang.
     */
    toast(ex.message, {
      label: 'Keep in doda',
      run: async () => {
        try {
          await api('POST', '/api/v1/capture', { text: `* ${titel}`, createNew: true });
          luk();
          await genindlaes();
          toast('Note kept in doda');
        } catch (e2) { toast(e2.message); }
      },
    });
  }
}

function gaaTilNavigation(mode, id) {
  if (mode === '/') gaaTilProjekt(id);
  else if (mode === '#') gaaTil('next', { context: id });
  else gaaTil('projects', { area: id });
}

/**
 * Opretter et projekt, en kontekst eller et omraade fra paletten - og gaar
 * derhen bagefter. Serveren er idempotent pa navnet, sa to hurtige Enter
 * ikke kan lave en dublet.
 */
async function opretNavigation(raekke) {
  const n = NAVIGATION[raekke.mode];
  if (!n) return;
  try {
    const svar = await api('POST', n.sti, { name: raekke.navn });
    const ny = svar[n.felt];
    luk();
    await genindlaes();
    if (ny && ny.id) gaaTilNavigation(raekke.mode, ny.id);
    toast(`${n.hvad.charAt(0).toUpperCase()}${n.hvad.slice(1)} “${raekke.navn}” created`);
  } catch (ex) {
    toast(ex.message);
  }
}

/*
 * Skaermen, man staar paa, udfylder det, teksten tier om (DESIGN.md §3).
 * Serveren har det sidste ord - den tjekker, at id'erne findes, og at
 * statussen er én, en skaerm overhovedet maa implicere.
 */
function skaermensUdfyldning() {
  if (state.view === 'waiting') return { status: 'waiting', vis: 'Waiting For' };
  if (state.view === 'someday') return { status: 'someday', vis: 'Someday' };
  if (state.view === 'projects' && state.openProject) {
    const p = state.projects.find((x) => x.id === state.openProject);
    return p ? { project: p.id, vis: `@${p.name}` } : null;
  }
  if (state.view === 'next' && state.filterContext) {
    const k = state.contexts.find((x) => x.id === state.filterContext);
    return k ? { context: k.id, vis: `#${k.name}` } : null;
  }
  return null;
}

async function fangstNu(bekraeftet) {
  let tekst = omniEl().value.trim();
  if (!tekst) return;
  // Tilstanden oversaettes til det praefiks, parseren og serveren forstar.
  if (omniState.mode === '*') tekst = `* ${tekst}`;

  // Kendes alle navne i forvejen, er der intet at bekraefte - saa skal ét
  // Enter vaere nok. Det er hele pointen med "fangst pa ét trin".
  const ukendte = ukendteNavne(omniState.tolket);
  const skalSpoerge = !bekraeftet && (ukendte.contexts.length > 0 || ukendte.project);

  try {
    const skaerm = skaermensUdfyldning();
    const krop = { text: tekst, createNew: !skalSpoerge };
    if (skaerm) krop.from = { status: skaerm.status, project: skaerm.project, context: skaerm.context };
    const svar = await api('POST', '/api/v1/capture', krop);
    if (svar.needsConfirm) {
      omniState.bekraeft = svar.needsConfirm;
      omniState.valgt = 0;
      tegnPanel();
      return;
    }
    const it = svar.item;
    const venter = omniState.filer.slice();
    luk();
    /* Filerne sendes FOERST nu: elementet skal findes, foer det kan have en
       vedhaeftning. Fejler en af dem, er opgaven stadig oprettet - og det er
       den rigtige rangorden: teksten er det vigtige, filen er tilbehoeret. */
    if (venter.length) {
      let sendt = 0;
      for (const f of venter) {
        try { await uploadFil(it.id, f); sendt++; } catch (ex) { toast(ex.message); }
      }
      if (sendt) toast(`${sendt} file${sendt === 1 ? '' : 's'} attached`);
    }
    // Staar man paa den skaerm, opgaven lander paa, skal den vaere der NU.
    // Ellers hentes state og liste som foer (p3_lists' indsaetStraks).
    if (indsaetStraks(it)) opfriskBagefter();
    else await genindlaes();
    toast(it.kind === 'note' ? 'Note saved' : `Added to ${statusNavn(it.status)}`, {
      label: 'Undo',
      run: async () => { await api('DELETE', `/api/v1/items/${it.id}`, {}); await genindlaes(); },
    });
  } catch (ex) {
    // Netvaerksbrud: gem lokalt og send, naar der er forbindelse igen.
    // Et rigtigt afslag fra serveren skal derimod vises som det er.
    if (erNetvaerksfejl(ex)) {
      laegIKoe(tekst);
      luk();
      toast('Saved offline — it will be sent when you are back');
      return;
    }
    toast(ex.message);
  }
}

function luk() {
  const el = omniEl();
  if (el) { el.value = ''; el.blur(); }
  saetMode(null);
  omniState.tolket = null;
  omniState.resultater = [];
  omniState.bekraeft = null;
  omniState.valgt = 0;
  omniState.filer = [];
  tegnChips();
  tegnPanel();
  tegnLegend();
}

function opdaterOmni() {
  const el = omniEl();

  // Foerste tegn kan vaelge en tilstand - men KUN naar feltet ellers er tomt.
  // Ellers ville "#hjem" midt i en saetning skifte tilstand, og den inline
  // genvejssyntaks ville holde op med at virke.
  if (!omniState.mode && el.value.length === 1 && MODER[el.value]) {
    saetMode(el.value);
    el.value = '';
  }

  omniState.tolket = tolkNu(el.value);
  omniState.bekraeft = null;   // en aendring i teksten gor bekraeftelsen ugyldig
  tegnChips();
  tegnLegend();
  tegnPanel();
  planlaegSoegning();
}

/*
 * En fil trukket ind paa kommandobaren er STARTEN paa en opgave.
 *
 * Den opretter ikke noget af sig selv: filen laegger sig som en chip og
 * venter paa, at man skriver en titel og trykker Enter - praecis som en
 * dato eller en kontekst gor. Er feltet tomt, foreslaas filnavnet som titel,
 * saa ét Enter er nok. Esc fortryder det hele uden at efterlade noget.
 */
function bindOmniFiler() {
  const kort = omniKort();
  const el = omniEl();
  if (!kort || !el) return;

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((n) => kort.addEventListener(n, (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    stop(e);
    kort.classList.add('draaber');
  }));
  ['dragleave', 'dragend'].forEach((n) => kort.addEventListener(n, () => kort.classList.remove('draaber')));

  kort.addEventListener('drop', (e) => {
    const filer = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    if (!filer.length) return;
    stop(e);
    kort.classList.remove('draaber');
    omniState.filer = omniState.filer.concat(filer);
    // Filnavnet UDEN endelse er et bedre forslag end intet - men det maa
    // aldrig overskrive noget, brugeren allerede har skrevet.
    if (!el.value.trim()) el.value = filer[0].name.replace(/\.[^.]+$/, '');
    el.focus();
    opdaterOmni();
  });
}

function bindOmni() {
  const el = omniEl();
  if (!el) return;
  bindOmniFiler();
  saetMode(null);
  tegnLegend();

  el.addEventListener('input', opdaterOmni);
  el.addEventListener('focus', tegnPanel);
  // Flytter man markoeren ind i et halvskrevet navn uden at aendre teksten,
  // skal forslagene ogsaa komme frem. keyup daekker piletaster; click daekker mus.
  el.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') tegnPanel(); });
  el.addEventListener('click', tegnPanel);
  el.addEventListener('blur', () => {
    // Lille forsinkelse, sa et klik pa en raekke nar at blive registreret.
    setTimeout(() => {
      if (document.activeElement === el) return;
      const p = document.getElementById('omniPanel');
      if (p) p.hidden = true;
    }, 150);
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    // Backspace i et tomt felt forlader tilstanden i stedet for ingenting.
    if (e.key === 'Backspace' && !el.value && omniState.mode) {
      e.preventDefault();
      saetMode(null);
      opdaterOmni();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!omniState.raekker.length) return;
      e.preventDefault();
      const n = omniState.raekker.length;
      omniState.valgt = (omniState.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    // Tab fuldfoerer et halvskrevet navn. Er oprettelsen valgt (det normale),
    // tages det oeverste forslag - ellers det, man har rullet ned til.
    if (e.key === 'Tab') {
      const valgt = omniState.raekker[omniState.valgt];
      const f = valgt && valgt.type === 'forslag'
        ? valgt : omniState.raekker.find((r) => r.type === 'forslag');
      if (!f) return;                     // intet at fuldfoere: lad Tab vaere Tab
      e.preventDefault();
      fuldfoerMarkoer(f);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); aktiver(); }
  });
}

/* Signaturen: begynd bare at skrive, sa aabner paletten.
   Undtagelserne er vigtigere end reglen - uden dem stjaeler den tastetryk
   fra ethvert felt i appen. */
document.addEventListener('keydown', (e) => {
  if (!state.user) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (document.querySelector('.modal')) return;
  // Star fokus i en liste med tastaturafklaring, ejer LISTEN bogstaverne
  // (n = next, w = waiting, x = delete). preventDefault i raekkens egen
  // handler stopper ikke boblingen hertil - det skal dette tjek.
  //
  // Se ogsaa paa haendelsens MAAL og ikke kun paa det, der har fokus NU:
  // en raekke, der flytter sig selv ud af listen (v27), er allerede vaek, naar
  // haendelsen naar herop, og saa er activeElement faldet tilbage til body.
  // Maalet ved stadig, hvor det kom fra - ogsaa efter det er taget ud af
  // dokumentet. (Raekken stopper i forvejen udbredelsen; det her er
  // spaerren for alt det, nogen bygger i morgen.)
  const fra = e.target;
  if (el && el.closest && el.closest('[data-keynav]')) return;
  if (fra && fra.closest && fra.closest('[data-keynav]')) return;

  const omni = omniEl();
  if (!omni) return;
  if (e.key.length !== 1) return;
  e.preventDefault();
  omni.focus();
  omni.value += e.key;
  opdaterOmni();
});
