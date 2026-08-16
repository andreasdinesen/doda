'use strict';
/* doda - listerne: Next Actions, Inbox, elementraekken og detaljeruden. */

const sideState = { fokusId: null };

/* --------------------------------------------------------- optegning */

async function tegnSide() {
  const host = document.getElementById('pageHost');
  if (!host) return;
  const view = viewById(state.view);

  if (view.id === 'settings') { host.innerHTML = sideSettings(); bindSettings(); return; }
  if (view.id === 'contexts') { host.innerHTML = sideContexts(); bindContexts(); return; }
  if (view.id === 'repeat') { await sideRepeat(); return; }
  if (view.id === 'projects') {
    if (state.openProject) { await sideProjekt(state.openProject); return; }
    host.innerHTML = await sideProjects();
    document.getElementById('newProject').addEventListener('click', () => redigerProjekt(null));
    document.getElementById('manageAreas').addEventListener('click', administrerOmraader);
    document.querySelectorAll('.item-row[data-project]').forEach((el) => {
      el.addEventListener('click', () => gaaTilProjekt(el.dataset.project));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') gaaTilProjekt(el.dataset.project); });
    });
    return;
  }
  if (view.fase) { host.innerHTML = sidePlaceholder(view); return; }

  host.innerHTML = `<section class="page"><div class="page-head">
      <h1>${esc(view.label)}</h1><p class="lead">${esc(BESKRIVELSER[view.id])}</p>
    </div><div class="skeleton">Loading…</div></section>`;

  try {
    if (view.id === 'inbox') {
      const d = await api('GET', '/api/v1/items?status=inbox');
      state.items = d.items;
      host.innerHTML = sideInbox();
    } else {
      const q = state.filterContext ? `&context=${encodeURIComponent(state.filterContext)}` : '';
      const d = await api('GET', `/api/v1/items?status=next&hideDeferred=1${q}`);
      state.items = d.items;
      host.innerHTML = sideNext();
    }
    bindListe();
  } catch (ex) {
    if (ex.status === 401) { state.user = null; render(); return; }
    host.innerHTML = `<section class="page"><div class="empty"><p>${esc(ex.message)}</p></div></section>`;
  }
}

function sidePlaceholder(view) {
  return `<section class="page">
    <div class="page-head"><h1>${esc(view.label)}</h1>
      <p class="lead">${esc(BESKRIVELSER[view.id] || '')}</p></div>
    <div class="empty">${icon('calm', 34)}
      <p class="empty-title">Coming in ${esc(view.fase)}</p>
      <p>The shell is ready. This screen gets built in that phase.</p></div>
  </section>`;
}

/* ------------------------------------------------------------ Inbox */

function sideInbox() {
  const items = state.items;
  return `<section class="page">
    <div class="page-head"><h1>Inbox</h1><p class="lead">${esc(BESKRIVELSER.inbox)}</p></div>
    ${items.length ? `
      <p class="meta" style="margin-bottom:12px">${items.length} item${items.length === 1 ? '' : 's'} · oldest first</p>
      <div class="list" data-keynav>${items.map((it, i) => elementRaekke(it, i)).join('')}</div>
      <p class="hintline meta">↑↓ move · enter open · space done · n next · w waiting · s someday · x delete</p>
    ` : tomInbox()}
  </section>`;
}

/* Tom inbox skal foeles som en beloenning, ikke som en tom kasse
   (handover §5.2). Ingen tal, ingen farve, ingen opfordring. */
function tomInbox() {
  return `<div class="empty">${icon('calm', 34)}
    <p class="empty-title">Inbox is empty</p>
    <p>Nothing is waiting on you. Type anywhere to capture the next thing.</p></div>`;
}

/* ----------------------------------------------------- Next Actions */

