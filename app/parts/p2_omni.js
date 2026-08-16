'use strict';
/* doda - kommandobaren. Ét felt der bade soeger og opretter.
   Oprettelse star altid oeverst og kan altid nas med Enter: soegning ma
   aldrig komme i vejen for fangst (handover §5.1). */

const omniState = {
  tolket: null,
  resultater: [],
  valgt: 0,
  raekker: [],
  bekraeft: null,   // {contexts:[], project} - ukendte navne der skal godkendes
  soegeTimer: null,
  soegeToken: 0,
};

function omniEl() { return document.getElementById('omni'); }

/* Tolkningen sker LOKALT med den samme parser, serveren bruger. Ingen
   netvaerkskald pr. tastetryk - chipsene skal foelge fingrene. */
function tolkNu(tekst) {
  const p = (typeof dodaParse !== 'undefined') ? dodaParse : null;
  if (!p) return null;
  return p.tolkFangst(tekst);
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

/* ------------------------------------------------------------- chips */

function tegnChips() {
  const host = document.getElementById('omniChips');
  if (!host) return;
  const t = omniState.tolket;
  const raa = omniEl() ? omniEl().value.trim() : '';
  if (!raa || !t) { host.innerHTML = ''; return; }

  const chips = [];
  chips.push([t.kind === 'note' ? 'Note' : 'Task', 'accent']);
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

/* ------------------------------------------------------------ panelet */

function byggRaekker() {
  const raa = omniEl().value.trim();
  const raekker = [];
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
    raekker.push({
      type: 'create',
      titel: t && t.title ? t.title : raa,
      under: t && t.kind === 'note' ? 'New note' : 'New task in Inbox',
      ikon: t && t.kind === 'note' ? 'note' : 'plus',
    });
  }

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
    return `<button class="omni-row${r.type === 'confirm' ? ' confirm' : ''}"${valgt} data-i="${i}">
      ${icon(r.ikon || 'plus')}
      <span class="omni-row-main"><span class="omni-row-title">${esc(r.titel)}</span>
      <span class="omni-row-sub">${esc(r.under)}</span></span>
    </button>`;
  }).join('');
  panel.hidden = false;

  panel.querySelectorAll('.omni-row').forEach((el) => {
    el.addEventListener('mouseenter', () => { omniState.valgt = Number(el.dataset.i); markerValgt(); });
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
  const q = omniEl().value.trim();
  if (q.length < 2 || q.startsWith('*') || q.startsWith('+')) {
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

  if (raekke.type === 'item') {
    aabnElement(raekke.item);
    luk();
    return;
  }
  await fangstNu(raekke.type === 'confirm');
}

async function fangstNu(bekraeftet) {
  const tekst = omniEl().value.trim();
  if (!tekst) return;

  // Kendes alle navne i forvejen, er der intet at bekraefte - saa skal ét
  // Enter vaere nok. Det er hele pointen med "fangst pa ét trin".
  const ukendte = ukendteNavne(omniState.tolket);
  const skalSpoerge = !bekraeftet && (ukendte.contexts.length > 0 || ukendte.project);

  try {
    const svar = await api('POST', '/api/v1/capture', { text: tekst, createNew: !skalSpoerge });
    if (svar.needsConfirm) {
      omniState.bekraeft = svar.needsConfirm;
      omniState.valgt = 0;
      tegnPanel();
      return;
    }
    const it = svar.item;
    luk();
    await genindlaes();
    toast(it.kind === 'note' ? 'Note saved' : `Added to ${statusNavn(it.status)}`, {
      label: 'Undo',
      run: async () => {
        await api('DELETE', `/api/v1/items/${it.id}`, {});
        await genindlaes();
      },
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
  omniState.tolket = null;
  omniState.resultater = [];
  omniState.bekraeft = null;
  omniState.valgt = 0;
  tegnChips();
  tegnPanel();
}

function opdaterOmni() {
  const el = omniEl();
  omniState.tolket = tolkNu(el.value);
  // En aendring i teksten gor en tidligere bekraeftelse ugyldig.
  omniState.bekraeft = null;
  tegnChips();
  tegnPanel();
  planlaegSoegning();
}

function bindOmni() {
  const el = omniEl();
  if (!el) return;
  el.addEventListener('input', opdaterOmni);
  el.addEventListener('focus', () => { if (el.value.trim()) tegnPanel(); });
  el.addEventListener('blur', () => {
    // Lille forsinkelse, sa et klik pa en raekke nar at blive registreret.
    setTimeout(() => { const p = document.getElementById('omniPanel'); if (p) p.hidden = true; }, 150);
  });

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); luk(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!omniState.raekker.length) return;
      e.preventDefault();
      const n = omniState.raekker.length;
      omniState.valgt = (omniState.valgt + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      markerValgt();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); aktiver(); }
  });
}

/* Signaturen: begynd bare at skrive, sa aabner kommandobaren.
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
  if (el && el.closest && el.closest('[data-keynav]')) return;

  const omni = omniEl();
  if (!omni) return;

  if (e.key === '/') { e.preventDefault(); omni.focus(); return; }
  if (e.key.length !== 1) return;
  e.preventDefault();
  omni.focus();
  omni.value += e.key;
  opdaterOmni();
});