function sideNext() {
  const items = state.items;
  const filtre = state.contexts.map((c) => `
    <button class="pill${state.filterContext === c.id ? ' on' : ''}" data-ctx="${esc(c.id)}">#${esc(c.name)}</button>`).join('');

  if (!items.length) {
    return `<section class="page">
      <div class="page-head"><h1>Next Actions</h1><p class="lead">${esc(BESKRIVELSER.next)}</p></div>
      ${state.contexts.length ? `<div class="pills">
        <button class="pill${state.filterContext ? '' : ' on'}" data-ctx="">All</button>${filtre}</div>` : ''}
      <div class="empty">${icon('calm', 34)}
        <p class="empty-title">${state.filterContext ? 'Nothing here right now' : 'Nothing to do right now'}</p>
        <p>${state.filterContext ? 'No next actions in this context.' : 'Clarify something from your inbox, or capture something new.'}</p></div>
    </section>`;
  }

  // Grupperet efter kontekst. Et element uden kontekst horer under "No context"
  // - det skal ikke forsvinde, bare fordi det mangler et felt.
  const grupper = new Map();
  for (const it of items) {
    const noegler = it.contexts.length ? it.contexts.map((c) => c.name) : ['No context'];
    for (const n of noegler) {
      if (!grupper.has(n)) grupper.set(n, []);
      grupper.get(n).push(it);
    }
  }
  const sorteret = [...grupper.entries()].sort((a, b) => {
    if (a[0] === 'No context') return 1;
    if (b[0] === 'No context') return -1;
    return a[0].localeCompare(b[0]);
  });

  let n = 0;
  return `<section class="page">
    <div class="page-head"><h1>Next Actions</h1><p class="lead">${esc(BESKRIVELSER.next)}</p></div>
    ${state.contexts.length ? `<div class="pills">
      <button class="pill${state.filterContext ? '' : ' on'}" data-ctx="">All</button>${filtre}</div>` : ''}
    <div data-keynav>
      ${sorteret.map(([navn, liste]) => `
        <h2 class="group meta">${esc(navn)} <span class="group-count">${liste.length}</span></h2>
        <div class="list">${liste.map((it) => elementRaekke(it, n++)).join('')}</div>`).join('')}
    </div>
    <p class="hintline meta">↑↓ move · enter open · space done</p>
  </section>`;
}

/* -------------------------------------------------------- elementet */

function elementRaekke(it, i) {
  const projekt = it.project_id ? state.projects.find((p) => p.id === it.project_id) : null;
  const meta = [];
  if (projekt) meta.push(esc(projekt.name));
  if (it.due_date) meta.push(`${visDato(it.due_date)}${it.due_time ? ` ${it.due_time}` : ''}`);
  if (it.contexts.length) meta.push(it.contexts.map((c) => `#${esc(c.name)}`).join(' '));

  return `<div class="item-row" tabindex="0" data-id="${esc(it.id)}" data-i="${i}">
    <button class="tick${it.status === 'done' ? ' on' : ''}" data-done="${esc(it.id)}"
      aria-label="Mark done" title="Mark done"></button>
    <div class="item-main">
      <div class="item-title">${linkify(it.title)}</div>
      ${meta.length ? `<div class="item-meta meta">${meta.join(' · ')}</div>` : ''}
    </div>
    ${it.note ? `<span class="item-flag" title="Has a description">${icon('note', 15)}</span>` : ''}
    ${it.attachment_count ? `<span class="item-flag" title="${it.attachment_count} attachment(s)">${icon('link', 15)}</span>` : ''}
  </div>`;
}

/* ------------------------------------------------------- haendelser */

function bindListe() {
  document.querySelectorAll('.pill[data-ctx]').forEach((el) => {
    el.addEventListener('click', () => gaaTil('next', { context: el.dataset.ctx || null }));
  });

  document.querySelectorAll('.tick[data-done]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); fuldfoer(el.dataset.done); });
  });

  document.querySelectorAll('.item-row').forEach((el) => {
    el.addEventListener('click', () => {
      const it = state.items.find((x) => x.id === el.dataset.id);
      if (it) aabnElement(it);
    });
    el.addEventListener('keydown', raekkeTaster);
  });

  // Behold fokus efter en gentegning, sa tastaturafklaringen ikke starter
  // forfra ved hvert element.
  if (sideState.fokusId) {
    const el = document.querySelector(`.item-row[data-id="${CSS.escape(sideState.fokusId)}"]`);
    if (el) el.focus();
    else {
      const foerste = document.querySelector('.item-row');
      if (foerste) foerste.focus();
    }
    sideState.fokusId = null;
  }
}

function naboRaekke(el, retning) {
  const alle = [...document.querySelectorAll('.item-row')];
  const i = alle.indexOf(el);
  return alle[i + retning] || alle[retning > 0 ? 0 : alle.length - 1];
}

async function raekkeTaster(e) {
  const el = e.currentTarget;
  const id = el.dataset.id;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); naboRaekke(el, 1).focus(); return; }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); naboRaekke(el, -1).focus(); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    const it = state.items.find((x) => x.id === id);
    if (it) aabnElement(it);
    return;
  }

  // Naeste element far fokus, FOER raekken forsvinder ud af listen.
  const naeste = naboRaekke(el, 1);
  const husk = () => { sideState.fokusId = naeste && naeste.dataset.id !== id ? naeste.dataset.id : null; };

  if (e.key === ' ') { e.preventDefault(); husk(); await fuldfoer(id); return; }
  const statusTaster = { n: 'next', w: 'waiting', s: 'someday', q: 'queued' };
  if (statusTaster[e.key]) {
    e.preventDefault();
    husk();
    await saetStatus(id, statusTaster[e.key]);
    return;
  }
  if (e.key === 'x') {
    e.preventDefault();
    husk();
    await slet(id);
  }
}

async function fuldfoer(id) {
  const it = state.items.find((x) => x.id === id);
  try {
    await api('POST', `/api/v1/items/${id}/complete`, {});
    await genindlaes();
    toast(`Done: ${it ? it.title : 'item'}`, {
      label: 'Undo',
      run: async () => { await api('POST', `/api/v1/items/${id}/uncomplete`, {}); await genindlaes(); },
    });
  } catch (ex) { toast(ex.message); }
}

async function saetStatus(id, status) {
  try {
    await api('POST', `/api/v1/items/${id}`, { status });
    await genindlaes();
    toast(`Moved to ${statusNavn(status)}`);
  } catch (ex) { toast(ex.message); }
}

async function slet(id) {
  try {
    await api('DELETE', `/api/v1/items/${id}`, {});
    await genindlaes();
    toast('Deleted');
  } catch (ex) { toast(ex.message); }
}

/* ------------------------------------------------------ detaljeruden */

async function aabnElement(listeItem) {
  // Listen baerer KUN et antal vedhaeftninger, aldrig metadataene - det er
  // hele pointen med §4-lektien. Ruden skal derfor hente det fulde element,
  // ellers star filerne der ikke.
  let it = listeItem;
  if (listeItem.attachment_count && !listeItem.attachments) {
    try { it = (await api('GET', `/api/v1/items/${listeItem.id}`)).item; }
    catch { it = Object.assign({ attachments: [] }, listeItem); }
  } else if (!it.attachments) {
    it = Object.assign({ attachments: [] }, listeItem);
  }
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-label="Edit item">
    <label class="field"><span>Title</span>
      <input class="input" id="edTitle" value="${esc(it.title)}"></label>

    <label class="field"><span>Description</span>
      <textarea class="input" id="edNote" rows="5"
        placeholder="Notes, links, anything. Markdown links work: [text](https://…)">${esc(it.note)}</textarea></label>
    <div id="edPreview" class="note-preview"${it.note ? '' : ' hidden'}></div>

    <div class="row2">
      <label class="field"><span>Status</span>
        <select class="input" id="edStatus">
          ${['inbox', 'next', 'queued', 'waiting', 'someday', 'done', 'dropped'].map((s) =>
    `<option value="${s}"${s === it.status ? ' selected' : ''}>${esc(statusNavn(s))}</option>`).join('')}
        </select></label>
      <label class="field"><span>Project</span>
        <select class="input" id="edProject">
          <option value="">— none —</option>
          ${state.projects.map((p) =>
    `<option value="${esc(p.id)}"${p.id === it.project_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>
    </div>

    <div class="row2">
      <label class="field"><span>Due date</span>
        <input class="input" id="edDue" type="date" value="${esc(it.due_date || '')}"></label>
      <label class="field"><span>Hidden until</span>
        <input class="input" id="edDefer" type="date" value="${esc(it.defer_date || '')}"></label>
    </div>

    <div class="field"><span>Contexts</span>
      <div class="ctxpick">${state.contexts.length ? state.contexts.map((c) => `
        <label class="ctxopt"><input type="checkbox" value="${esc(c.id)}"
          ${it.contexts.some((x) => x.id === c.id) ? 'checked' : ''}>#${esc(c.name)}</label>`).join('')
    : '<span class="lead">No contexts yet — add one by typing #name when you capture.</span>'}</div>
    </div>

    ${vedhaeftningerHtml(it)}

    <div class="modal-foot">
      <button class="btn ghost" id="edDelete">Delete</button>
      <button class="btn ghost" id="edConvert">${it.kind === 'note' ? 'Make it a task' : 'Make it a note'}</button>
      <span style="flex:1"></span>
      <button class="btn" id="edCancel">Cancel</button>
      <button class="btn primary" id="edSave">Save</button>
    </div>
  </div>`;

  document.body.appendChild(host);
  const luk = () => { host.remove(); document.removeEventListener('keydown', esctast); };
  const esctast = (e) => { if (e.key === 'Escape') { e.preventDefault(); luk(); } };
  document.addEventListener('keydown', esctast);
  host.addEventListener('click', (e) => { if (e.target === host) luk(); });

  const noteEl = host.querySelector('#edNote');
  const preview = host.querySelector('#edPreview');
  const tegnPreview = () => {
    const v = noteEl.value.trim();
    preview.hidden = !v;
    preview.innerHTML = v ? markdown(v) : '';
  };
  noteEl.addEventListener('input', tegnPreview);
  tegnPreview();

  host.querySelector('#edCancel').addEventListener('click', luk);

  host.querySelector('#edSave').addEventListener('click', async () => {
    // Hoerer elementet til en gentagelse, skal brugeren tage stilling:
    // gaelder aendringen kun denne gang, eller alle fremtidige? (handover §5.6)
    let tilSerien = false;
    if (it.recurrence_id) {
      const svar = await spoergOmSerie(it.title);
      if (svar === null) return;          // lukket uden at vaelge
      tilSerien = svar;
    }
    try {
      await api('POST', `/api/v1/items/${it.id}`, {
        applyToSeries: tilSerien,
        title: host.querySelector('#edTitle').value,
        note: noteEl.value,
        status: host.querySelector('#edStatus').value,
        project_id: host.querySelector('#edProject').value || null,
        due_date: host.querySelector('#edDue').value || null,
        defer_date: host.querySelector('#edDefer').value || null,
        contexts: [...host.querySelectorAll('.ctxpick input:checked')].map((x) => x.value),
      });
      luk();
      await genindlaes();
      toast('Saved');
    } catch (ex) { toast(ex.message); }
  });

  host.querySelector('#edDelete').addEventListener('click', async () => {
    luk();
    await slet(it.id);
  });

  // Konvertering ma ALDRIG miste indhold: bade titel og beskrivelse foelger
  // med begge veje (handover §5.5). En note er reference og skal derfor ud af
  // handlingslisterne - den far status "queued", ikke "inbox".
  host.querySelector('#edConvert').addEventListener('click', async () => {
    const tilNote = it.kind !== 'note';
    try {
      await api('POST', `/api/v1/items/${it.id}`, {
        title: host.querySelector('#edTitle').value,
        note: noteEl.value,
        kind: tilNote ? 'note' : 'task',
        status: tilNote ? 'queued' : (it.status === 'queued' ? 'inbox' : it.status),
      });
      luk();
      await genindlaes();
      toast(tilNote ? 'Converted to a note' : 'Converted to a task');
    } catch (ex) { toast(ex.message); }
  });

  // Efter upload eller sletning gentegnes KUN fillisten - brugerens ugemte
  // rettelser i titel og beskrivelse skal ikke gaa tabt. Navngivet funktion,
  // ikke arguments.callee: filen er strict mode.
  const genhentFiler = async () => {
    const frisk = (await api('GET', `/api/v1/items/${it.id}`)).item;
    it.attachments = frisk.attachments || [];
    host.querySelector('#fileList').innerHTML = it.attachments.map(filKort).join('');
    bindVedhaeftninger(host, it, genhentFiler);
    await genindlaes();
  };
  bindVedhaeftninger(host, it, genhentFiler);

  host.querySelector('#edTitle').focus();
}

/* ------------------------------------------------------ indstillinger */

function sideSettings() {
  const tema = nuvaerendeTema();
  const valg = [['auto', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']];
  return `<section class="page">
    <div class="page-head"><h1>Settings</h1><p class="lead">${esc(BESKRIVELSER.settings)}</p></div>

    <div class="card"><h2>Theme</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${valg.map(([v, l]) => `<button class="btn ${tema === v ? 'primary' : ''}" data-tema="${v}">${l}</button>`).join('')}
      </div></div>

    <div class="card"><h2>Capture syntax</h2>
      <table class="syntax">
        <tr><td><code>+ text</code></td><td>task (also the default)</td></tr>
        <tr><td><code>* text</code></td><td>note</td></tr>
        <tr><td><code>#context</code></td><td>add a context</td></tr>
        <tr><td><code>@project</code></td><td>file under a project — <code>@"two words"</code></td></tr>
        <tr><td><code>!date</code></td><td><code>!tomorrow</code>, <code>!friday</code>, <code>!3/9</code>, <code>!in 2 weeks</code></td></tr>
        <tr><td><code>~date</code></td><td>hide until that date</td></tr>
        <tr><td><code>text // more</code></td><td>everything after <code>//</code> becomes the description</td></tr>
      </table>
      <p class="gate-note" style="text-align:left">Danish words work too: <code>!i morgen</code>, <code>!om 2 uger</code>.</p>
    </div>

    <div class="card"><h2>Access keys</h2>
      <p class="lead" style="margin:6px 0 0">For iOS Shortcuts, Siri and anything else
      that talks to doda from outside. One key per device or purpose, so you can revoke
      a single one without touching the rest.</p>
      <div id="keyList" class="keylist">Loading…</div>
      <form id="keyForm" class="keyform">
        <input class="input" id="keyName" placeholder="What is it for? e.g. iPhone Shortcut" maxlength="60" required>
        <select class="input" id="keyScope">
          <option value="capture">Capture only — can add, cannot read</option>
          <option value="read">Read only</option>
          <option value="full">Full access</option>
        </select>
        <button class="btn primary" type="submit">Create key</button>
      </form>
      <p class="gate-note" style="text-align:left">A lost phone should not be able to
      read your whole system — prefer <strong>capture only</strong> unless you need more.</p>
    </div>

    <div class="card"><h2>Change password</h2>
      <p class="gate-error" id="pwMsg" hidden></p>
      <form id="pwForm" style="margin-top:12px">
        <label class="field"><span>Current password</span>
          <input class="input" id="pwCur" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>New password (at least 8 characters)</span>
          <input class="input" id="pwNew" type="password" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Change password</button>
      </form>
      <p class="gate-note" style="text-align:left">Every other session is signed out when the password changes.</p>
    </div>

    <div class="card"><h2>Account</h2>
      <p class="lead" style="margin:6px 0 14px">Signed in as <strong>${esc(state.user.username)}</strong>.</p>
      <button class="btn" id="logoutBtn">Sign out</button></div>

    <div class="card"><h2>About</h2>
      <p class="lead" style="margin-top:6px">doda version ${APP_VERSION}.
      ${state.config.secureContext ? 'Secure connection (https).' : 'Plain http — passkeys and notifications are unavailable here.'}</p></div>
  </section>`;
}

/* ------------------------------------------------------ adgangsnoegler */

const SCOPE_TEKST = {
  capture: 'capture only', read: 'read only', full: 'full access',
};

async function tegnNoegler() {
  const host = document.getElementById('keyList');
  if (!host) return;
  try {
    const d = await api('GET', '/api/v1/tokens');
    if (!d.tokens.length) {
      host.innerHTML = '<p class="lead" style="margin:14px 0 0">No keys yet.</p>';
      return;
    }
    host.innerHTML = d.tokens.map((t) => `
      <div class="keyrow">
        <div class="keyrow-main">
          <div class="keyrow-name">${esc(t.name)}</div>
          <div class="meta">doda_${esc(t.prefix)}… · ${esc(SCOPE_TEKST[t.scope] || t.scope)} ·
            ${t.last_used_at ? `last used ${visTid(t.last_used_at)}` : 'never used'}</div>
        </div>
        <button class="btn ghost" data-revoke="${esc(t.id)}">Revoke</button>
      </div>`).join('');
    host.querySelectorAll('[data-revoke]').forEach((el) => {
      el.addEventListener('click', async () => {
        await api('DELETE', `/api/v1/tokens/${el.dataset.revoke}`, {});
        toast('Key revoked — it stopped working immediately');
        tegnNoegler();
      });
    });
  } catch (ex) { host.innerHTML = `<p class="lead">${esc(ex.message)}</p>`; }
}

function visTid(unix) {
  const d = new Date(unix * 1000);
  const timer = (Date.now() / 1000 - unix) / 3600;
  if (timer < 1) return 'just now';
  if (timer < 24) return `${Math.floor(timer)}h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* Noeglen vises ÉN gang. Den findes ikke i klartekst nogen steder bagefter -
   heller ikke i databasen (handover §5.10). */
function visNyNoegle(noegle, navn) {
  const host = document.createElement('div');
  host.className = 'modal';
  host.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true">
    <h2>Key created: ${esc(navn)}</h2>
    <p class="lead" style="margin:6px 0 16px">Copy it now — this is the only time it is
    ever shown. Only a hash of it is stored, so it cannot be recovered.</p>
    <div class="keyshow" id="keyValue">${esc(noegle)}</div>
    <div class="modal-foot">
      <span style="flex:1"></span>
      <button class="btn" id="keyCopy">Copy</button>
      <button class="btn primary" id="keyDone">Done</button>
    </div>
  </div>`;
  document.body.appendChild(host);
  host.querySelector('#keyDone').addEventListener('click', () => host.remove());
  host.querySelector('#keyCopy').addEventListener('click', async () => {
    try {
      // navigator.clipboard kraever secure context - panelets IP:port er http.
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(noegle);
      else {
        const r = document.createRange();
        r.selectNodeContents(host.querySelector('#keyValue'));
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        document.execCommand('copy');
      }
      toast('Copied');
    } catch { toast('Could not copy — select the text manually'); }
  });
}

function bindNoegler() {
  const form = document.getElementById('keyForm');
  if (!form) return;
  tegnNoegler();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const d = await api('POST', '/api/v1/tokens', {
        name: document.getElementById('keyName').value,
        scope: document.getElementById('keyScope').value,
      });
      form.reset();
      visNyNoegle(d.key, d.name);
      tegnNoegler();
    } catch (ex) { toast(ex.message); }
  });
}

function bindSettings() {
  bindNoegler();
  document.querySelectorAll('[data-tema]').forEach((el) => {
    el.addEventListener('click', () => { anvendTema(el.dataset.tema); tegnSide(); });
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
      toast('Password changed');
      document.getElementById('pwForm').reset();
    } catch (ex) { msg.textContent = ex.message; msg.hidden = false; }
  });
}
